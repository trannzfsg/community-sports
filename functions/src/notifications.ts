/* eslint-disable require-jsdoc */
import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import nodemailer from "nodemailer";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {EMAIL_NOTIFICATIONS_ENABLED} from "./feature-flags.js";

const adminApp = getApps().length ? getApps()[0] : initializeApp();
const firestore = getFirestore(adminApp);
const PAYMENT_DUE_WINDOW_MS = 15 * 60 * 1000;
const BRISBANE_UTC_OFFSET = "+10:00";
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || "";
const defaultFromEmail =
  process.env.SMTP_FROM?.trim() || "noreply@firebase.tranzha.com";

let cachedEmailTransporter: nodemailer.Transporter | null = null;

type DataPartition = "test" | "live";
type AppRole = "player" | "organiser" | "admin";
type TelegramChatType = "private" | "group" | "channel";

type NotificationEventType =
  | "organiser_approval_requested"
  | "player_approval_approved"
  | "organiser_player_registered"
  | "organiser_player_removed"
  | "organiser_payment_reference_updated"
  | "player_moved_from_waitlist"
  | "player_payment_confirmed"
  | "player_payment_due_soon"
  | "player_new_event_opened";

type UserRecord = {
  displayName?: string;
  email?: string;
  role?: AppRole;
  dataPartition?: DataPartition;
};

type NotificationPreferences = {
  email?: {
    enabled?: boolean;
  };
  telegram?: {
    enabled?: boolean;
    chatId?: string;
    chatType?: TelegramChatType;
  };
  organiser?: {
    approvalRequested?: boolean;
    playerRegistered?: boolean;
    playerRemoved?: boolean;
    paymentReferenceUpdated?: boolean;
  };
  player?: {
    approvalApproved?: boolean;
    paymentDueSoon?: boolean;
    movedFromWaitlist?: boolean;
    paymentConfirmed?: boolean;
    newEventOpened?: boolean;
  };
};

type OrganiserApprovalRecord = {
  organiserId: string;
  organiserName?: string;
  playerId: string;
  playerName?: string;
  playerEmail?: string;
  dataPartition?: DataPartition;
  status?: string;
};

type SessionEventRecord = {
  sessionSeriesId: string;
  organiserId: string;
  organiserName?: string;
  title?: string;
  eventDate?: string;
  startAt?: string;
  capacity?: number;
  waitingListCapacity?: number;
  dataPartition?: DataPartition;
  status?: string;
};

type SessionSeriesRecord = {
  organiserId: string;
  organiserName?: string;
  title?: string;
  dataPartition?: DataPartition;
};

type RegistrationRecord = {
  sessionEventId: string;
  sessionSeriesId: string;
  userId: string;
  playerName?: string;
  playerEmail?: string;
  dataPartition?: DataPartition;
  playerPaid?: boolean;
  organiserPaid?: boolean;
  paymentReference?: string | null;
  status?: "registered" | "waiting";
};

type RecipientContext = {
  userId: string;
  displayName: string;
  email: string;
  role: AppRole;
  dataPartition: DataPartition;
  preferences: NotificationPreferences | null;
};

type EventRegistrationStats = {
  capacity: number;
  waitingListCapacity: number;
  registeredCount: number;
  waitingCount: number;
  paidRegisteredCount: number;
};

type NotificationEventRecord = {
  title?: string;
  body?: string;
  recipientUserId?: string;
  recipientEmail?: string;
  sourceCollection?: string;
  sourceId?: string;
  channels?: {
    email?: boolean;
    telegram?: boolean;
  };
  telegramChatId?: string | null;
  telegramChatType?: TelegramChatType | null;
};

function normalizeDataPartition(value: unknown): DataPartition {
  return value === "test" ? "test" : "live";
}

function sanitizeDocId(value: string) {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function getDisplayName(
  preferredName: string | undefined,
  fallbackEmail: string | undefined,
  fallbackId: string,
) {
  const trimmedName = typeof preferredName === "string" ?
    preferredName.trim() :
    "";
  if (trimmedName) {
    return trimmedName;
  }

  const trimmedEmail = typeof fallbackEmail === "string" ?
    fallbackEmail.trim() :
    "";
  return trimmedEmail || fallbackId;
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseEventStartMillis(eventDate?: string, startAt?: string) {
  if (!eventDate || !startAt) {
    return 0;
  }

  return new Date(
    `${eventDate}T${startAt}:00${BRISBANE_UTC_OFFSET}`,
  ).getTime();
}

function buildEventLabel(event: SessionEventRecord) {
  const title = trimString(event.title) || "Session";
  const eventDate = trimString(event.eventDate);
  const startAt = trimString(event.startAt);

  if (eventDate && startAt) {
    return `${title} on ${eventDate} at ${startAt}`;
  }

  if (eventDate) {
    return `${title} on ${eventDate}`;
  }

  return title;
}

function buildRegistrationCountSummary(stats: EventRegistrationStats) {
  return `Registered ${stats.registeredCount}/${stats.capacity}, waiting ` +
    `${stats.waitingCount}/${stats.waitingListCapacity}.`;
}

function buildPaidCountSummary(stats: EventRegistrationStats) {
  return "Paid " +
    `${stats.paidRegisteredCount}/${stats.registeredCount} ` +
    "registered players.";
}

async function getRecipientContext(
  userId: string,
): Promise<RecipientContext | null> {
  const [userSnapshot, preferencesSnapshot] = await Promise.all([
    firestore.doc(`users/${userId}`).get(),
    firestore.doc(`notificationPreferences/${userId}`).get(),
  ]);

  if (!userSnapshot.exists) {
    logger.warn("Skipping notification for missing user profile", {userId});
    return null;
  }

  const userData = (userSnapshot.data() || {}) as UserRecord;
  return {
    userId,
    displayName: getDisplayName(userData.displayName, userData.email, userId),
    email: trimString(userData.email),
    role: userData.role || "player",
    dataPartition: normalizeDataPartition(userData.dataPartition),
    preferences: preferencesSnapshot.exists ?
      (preferencesSnapshot.data() as NotificationPreferences) :
      null,
  };
}

function getEligibleChannels(context: RecipientContext) {
  const preferences = context.preferences;
  const telegramChatId = trimString(preferences?.telegram?.chatId);
  const telegramChatType =
    preferences?.telegram?.chatType === "group" ||
    preferences?.telegram?.chatType === "channel" ?
      preferences.telegram.chatType :
      "private";

  return {
    email:
      EMAIL_NOTIFICATIONS_ENABLED &&
      !!preferences?.email?.enabled &&
      !!context.email,
    telegram:
      !!preferences?.telegram?.enabled && telegramChatId.length > 0,
    telegramChatId,
    telegramChatType,
  };
}

async function getEventRegistrationStats(
  sessionEventId: string,
  eventData?: SessionEventRecord,
): Promise<EventRegistrationStats> {
  const registrationsSnapshot = await firestore.collection("registrations")
    .where("sessionEventId", "==", sessionEventId)
    .get();

  let registeredCount = 0;
  let waitingCount = 0;
  let paidRegisteredCount = 0;

  registrationsSnapshot.docs.forEach((registrationDoc) => {
    const registration = registrationDoc.data() as RegistrationRecord;
    if (registration.status === "waiting") {
      waitingCount += 1;
      return;
    }

    registeredCount += 1;
    if (registration.playerPaid || registration.organiserPaid) {
      paidRegisteredCount += 1;
    }
  });

  return {
    capacity: Math.max(0, Number(eventData?.capacity || 0)),
    waitingListCapacity: Math.max(
      0,
      Number(eventData?.waitingListCapacity || 0),
    ),
    registeredCount,
    waitingCount,
    paidRegisteredCount,
  };
}

async function getEventContext(sessionEventId: string) {
  const eventSnapshot = await firestore.doc(`sessionEvents/${sessionEventId}`)
    .get();
  if (!eventSnapshot.exists) {
    logger.warn("Notification skipped because session event is missing", {
      sessionEventId,
    });
    return null;
  }

  const eventData = eventSnapshot.data() as SessionEventRecord;
  const seriesSnapshot = await firestore
    .doc(`sessions/${eventData.sessionSeriesId}`)
    .get();

  return {
    eventData,
    seriesData: seriesSnapshot.exists ?
      (seriesSnapshot.data() as SessionSeriesRecord) :
      null,
    stats: await getEventRegistrationStats(sessionEventId, eventData),
  };
}

async function queueNotificationEvent(input: {
  idempotencyKey: string;
  triggerEventId?: string;
  type: NotificationEventType;
  recipientUserId: string;
  dataPartition: DataPartition;
  sourceCollection: string;
  sourceId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  isEnabled: (preferences: NotificationPreferences | null) => boolean;
}) {
  const recipientContext = await getRecipientContext(input.recipientUserId);
  if (!recipientContext) {
    return;
  }

  if (!input.isEnabled(recipientContext.preferences)) {
    return;
  }

  const channels = getEligibleChannels(recipientContext);
  const eventRef = firestore.doc(
    `notificationEvents/${sanitizeDocId(input.idempotencyKey)}`,
  );
  const eventSnapshot = await eventRef.get();
  const payload: Record<string, unknown> = {
    type: input.type,
    recipientUserId: recipientContext.userId,
    recipientRole: recipientContext.role,
    recipientDisplayName: recipientContext.displayName,
    recipientEmail: recipientContext.email,
    dataPartition: input.dataPartition,
    sourceCollection: input.sourceCollection,
    sourceId: input.sourceId,
    triggerEventId: input.triggerEventId || null,
    idempotencyKey: input.idempotencyKey,
    channels: {
      email: channels.email,
      telegram: channels.telegram,
    },
    telegramChatId: channels.telegram ? channels.telegramChatId : null,
    telegramChatType: channels.telegram ? channels.telegramChatType : null,
    title: input.title,
    body: input.body,
    metadata: input.metadata || {},
    status: "pending",
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!eventSnapshot.exists) {
    payload.createdAt = FieldValue.serverTimestamp();
  }

  await eventRef.set(payload, {merge: true});

  logger.info("Queued notification event", {
    type: input.type,
    recipientUserId: input.recipientUserId,
    sourceCollection: input.sourceCollection,
    sourceId: input.sourceId,
  });
}

async function markNotificationEventState(
  notificationEventId: string,
  update: Record<string, unknown>,
) {
  await firestore.doc(`notificationEvents/${notificationEventId}`).set({
    ...update,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
}

async function sendTelegramMessage(input: {
  chatId: string;
  title: string;
  body: string;
}) {
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(
    `${TELEGRAM_API_BASE_URL}/bot${telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: `${input.title}\n\n${input.body}`.trim(),
        disable_web_page_preview: true,
      }),
    },
  );

  const responseJson = await response.json() as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || !responseJson.ok) {
    throw new Error(
      responseJson.description ||
      `Telegram send failed with HTTP ${response.status}.`,
    );
  }
}

function getEmailTransporter() {
  if (cachedEmailTransporter) {
    return cachedEmailTransporter;
  }

  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpPort = Number(process.env.SMTP_PORT || "587");
  const smtpSecure = process.env.SMTP_SECURE === "true";

  if (!smtpHost || !smtpUser || !smtpPass || !Number.isFinite(smtpPort)) {
    throw new Error(
      "SMTP configuration is incomplete. " +
      "Expected SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS.",
    );
  }

  cachedEmailTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  return cachedEmailTransporter;
}

async function sendEmailMessage(input: {
  recipientEmail: string;
  title: string;
  body: string;
}) {
  const transporter = getEmailTransporter();
  await transporter.sendMail({
    from: defaultFromEmail,
    to: input.recipientEmail,
    subject: input.title,
    text: input.body,
  });
}

function buildOverallDeliveryStatus(input: {
  enabledChannelCount: number;
  sentChannelCount: number;
  failedChannelCount: number;
}) {
  if (input.enabledChannelCount === 0) {
    return "skipped";
  }

  if (input.failedChannelCount === 0) {
    return "sent";
  }

  if (input.sentChannelCount > 0) {
    return "partial_failure";
  }

  return "failed";
}

export const deliverNotificationEvent = onDocumentCreated(
  "notificationEvents/{notificationEventId}",
  async (event) => {
    const notificationEvent = event.data?.data() as
      NotificationEventRecord | undefined;
    if (!notificationEvent) {
      return;
    }

    const notificationEventId = String(event.params.notificationEventId);
    const title = trimString(notificationEvent.title) || "Notification";
    const body = trimString(notificationEvent.body);
    const recipientEmail = trimString(notificationEvent.recipientEmail);
    const telegramChatId = trimString(notificationEvent.telegramChatId);
    const telegramEnabled = !!notificationEvent.channels?.telegram;
    const emailEnabled =
      EMAIL_NOTIFICATIONS_ENABLED && !!notificationEvent.channels?.email;
    const delivery: Record<string, unknown> = {
      telegram: {
        status: "disabled",
      },
      email: {
        status: "disabled",
      },
    };
    let enabledChannelCount = 0;
    let sentChannelCount = 0;
    let failedChannelCount = 0;

    if (telegramEnabled) {
      enabledChannelCount += 1;
      if (!telegramChatId) {
        failedChannelCount += 1;
        delivery.telegram = {
          status: "failed",
          error: "Missing Telegram chat ID.",
        };
      } else {
        try {
          await sendTelegramMessage({
            chatId: telegramChatId,
            title,
            body,
          });
          sentChannelCount += 1;
          delivery.telegram = {
            status: "sent",
            chatId: telegramChatId,
            sentAt: FieldValue.serverTimestamp(),
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          failedChannelCount += 1;
          logger.error("Telegram notification delivery failed", {
            notificationEventId,
            recipientUserId: notificationEvent.recipientUserId || null,
            sourceCollection: notificationEvent.sourceCollection || null,
            sourceId: notificationEvent.sourceId || null,
            error: errorMessage,
          });
          delivery.telegram = {
            status: "failed",
            chatId: telegramChatId,
            error: errorMessage,
            failedAt: FieldValue.serverTimestamp(),
          };
        }
      }
    }

    if (emailEnabled) {
      enabledChannelCount += 1;
      if (!recipientEmail) {
        failedChannelCount += 1;
        delivery.email = {
          status: "failed",
          error: "Missing recipient email address.",
        };
      } else {
        try {
          await sendEmailMessage({
            recipientEmail,
            title,
            body,
          });
          sentChannelCount += 1;
          delivery.email = {
            status: "sent",
            recipientEmail,
            sentAt: FieldValue.serverTimestamp(),
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          failedChannelCount += 1;
          logger.error("Email notification delivery failed", {
            notificationEventId,
            recipientUserId: notificationEvent.recipientUserId || null,
            sourceCollection: notificationEvent.sourceCollection || null,
            sourceId: notificationEvent.sourceId || null,
            error: errorMessage,
          });
          delivery.email = {
            status: "failed",
            recipientEmail,
            error: errorMessage,
            failedAt: FieldValue.serverTimestamp(),
          };
        }
      }
    }

    await markNotificationEventState(notificationEventId, {
      status: buildOverallDeliveryStatus({
        enabledChannelCount,
        sentChannelCount,
        failedChannelCount,
      }),
      delivery,
    });
  },
);

export const queueApprovalRequestedNotification = onDocumentCreated(
  "organiserApprovals/{approvalId}",
  async (event) => {
    const approval = event.data?.data() as OrganiserApprovalRecord | undefined;
    if (!approval || approval.status !== "pending") {
      return;
    }

    await queueNotificationEvent({
      idempotencyKey:
        `${event.id}__${approval.organiserId}__organiser_approval_requested`,
      triggerEventId: event.id,
      type: "organiser_approval_requested",
      recipientUserId: approval.organiserId,
      dataPartition: normalizeDataPartition(approval.dataPartition),
      sourceCollection: "organiserApprovals",
      sourceId: String(event.params.approvalId),
      title: "Approval request",
      body: `${
        trimString(approval.playerName) ||
        trimString(approval.playerEmail) ||
        "A player"
      } requested approval for your events.`,
      metadata: {
        approvalId: event.params.approvalId,
        playerId: approval.playerId,
      },
      isEnabled: (preferences) => !!preferences?.organiser?.approvalRequested,
    });
  },
);

export const queueApprovalApprovedNotification = onDocumentUpdated(
  "organiserApprovals/{approvalId}",
  async (event) => {
    const before = event.data?.before.data() as
      OrganiserApprovalRecord | undefined;
    const after = event.data?.after.data() as
      OrganiserApprovalRecord | undefined;

    if (!before || !after) {
      return;
    }

    if (before.status === "approved" || after.status !== "approved") {
      return;
    }

    await queueNotificationEvent({
      idempotencyKey:
        `${event.id}__${after.playerId}__player_approval_approved`,
      triggerEventId: event.id,
      type: "player_approval_approved",
      recipientUserId: after.playerId,
      dataPartition: normalizeDataPartition(after.dataPartition),
      sourceCollection: "organiserApprovals",
      sourceId: String(event.params.approvalId),
      title: "Approval granted",
      body:
        `${trimString(after.organiserName) || "An organiser"} approved you ` +
        "for registrations.",
      metadata: {
        approvalId: event.params.approvalId,
        organiserId: after.organiserId,
      },
      isEnabled: (preferences) => !!preferences?.player?.approvalApproved,
    });
  },
);

export const queueRegistrationCreatedNotification = onDocumentCreated(
  "registrations/{registrationId}",
  async (event) => {
    const registration = event.data?.data() as RegistrationRecord | undefined;
    if (!registration) {
      return;
    }

    const eventContext = await getEventContext(registration.sessionEventId);
    if (!eventContext) {
      return;
    }

    await queueNotificationEvent({
      idempotencyKey:
        `${event.id}__${eventContext.eventData.organiserId}__` +
        "organiser_player_registered",
      triggerEventId: event.id,
      type: "organiser_player_registered",
      recipientUserId: eventContext.eventData.organiserId,
      dataPartition: normalizeDataPartition(registration.dataPartition),
      sourceCollection: "registrations",
      sourceId: String(event.params.registrationId),
      title: "New registration",
      body:
        `${trimString(registration.playerName) || "A player"} registered for ` +
        `${buildEventLabel(eventContext.eventData)}. ` +
        `${buildRegistrationCountSummary(eventContext.stats)}`,
      metadata: {
        registrationId: event.params.registrationId,
        sessionEventId: registration.sessionEventId,
      },
      isEnabled: (preferences) => !!preferences?.organiser?.playerRegistered,
    });
  },
);

export const queueRegistrationDeletedNotification = onDocumentDeleted(
  "registrations/{registrationId}",
  async (event) => {
    const registration = event.data?.data() as RegistrationRecord | undefined;
    if (!registration) {
      return;
    }

    const eventContext = await getEventContext(registration.sessionEventId);
    if (!eventContext) {
      return;
    }

    await queueNotificationEvent({
      idempotencyKey:
        `${event.id}__${eventContext.eventData.organiserId}__` +
        "organiser_player_removed",
      triggerEventId: event.id,
      type: "organiser_player_removed",
      recipientUserId: eventContext.eventData.organiserId,
      dataPartition: normalizeDataPartition(registration.dataPartition),
      sourceCollection: "registrations",
      sourceId: String(event.params.registrationId),
      title: "Registration removed",
      body:
        `${
          trimString(registration.playerName) || "A player"
        } was removed from ` +
        `${buildEventLabel(eventContext.eventData)}. ` +
        `${buildRegistrationCountSummary(eventContext.stats)}`,
      metadata: {
        registrationId: event.params.registrationId,
        sessionEventId: registration.sessionEventId,
      },
      isEnabled: (preferences) => !!preferences?.organiser?.playerRemoved,
    });
  },
);

export const queueRegistrationUpdatedNotifications = onDocumentUpdated(
  "registrations/{registrationId}",
  async (event) => {
    const before = event.data?.before.data() as RegistrationRecord | undefined;
    const after = event.data?.after.data() as RegistrationRecord | undefined;

    if (!before || !after) {
      return;
    }

    const eventContext = await getEventContext(after.sessionEventId);
    if (!eventContext) {
      return;
    }

    const beforeReference = trimString(before.paymentReference);
    const afterReference = trimString(after.paymentReference);
    const paymentReferenceUpdated =
      afterReference.length > 0 && beforeReference !== afterReference;
    const playerMarkedPaid = !before.playerPaid && !!after.playerPaid;

    if (paymentReferenceUpdated || playerMarkedPaid) {
      await queueNotificationEvent({
        idempotencyKey:
          `${event.id}__${eventContext.eventData.organiserId}__` +
          "organiser_payment_reference_updated",
        triggerEventId: event.id,
        type: "organiser_payment_reference_updated",
        recipientUserId: eventContext.eventData.organiserId,
        dataPartition: normalizeDataPartition(after.dataPartition),
        sourceCollection: "registrations",
        sourceId: String(event.params.registrationId),
        title: "Payment reference updated",
        body:
          `${trimString(after.playerName) || "A player"} updated payment for ` +
          `${buildEventLabel(eventContext.eventData)}. ` +
          `${buildPaidCountSummary(eventContext.stats)}`,
        metadata: {
          registrationId: event.params.registrationId,
          sessionEventId: after.sessionEventId,
          paymentReference: afterReference || null,
        },
        isEnabled: (preferences) =>
          !!preferences?.organiser?.paymentReferenceUpdated,
      });
    }

    if (before.status === "waiting" && after.status === "registered") {
      await queueNotificationEvent({
        idempotencyKey:
          `${event.id}__${after.userId}__player_moved_from_waitlist`,
        triggerEventId: event.id,
        type: "player_moved_from_waitlist",
        recipientUserId: after.userId,
        dataPartition: normalizeDataPartition(after.dataPartition),
        sourceCollection: "registrations",
        sourceId: String(event.params.registrationId),
        title: "You are in",
        body: "You moved from the waiting list to registered for " +
          `${buildEventLabel(eventContext.eventData)}.`,
        metadata: {
          registrationId: event.params.registrationId,
          sessionEventId: after.sessionEventId,
        },
        isEnabled: (preferences) => !!preferences?.player?.movedFromWaitlist,
      });
    }

    if (!before.organiserPaid && !!after.organiserPaid) {
      await queueNotificationEvent({
        idempotencyKey:
          `${event.id}__${after.userId}__player_payment_confirmed`,
        triggerEventId: event.id,
        type: "player_payment_confirmed",
        recipientUserId: after.userId,
        dataPartition: normalizeDataPartition(after.dataPartition),
        sourceCollection: "registrations",
        sourceId: String(event.params.registrationId),
        title: "Payment confirmed",
        body:
          `${
            trimString(eventContext.eventData.organiserName) ||
            "Your organiser"
          } ` +
          `confirmed payment for ${buildEventLabel(eventContext.eventData)}.`,
        metadata: {
          registrationId: event.params.registrationId,
          sessionEventId: after.sessionEventId,
        },
        isEnabled: (preferences) => !!preferences?.player?.paymentConfirmed,
      });
    }
  },
);

export const queueNewEventOpenedNotifications = onDocumentCreated(
  "sessionEvents/{sessionEventId}",
  async (event) => {
    const sessionEvent = event.data?.data() as SessionEventRecord | undefined;
    if (!sessionEvent || !sessionEvent.sessionSeriesId) {
      return;
    }

    const historicalRegistrationsSnapshot = await firestore
      .collection("registrations")
      .where("sessionSeriesId", "==", sessionEvent.sessionSeriesId)
      .get();

    const recipientUserIds = new Set<string>();
    historicalRegistrationsSnapshot.docs.forEach((registrationDoc) => {
      const registration = registrationDoc.data() as RegistrationRecord;
      if (
        registration.sessionEventId !== String(event.params.sessionEventId) &&
        registration.status !== "waiting" &&
        trimString(registration.userId)
      ) {
        recipientUserIds.add(trimString(registration.userId));
      }
    });

    if (recipientUserIds.size === 0) {
      return;
    }

    const currentEventRegistrationsSnapshot = await firestore
      .collection("registrations")
      .where("sessionEventId", "==", String(event.params.sessionEventId))
      .get();

    currentEventRegistrationsSnapshot.docs.forEach((registrationDoc) => {
      const registration = registrationDoc.data() as RegistrationRecord;
      recipientUserIds.delete(trimString(registration.userId));
    });

    if (recipientUserIds.size === 0) {
      return;
    }

    const seriesSnapshot = await firestore
      .doc(`sessions/${sessionEvent.sessionSeriesId}`)
      .get();
    const seriesData = seriesSnapshot.exists ?
      (seriesSnapshot.data() as SessionSeriesRecord) :
      null;

    for (const userId of recipientUserIds) {
      await queueNotificationEvent({
        idempotencyKey:
          `${event.id}__${userId}__player_new_event_opened`,
        triggerEventId: event.id,
        type: "player_new_event_opened",
        recipientUserId: userId,
        dataPartition: normalizeDataPartition(sessionEvent.dataPartition),
        sourceCollection: "sessionEvents",
        sourceId: String(event.params.sessionEventId),
        title: "New event open",
        body:
          `${trimString(seriesData?.title) || buildEventLabel(sessionEvent)} ` +
          `has a new event on ${trimString(sessionEvent.eventDate)} at ` +
          `${trimString(sessionEvent.startAt)}.`,
        metadata: {
          sessionEventId: event.params.sessionEventId,
          sessionSeriesId: sessionEvent.sessionSeriesId,
        },
        isEnabled: (preferences) => !!preferences?.player?.newEventOpened,
      });
    }
  },
);

export const queuePaymentDueSoonNotifications = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Australia/Brisbane",
  },
  async () => {
    const now = Date.now();
    const sessionEventsSnapshot = await firestore.collection("sessionEvents")
      .where("status", "==", "active")
      .get();

    for (const sessionEventDoc of sessionEventsSnapshot.docs) {
      const sessionEvent = sessionEventDoc.data() as SessionEventRecord;
      const startMillis = parseEventStartMillis(
        sessionEvent.eventDate,
        sessionEvent.startAt,
      );
      const startDiff = startMillis - now;

      if (startDiff <= 0 || startDiff > PAYMENT_DUE_WINDOW_MS) {
        continue;
      }

      const registrationsSnapshot = await firestore.collection("registrations")
        .where("sessionEventId", "==", sessionEventDoc.id)
        .get();

      for (const registrationDoc of registrationsSnapshot.docs) {
        const registration = registrationDoc.data() as RegistrationRecord;
        if (
          registration.status === "waiting" ||
          registration.playerPaid ||
          registration.organiserPaid ||
          !trimString(registration.userId)
        ) {
          continue;
        }

        await queueNotificationEvent({
          idempotencyKey:
            "player_payment_due_soon__" +
            `${sessionEventDoc.id}__${registration.userId}`,
          triggerEventId: undefined,
          type: "player_payment_due_soon",
          recipientUserId: registration.userId,
          dataPartition: normalizeDataPartition(registration.dataPartition),
          sourceCollection: "sessionEvents",
          sourceId: sessionEventDoc.id,
          title: "Payment still due",
          body:
            "Payment is still outstanding for " +
            `${buildEventLabel(sessionEvent)}. ` +
            "The event starts in less than 15 minutes.",
          metadata: {
            registrationId: registrationDoc.id,
            sessionEventId: sessionEventDoc.id,
          },
          isEnabled: (preferences) => !!preferences?.player?.paymentDueSoon,
        });
      }
    }
  },
);
