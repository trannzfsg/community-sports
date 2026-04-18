import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import type {Request, Response} from "express";
import {EMAIL_NOTIFICATIONS_ENABLED} from "./feature-flags.js";

setGlobalOptions({maxInstances: 10});

const adminApp = getApps().length ? getApps()[0] : initializeApp();
const firestore = getFirestore(adminApp);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://community-sports-6584e.web.app",
  "https://community-sports-6584e.firebaseapp.com",
  "https://sports.tranzha.com",
]);

/**
 * Applies CORS headers for the supported frontend origins.
 * @param {Request} request
 * @param {Response} response
 */
function applyCors(request: Request, response: Response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
  }
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Normalizes an email address for consistent storage and partition checks.
 * @param {string} email
 * @return {string}
 */
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Builds the canonical registration document id for event/user.
 * Must stay in sync with web-app/src/lib/session-series.ts.
 * @param {string} eventId
 * @param {string} userId
 * @return {string}
 */
function buildRegistrationId(eventId: string, userId: string) {
  const encodedUserId = encodeURIComponent(userId).replace(/%/g, "_");
  return `${eventId}__${encodedUserId}`;
}

/**
 * Returns role priority for canonical role resolution.
 * @param {unknown} role
 * @return {number}
 */
function roleRank(role: unknown) {
  if (role === "admin") return 3;
  if (role === "organiser") return 2;
  if (role === "player") return 1;
  return 0;
}

/**
 * Resolves the logical data partition for the supplied email address.
 * @param {string} email
 * @return {"test"|"live"}
 */
function getDataPartitionForEmail(email: string) {
  return normalizeEmail(email).endsWith("@example.com") ? "test" : "live";
}

/**
 * Verifies the Bearer token and returns the decoded user identity.
 * @param {Request} request
 */
async function authenticateRequest(request: Request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer (.+)$/);
  if (!match) {
    throw new Error("Missing authorization token.");
  }

  return getAuth(adminApp).verifyIdToken(match[1]);
}

export const health = onRequest((request, response) => {
  logger.info("Health check hit", {method: request.method, path: request.path});
  response.status(200).json({
    ok: true,
    service: "community-sports-functions",
    timestamp: new Date().toISOString(),
  });
});

export const rolesInfo = onRequest((request, response) => {
  response.status(200).json({
    roles: ["player", "organiser", "admin"],
    organiserVisibility:
      "organisers can only manage and view their own sessions/payments",
    adminVisibility: "admins can view everything",
  });
});

export const passwordResetLookup = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  const email =
    typeof request.body?.email === "string" ?
      request.body.email.trim().toLowerCase() :
      "";
  if (!email) {
    response.status(400).json({error: "Email is required."});
    return;
  }

  try {
    const user = await getAuth(adminApp).getUserByEmail(email);
    const providerIds = new Set(
      user.providerData.map((provider) => provider.providerId),
    );

    if (providerIds.has("password")) {
      response.status(200).json({canReset: true});
      return;
    }

    if (providerIds.has("google.com")) {
      response.status(200).json({
        canReset: false,
        blockMessage:
          "This account uses Google sign-in. " +
          "Use Continue with Google instead of password reset.",
      });
      return;
    }

    response.status(200).json({
      canReset: false,
      blockMessage:
        "This account does not use email/password sign-in, " +
        "so password reset is not available.",
    });
  } catch (error) {
    logger.warn("Password reset lookup fallback", {
      email,
      error:
        error instanceof Error ? error.message : String(error),
    });
    response.status(200).json({canReset: true});
  }
});

export const syncUserEmailChange = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const nextEmail = typeof decodedToken.email === "string" ?
      decodedToken.email.trim().toLowerCase() :
      "";
    if (!nextEmail) {
      response.status(400).json({
        error: "Authenticated user email is required.",
      });
      return;
    }

    const userSnapshot = await firestore.doc(`users/${uid}`).get();
    if (!userSnapshot.exists) {
      response.status(404).json({error: "User profile not found."});
      return;
    }

    const userData = userSnapshot.data() || {};
    const role = userData.role;
    const storedEmail = typeof userData.email === "string" ?
      userData.email.trim().toLowerCase() :
      "";
    const previousEmail = typeof request.body?.previousEmail === "string" ?
      request.body.previousEmail.trim().toLowerCase() :
      storedEmail;
    const nextPartition = getDataPartitionForEmail(nextEmail);

    const batch = firestore.batch();
    batch.set(firestore.doc(`users/${uid}`), {
      email: nextEmail,
      dataPartition: nextPartition,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    if (role === "player") {
      batch.set(firestore.doc(`players/${uid}`), {
        email: nextEmail,
        dataPartition: nextPartition,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const [
      registrationSnapshot,
      paymentSnapshot,
      stalePendingSnapshot,
    ] = await Promise.all([
      firestore.collection("registrations").where("userId", "==", uid).get(),
      firestore.collection("payments").where("userId", "==", uid).get(),
      firestore.collection("managedUsers")
        .where("userId", "==", uid)
        .get(),
    ]);

    registrationSnapshot.docs.forEach((registrationDoc) => {
      batch.set(registrationDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: nextPartition,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    paymentSnapshot.docs.forEach((paymentDoc) => {
      batch.set(paymentDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: nextPartition,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    stalePendingSnapshot.docs.forEach((pendingDoc) => {
      if (pendingDoc.id !== nextEmail) {
        batch.delete(pendingDoc.ref);
      }
    });

    if (previousEmail && previousEmail !== nextEmail) {
      const previousPendingRef = firestore.doc(`managedUsers/${previousEmail}`);
      const previousPendingSnapshot = await previousPendingRef.get();
      const previousPendingData = previousPendingSnapshot.data();
      const canDeletePreviousPending =
        previousPendingData?.userId === uid ||
        previousPendingData?.isPending === true;
      if (
        previousPendingSnapshot.exists &&
        previousPendingRef.id !== nextEmail &&
        canDeletePreviousPending
      ) {
        batch.delete(previousPendingRef);
      }
    }

    await batch.commit();

    response.status(200).json({email: nextEmail});
  } catch (error) {
    logger.error("Email sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to sync email change."});
  }
});

export const changeExampleUserEmail = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const currentEmail = typeof decodedToken.email === "string" ?
      normalizeEmail(decodedToken.email) :
      "";
    const nextEmail = typeof request.body?.nextEmail === "string" ?
      normalizeEmail(request.body.nextEmail) :
      "";

    if (!currentEmail || !nextEmail) {
      response.status(400).json({
        error: "Current and next email are required.",
      });
      return;
    }

    if (getDataPartitionForEmail(currentEmail) !== "test" ||
      getDataPartitionForEmail(nextEmail) !== "test") {
      response.status(403).json({
        error: "Direct email change is only allowed for @example.com users.",
      });
      return;
    }

    const userSnapshot = await firestore.doc(`users/${uid}`).get();
    if (!userSnapshot.exists) {
      response.status(404).json({error: "User profile not found."});
      return;
    }

    const userData = userSnapshot.data() || {};
    const role = userData.role;
    await getAuth(adminApp).updateUser(uid, {email: nextEmail});

    const batch = firestore.batch();
    batch.set(firestore.doc(`users/${uid}`), {
      email: nextEmail,
      dataPartition: "test",
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    if (role === "player") {
      batch.set(firestore.doc(`players/${uid}`), {
        email: nextEmail,
        dataPartition: "test",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const [registrationSnapshot, paymentSnapshot, stalePendingSnapshot] =
      await Promise.all([
        firestore.collection("registrations").where("userId", "==", uid).get(),
        firestore.collection("payments").where("userId", "==", uid).get(),
        firestore.collection("managedUsers")
          .where("userId", "==", uid)
          .get(),
      ]);

    registrationSnapshot.docs.forEach((registrationDoc) => {
      batch.set(registrationDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: "test",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    paymentSnapshot.docs.forEach((paymentDoc) => {
      batch.set(paymentDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: "test",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    stalePendingSnapshot.docs.forEach((pendingDoc) => {
      if (pendingDoc.id !== nextEmail) {
        batch.delete(pendingDoc.ref);
      }
    });

    if (currentEmail !== nextEmail) {
      const previousPendingRef = firestore.doc(`managedUsers/${currentEmail}`);
      const previousPendingSnapshot = await previousPendingRef.get();
      if (
        previousPendingSnapshot.exists &&
        previousPendingRef.id !== nextEmail
      ) {
        batch.delete(previousPendingRef);
      }
    }

    await batch.commit();

    response.status(200).json({email: nextEmail});
  } catch (error) {
    logger.error("Direct example email change failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to change example user email."});
  }
});

export const linkRegisteredUserData = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const signedInEmail = typeof decodedToken.email === "string" ?
      normalizeEmail(decodedToken.email) :
      "";
    if (!signedInEmail) {
      response.status(400).json({error: "Authenticated email is required."});
      return;
    }

    const partition = getDataPartitionForEmail(signedInEmail);
    const userRef = firestore.doc(`users/${uid}`);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      response.status(404).json({error: "Registered user profile not found."});
      return;
    }

    const userData = userSnapshot.data() || {};
    const displayName = typeof userData.displayName === "string" &&
      userData.displayName.trim() ?
      userData.displayName.trim() :
      signedInEmail;

    const roleCandidates = [userData.role];
    const statusCandidates = [userData.status];

    const legacyUserIds = new Set<string>();
    legacyUserIds.add(signedInEmail);

    const sameEmailUsersSnapshot = await firestore.collection("users")
      .where("email", "==", signedInEmail)
      .where("dataPartition", "==", partition)
      .get();

    sameEmailUsersSnapshot.docs.forEach((legacyDoc) => {
      if (legacyDoc.id === uid) return;
      const legacyData = legacyDoc.data();
      roleCandidates.push(legacyData.role);
      statusCandidates.push(legacyData.status);
      legacyUserIds.add(legacyDoc.id);
    });

    const managedRef = firestore.doc(`managedUsers/${signedInEmail}`);
    const managedSnapshot = await managedRef.get();
    if (managedSnapshot.exists) {
      const managedData = managedSnapshot.data() || {};
      roleCandidates.push(managedData.role);
      statusCandidates.push(managedData.status);
      if (typeof managedData.userId === "string" &&
        managedData.userId &&
        managedData.userId !== uid) {
        legacyUserIds.add(managedData.userId);
      }
    }

    const preferredRole = roleCandidates
      .filter((value): value is string => typeof value === "string")
      .sort((a, b) => roleRank(b) - roleRank(a))[0] || "player";

    const mergedStatus = statusCandidates.includes("inactive") ?
      "inactive" :
      "active";

    await userRef.set({
      displayName,
      email: signedInEmail,
      role: preferredRole,
      status: mergedStatus,
      dataPartition: partition,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    const legacyIds = Array.from(legacyUserIds)
      .filter((value) => value !== uid);
    const movedStats = {
      sessions: 0,
      events: 0,
      registrations: 0,
      payments: 0,
      players: 0,
      deletedUsers: 0,
      deletedManagedUsers: 0,
    };

    for (const legacyId of legacyIds) {
      const seriesSnapshot = await firestore.collection("sessions")
        .where("organiserId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const seriesDoc of seriesSnapshot.docs) {
        await seriesDoc.ref.set({
          organiserId: uid,
          organiserName: displayName,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        movedStats.sessions += 1;
      }

      const eventSnapshot = await firestore.collection("sessionEvents")
        .where("organiserId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const eventDoc of eventSnapshot.docs) {
        await eventDoc.ref.set({
          organiserId: uid,
          organiserName: displayName,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        movedStats.events += 1;
      }

      const registrationSnapshot = await firestore.collection("registrations")
        .where("userId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const registrationDoc of registrationSnapshot.docs) {
        const registration = registrationDoc.data() || {};
        const eventId = typeof registration.sessionEventId === "string" ?
          registration.sessionEventId :
          "";
        if (!eventId) continue;

        const canonicalId = buildRegistrationId(eventId, uid);
        const canonicalRef = firestore.doc(`registrations/${canonicalId}`);
        if (canonicalId !== registrationDoc.id) {
          const canonicalSnapshot = await canonicalRef.get();
          if (canonicalSnapshot.exists) {
            const canonical = canonicalSnapshot.data() || {};
            await canonicalRef.set({
              playerName: canonical.playerName || displayName,
              playerEmail: signedInEmail,
              userId: uid,
              playerPaid: !!canonical.playerPaid || !!registration.playerPaid,
              organiserPaid:
                !!canonical.organiserPaid || !!registration.organiserPaid,
              status: canonical.status || registration.status || "registered",
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
            await registrationDoc.ref.delete();
          } else {
            await canonicalRef.set({
              ...registration,
              userId: uid,
              playerName: displayName,
              playerEmail: signedInEmail,
              dataPartition: partition,
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
            await registrationDoc.ref.delete();
          }
        } else {
          await registrationDoc.ref.set({
            userId: uid,
            playerName: displayName,
            playerEmail: signedInEmail,
            dataPartition: partition,
            updatedAt: FieldValue.serverTimestamp(),
          }, {merge: true});
        }
        movedStats.registrations += 1;
      }

      const paymentsSnapshot = await firestore.collection("payments")
        .where("userId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const paymentDoc of paymentsSnapshot.docs) {
        await paymentDoc.ref.set({
          userId: uid,
          playerName: displayName,
          playerEmail: signedInEmail,
          dataPartition: partition,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        movedStats.payments += 1;
      }
    }

    const sameEmailPlayersSnapshot = await firestore.collection("players")
      .where("email", "==", signedInEmail)
      .where("dataPartition", "==", partition)
      .get();

    let inheritedSkillLevel: string | null = null;
    let inheritedStatus = "active";
    for (const playerDoc of sameEmailPlayersSnapshot.docs) {
      const player = playerDoc.data() || {};
      if (!inheritedSkillLevel && typeof player.skillLevel === "string") {
        inheritedSkillLevel = player.skillLevel;
      }
      if (player.status === "inactive") {
        inheritedStatus = "inactive";
      }

      if (playerDoc.id === uid) {
        await playerDoc.ref.set({
          ownerOrganiserId: null,
          userId: uid,
          displayName,
          email: signedInEmail,
          dataPartition: partition,
          source: "self-registered",
          status: inheritedStatus,
          skillLevel: inheritedSkillLevel,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        continue;
      }

      const legacyPlayerId = playerDoc.id;
      const registrationsSnapshot = await firestore.collection("registrations")
        .where("userId", "==", legacyPlayerId)
        .where("dataPartition", "==", partition)
        .get();
      for (const registrationDoc of registrationsSnapshot.docs) {
        await registrationDoc.ref.set({
          userId: uid,
          playerName: displayName,
          playerEmail: signedInEmail,
          dataPartition: partition,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }

      const legacyPaymentsSnapshot = await firestore.collection("payments")
        .where("userId", "==", legacyPlayerId)
        .where("dataPartition", "==", partition)
        .get();
      for (const paymentDoc of legacyPaymentsSnapshot.docs) {
        await paymentDoc.ref.set({
          userId: uid,
          playerName: displayName,
          playerEmail: signedInEmail,
          dataPartition: partition,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }

      await playerDoc.ref.delete();
      movedStats.players += 1;
    }

    await firestore.doc(`players/${uid}`).set({
      ownerOrganiserId: null,
      userId: uid,
      displayName,
      email: signedInEmail,
      dataPartition: partition,
      source: "self-registered",
      status: inheritedStatus,
      skillLevel: inheritedSkillLevel,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    for (const legacyId of legacyIds) {
      const legacyUserRef = firestore.doc(`users/${legacyId}`);
      const legacyUserSnapshot = await legacyUserRef.get();
      if (legacyUserSnapshot.exists) {
        await legacyUserRef.delete();
        movedStats.deletedUsers += 1;
      }

      const legacyManagedRef = firestore.doc(`managedUsers/${legacyId}`);
      const legacyManagedSnapshot = await legacyManagedRef.get();
      if (legacyManagedSnapshot.exists) {
        await legacyManagedRef.delete();
        movedStats.deletedManagedUsers += 1;
      }
    }

    const managedByUidSnapshot = await firestore.collection("managedUsers")
      .where("userId", "==", uid)
      .get();
    for (const managedDoc of managedByUidSnapshot.docs) {
      await managedDoc.ref.delete();
      movedStats.deletedManagedUsers += 1;
    }

    response.status(200).json({
      uid,
      email: signedInEmail,
      role: preferredRole,
      status: mergedStatus,
      movedStats,
    });
  } catch (error) {
    logger.error("Registered user linking failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to link registered user data."});
  }
});

export const lookupPendingUserProfile = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const signedInEmail = typeof decodedToken.email === "string" ?
      decodedToken.email.trim().toLowerCase() :
      "";

    if (!signedInEmail) {
      response.status(400).json({
        error: "Authenticated user email is required.",
      });
      return;
    }

    const pendingSnapshot = await firestore
      .doc(`managedUsers/${signedInEmail}`)
      .get();
    if (!pendingSnapshot.exists) {
      response.status(200).json({});
      return;
    }

    const pendingData = pendingSnapshot.data();
    if (!pendingData?.isPending) {
      response.status(200).json({});
      return;
    }

    response.status(200).json({
      displayName: pendingData.displayName || "",
      email: pendingData.email || signedInEmail,
      role: pendingData.role || "player",
      status: pendingData.status || "active",
    });
  } catch (error) {
    logger.error("Pending user lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to resolve pending user role."});
  }
});

export const sendNotificationTest = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const channel = request.body?.channel === "email" ? "email" : "telegram";
    const [userSnapshot, preferencesSnapshot] = await Promise.all([
      firestore.doc(`users/${uid}`).get(),
      firestore.doc(`notificationPreferences/${uid}`).get(),
    ]);

    if (!userSnapshot.exists) {
      response.status(404).json({error: "User profile not found."});
      return;
    }

    if (!preferencesSnapshot.exists) {
      response.status(400).json({
        error: "Save your notification preferences before sending a test.",
      });
      return;
    }

    const userData = userSnapshot.data() || {};
    const preferences = preferencesSnapshot.data() || {};
    const recipientEmail = typeof userData.email === "string" ?
      userData.email.trim().toLowerCase() :
      "";
    const recipientDisplayName = typeof userData.displayName === "string" &&
      userData.displayName.trim() ?
      userData.displayName.trim() :
      recipientEmail || uid;
    const dataPartition = typeof userData.dataPartition === "string" &&
      userData.dataPartition === "test" ?
      "test" :
      "live";

    if (channel === "telegram") {
      const telegramEnabled = preferences?.telegram?.enabled === true;
      const telegramChatId = typeof preferences?.telegram?.chatId === "string" ?
        preferences.telegram.chatId.trim() :
        "";

      if (!telegramEnabled) {
        response.status(400).json({
          error: "Enable Telegram notifications in Profile first.",
        });
        return;
      }

      if (!telegramChatId) {
        response.status(400).json({
          error: "Telegram chat ID is required before sending a test.",
        });
        return;
      }
    }

    if (channel === "email") {
      if (!EMAIL_NOTIFICATIONS_ENABLED) {
        response.status(403).json({
          error: "Email notifications are currently disabled.",
        });
        return;
      }

      const emailEnabled = preferences?.email?.enabled === true;
      if (!emailEnabled) {
        response.status(400).json({
          error: "Enable email notifications in Profile first.",
        });
        return;
      }

      if (!recipientEmail) {
        response.status(400).json({
          error: "A profile email is required before sending an email test.",
        });
        return;
      }
    }

    const eventId = `manual_test_${channel}_${Date.now()}`;
    await firestore.doc(`notificationEvents/${eventId}`).set({
      title:
        channel === "telegram" ?
          "Community Sports Telegram test" :
          "Community Sports email test",
      body:
        `Hi ${recipientDisplayName}, this is a test ${channel} notification ` +
        "from your Community Sports profile settings.",
      recipientUserId: uid,
      recipientEmail,
      dataPartition,
      sourceCollection: "manual",
      sourceId: eventId,
      idempotencyKey: eventId,
      channels: {
        email: channel === "email",
        telegram: channel === "telegram",
      },
      telegramChatId:
        channel === "telegram" &&
        typeof preferences?.telegram?.chatId === "string" ?
          preferences.telegram.chatId.trim() :
          null,
      telegramChatType: channel === "telegram" ? "private" : null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    response.status(200).json({
      queued: true,
      eventId,
      channel,
    });
  } catch (error) {
    logger.error("Notification test queueing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({
      error: "Failed to queue the test notification.",
    });
  }
});

export {
  deliverNotificationEvent,
  queueApprovalApprovedNotification,
  queueApprovalRequestedNotification,
  queueNewEventOpenedNotifications,
  queuePaymentDueSoonNotifications,
  queueRegistrationCreatedNotification,
  queueRegistrationDeletedNotification,
  queueRegistrationUpdatedNotifications,
} from "./notifications.js";
