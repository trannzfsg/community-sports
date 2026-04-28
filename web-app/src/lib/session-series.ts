import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { DayOfWeek, TypeOfSport } from "./session-options";

type DataPartition = "test" | "live";

export const UNLIMITED_WAITING_LIST_CAPACITY = 100;

const DAY_TO_INDEX: Record<DayOfWeek, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 0,
};

export function normalizeWaitingListCapacity(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return UNLIMITED_WAITING_LIST_CAPACITY;
  }

  if (typeof value === "string" && value.trim() === "") {
    return UNLIMITED_WAITING_LIST_CAPACITY;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return UNLIMITED_WAITING_LIST_CAPACITY;
  }

  const capacity = Math.floor(parsed);
  return capacity <= 0 ? UNLIMITED_WAITING_LIST_CAPACITY : capacity;
}

export function getWaitingListCapacityInputValue(value: number | string | null | undefined) {
  const capacity = normalizeWaitingListCapacity(value);
  return capacity === UNLIMITED_WAITING_LIST_CAPACITY ? "" : String(capacity);
}

export function formatWaitingListCapacity(value: number | string | null | undefined) {
  const capacity = normalizeWaitingListCapacity(value);
  return capacity === UNLIMITED_WAITING_LIST_CAPACITY ? "Unlimited" : String(capacity);
}

function normalizeSkipDates(skipDates: string[], maxEntries = 104) {
  return Array.from(new Set(
    skipDates
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort((a, b) => a.localeCompare(b)),
  )).slice(-maxEntries);
}

function formatDateLocal(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateText: string) {
  const [yearText = "0", monthText = "1", dayText = "1"] = dateText.split("-");
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function addDays(dateText: string, days: number) {
  const date = parseLocalDate(dateText);
  date.setDate(date.getDate() + days);
  return formatDateLocal(date);
}

function getNextDateForDayOfWeekAfterToday(
  dayOfWeek: DayOfWeek,
  from = new Date(),
) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const currentDayIndex = start.getDay();
  const targetDayIndex = DAY_TO_INDEX[dayOfWeek];

  let daysAhead = (targetDayIndex - currentDayIndex + 7) % 7;
  if (daysAhead === 0) {
    daysAhead = 7;
  }

  start.setDate(start.getDate() + daysAhead);
  return formatDateLocal(start);
}

function parseBrisbaneDateTime(dateText: string, timeText: string) {
  const [yearText = "0", monthText = "1", dayText = "1"] = dateText.split("-");
  const [hourText = "0", minuteText = "0"] = timeText.split(":");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    Number.isNaN(year)
    || Number.isNaN(month)
    || Number.isNaN(day)
    || Number.isNaN(hour)
    || Number.isNaN(minute)
  ) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - 10, minute, 0, 0));
}

export function getEffectiveCancellationPolicyHours(
  cancellationPolicyHours?: number | null,
) {
  if (typeof cancellationPolicyHours !== "number" || Number.isNaN(cancellationPolicyHours)) {
    return 24;
  }

  return Math.max(0, Math.floor(cancellationPolicyHours));
}

export function isCancellationPolicyActive(input: {
  eventDate: string;
  startAt: string;
  cancellationPolicyHours?: number | null;
  now?: Date;
}) {
  const hours = getEffectiveCancellationPolicyHours(input.cancellationPolicyHours);
  if (hours === 0) {
    return false;
  }

  const eventStart = parseBrisbaneDateTime(input.eventDate, input.startAt);
  if (!eventStart) {
    return false;
  }

  return eventStart.getTime() - (input.now || new Date()).getTime() <= hours * 60 * 60 * 1000;
}

export function getCancellationPolicyLabel(cancellationPolicyHours?: number | null) {
  const hours = getEffectiveCancellationPolicyHours(cancellationPolicyHours);
  if (hours === 0) {
    return "No cancellation cutoff";
  }

  return `${hours} hour${hours === 1 ? "" : "s"} before start`;
}

export function getPlayerCancellationPolicyMessage(cancellationPolicyHours?: number | null) {
  const hours = getEffectiveCancellationPolicyHours(cancellationPolicyHours);
  if (hours === 0) {
    return "";
  }

  return `This event is already inside the ${hours}-hour cancellation window. Please contact the organiser if you still need to cancel.`;
}

export function getOrganiserCancellationPolicyWarning(
  playerName: string,
  cancellationPolicyHours?: number | null,
) {
  const hours = getEffectiveCancellationPolicyHours(cancellationPolicyHours);
  if (hours === 0) {
    return "";
  }

  return `This event is already inside the ${hours}-hour cancellation window. Remove ${playerName} anyway?`;
}

export function resolveNextSessionEventDate(
  requestedEventDate: string,
  existingEventDates: string[],
) {
  const knownDates = new Set(existingEventDates);
  let candidateDate = requestedEventDate;

  while (knownDates.has(candidateDate)) {
    candidateDate = addDays(candidateDate, 7);
  }

  return candidateDate;
}

type EventCreationCandidate = Pick<SessionEvent, "id" | "eventDate" | "status">;

export function getDefaultNextSessionEventDate(
  series: Pick<SessionSeries, "dayOfWeek">,
  from = new Date(),
) {
  return getNextDateForDayOfWeekAfterToday(series.dayOfWeek, from);
}

export function getActiveEventBlockingNextEventCreation(events: EventCreationCandidate[]) {
  return events
    .filter((event) => (event.status || "active") === "active")
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .at(0);
}

export function getCancelledEventForDate(
  events: EventCreationCandidate[],
  eventDate: string,
) {
  return events.find(
    (event) => event.eventDate === eventDate && event.status === "cancelled",
  );
}

export function getExistingNonCancelledEventForDate(
  events: EventCreationCandidate[],
  eventDate: string,
) {
  return events.find(
    (event) => event.eventDate === eventDate && event.status !== "cancelled",
  );
}

export function planEventRegistrations(input: {
  eventDate: string;
  capacity: number;
  waitingListCapacity?: number;
  activeMemberships: Array<{
    id: string;
    playerId: string;
    playerName: string;
    playerEmail: string;
    status: "pending" | "active" | "paused" | "cancelled" | "rejected";
    startDate?: string | null;
    endDate?: string | null;
    autoPaidUntilDate?: string | null;
    playerPaid?: boolean;
    organiserReceived?: boolean;
    organiserPaid?: boolean;
    paymentReference?: string | null;
    skipNextEvent?: boolean;
    joinedOrder?: number;
  }>;
}) {
  const plannedRegistrations: Array<{
    userId: string;
    playerName: string;
    playerEmail: string;
    source: "series-membership";
    seriesMembershipId?: string | null;
    playerPaid: boolean;
    organiserPaid: boolean;
    paymentReference?: string | null;
    status: "registered" | "waiting";
  }> = [];
  const skippedMembershipIds: string[] = [];

  const pushPlannedRegistration = (entry: {
    userId: string;
    playerName: string;
    playerEmail: string;
    source: "series-membership";
    seriesMembershipId?: string | null;
    playerPaid?: boolean;
    organiserPaid?: boolean;
    paymentReference?: string | null;
  }) => {
    const bookedCount = plannedRegistrations.filter((item) => item.status === "registered").length;
    const waitingCount = plannedRegistrations.filter((item) => item.status === "waiting").length;
    const waitingListCapacity = normalizeWaitingListCapacity(input.waitingListCapacity);
    const nextStatus: "registered" | "waiting" | null = bookedCount < input.capacity
      ? "registered"
      : waitingCount < waitingListCapacity
        ? "waiting"
        : null;

    if (!nextStatus) {
      return;
    }

    plannedRegistrations.push({
      ...entry,
      playerPaid: entry.playerPaid ?? false,
      organiserPaid: entry.organiserPaid ?? false,
      paymentReference: entry.paymentReference ?? null,
      status: nextStatus,
    });
  };

  input.activeMemberships
    .slice()
    .sort((a, b) => {
      const aOrder = a.joinedOrder ?? 0;
      const bOrder = b.joinedOrder ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.playerName.localeCompare(b.playerName);
    })
    .forEach((membership) => {
      if (membership.skipNextEvent) {
        skippedMembershipIds.push(membership.id);
        return;
      }

      if (membership.status !== "active") {
        return;
      }

      if (membership.startDate && input.eventDate < membership.startDate) {
        return;
      }

      if (membership.endDate && input.eventDate > membership.endDate) {
        return;
      }

      const shouldAutoPay = !!membership.autoPaidUntilDate && input.eventDate <= membership.autoPaidUntilDate;
      const playerPaid = membership.playerPaid ?? shouldAutoPay;
      const organiserReceived = membership.organiserReceived ?? membership.organiserPaid ?? shouldAutoPay;

      pushPlannedRegistration({
        userId: membership.playerId,
        playerName: membership.playerName,
        playerEmail: membership.playerEmail,
        source: "series-membership",
        seriesMembershipId: membership.id,
        playerPaid,
        organiserPaid: organiserReceived,
        paymentReference: membership.paymentReference ?? null,
      });
    });

  return {
    plannedRegistrations,
    skippedMembershipIds,
  };
}

export type SessionSeries = {
  id: string;
  title: string;
  typeOfSport: TypeOfSport;
  location: string;
  dayOfWeek: DayOfWeek;
  nextGameOn?: string;
  startAt: string;
  endAt: string;
  firstSessionOn: string;
  defaultPriceCasual: number;
  capacity: number;
  waitingListCapacity?: number;
  cancellationPolicyHours?: number | null;
  organiserId: string;
  organiserName?: string;
  dataPartition?: DataPartition;
  status: string;
  copyRosterFromLastEvent?: boolean;
  seriesMembershipEnabled?: boolean;
  seriesMembershipDefaultStartDate?: string | null;
  seriesMembershipDefaultEndDate?: string | null;
  seriesMembershipAutoPaidUntilDate?: string | null;
};

export type SessionEvent = {
  id: string;
  sessionSeriesId: string;
  organiserId: string;
  organiserName?: string;
  title: string;
  typeOfSport: TypeOfSport;
  location: string;
  dayOfWeek: DayOfWeek;
  eventDate: string;
  startAt: string;
  endAt: string;
  defaultPriceCasual: number;
  capacity: number;
  waitingListCapacity?: number;
  bookedCount: number;
  waitingCount?: number;
  dataPartition?: DataPartition;
  status: string;
  locked?: boolean;
};

export type RegistrationItem = {
  id: string;
  sessionEventId: string;
  sessionSeriesId: string;
  userId: string;
  playerName: string;
  playerEmail: string;
  dataPartition?: DataPartition;
  playerPaid: boolean;
  organiserPaid: boolean;
  paymentReference?: string | null;
  status?: "registered" | "waiting";
  source?: "self" | "organiser" | "roster-copy" | "series-membership";
  seriesMembershipId?: string | null;
  createdAt?: unknown;
};

export type RegistrationCapacityState = {
  capacity: number;
  waitingListCapacity: number;
  bookedCount: number;
  waitingCount: number;
  totalCount: number;
  totalCapacity: number;
  eventIsFull: boolean;
  waitingListEnabled: boolean;
  waitingListIsFull: boolean;
  canAddMore: boolean;
  nextRegistrationStatus: "registered" | "waiting" | null;
};

export type SessionEventOverridesInput = {
  location: string;
  startAt: string;
  endAt: string;
  defaultPriceCasual: number;
  capacity: number;
  waitingListCapacity?: number | null;
};

export function buildSessionEventId(seriesId: string, eventDate: string) {
  return `${seriesId}__${eventDate.replaceAll("-", "")}`;
}

export function buildRegistrationId(eventId: string, userId: string) {
  return `${eventId}__${encodeURIComponent(userId).replaceAll("%", "_")}`;
}

function buildPaymentId(registrationId: string) {
  return `payment__${registrationId}`;
}

async function syncPaymentRecordForRegistration(
  db: Firestore,
  series: SessionSeries,
  eventItem: SessionEvent,
  registration: RegistrationItem,
) {
  const effectivePaid = !!(registration.playerPaid || registration.organiserPaid);
  await setDoc(doc(db, "payments", buildPaymentId(registration.id)), {
    sessionSeriesId: registration.sessionSeriesId,
    sessionEventId: registration.sessionEventId,
    registrationId: registration.id,
    organiserId: eventItem.organiserId || series.organiserId,
    userId: registration.userId,
    playerName: registration.playerName,
    playerEmail: registration.playerEmail,
    dataPartition: registration.dataPartition || series.dataPartition,
    amount: eventItem.defaultPriceCasual ?? series.defaultPriceCasual,
    playerPaid: !!registration.playerPaid,
    organiserPaid: !!registration.organiserPaid,
    paymentReference: registration.paymentReference ?? null,
    effectivePaid,
    status: effectivePaid ? "paid" : "pending",
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function clearEventRegistrationsAndPayments(
  db: Firestore,
  sessionEventId: string,
  dataPartition?: DataPartition,
) {
  const registrationsSnapshot = await getDocs(
    dataPartition
      ? query(collection(db, "registrations"), where("sessionEventId", "==", sessionEventId), where("dataPartition", "==", dataPartition))
      : query(collection(db, "registrations"), where("sessionEventId", "==", sessionEventId)),
  );

  for (const registrationDoc of registrationsSnapshot.docs) {
    await deleteDoc(doc(db, "payments", buildPaymentId(registrationDoc.id)));
    await deleteDoc(registrationDoc.ref);
  }
}

export function getRegistrationCapacityState(input: {
  capacity: number;
  waitingListCapacity?: number;
  bookedCount?: number;
  waitingCount?: number;
}): RegistrationCapacityState {
  const capacity = Math.max(0, input.capacity || 0);
  const waitingListCapacity = normalizeWaitingListCapacity(input.waitingListCapacity);
  const bookedCount = Math.max(0, input.bookedCount || 0);
  const waitingCount = Math.max(0, input.waitingCount || 0);
  const totalCount = bookedCount + waitingCount;
  const totalCapacity = capacity + waitingListCapacity;
  const eventIsFull = bookedCount >= capacity;
  const waitingListEnabled = waitingListCapacity > 0;
  const waitingListIsFull = waitingListEnabled
    ? waitingCount >= waitingListCapacity
    : eventIsFull;
  const canAddMore = totalCount < totalCapacity;

  return {
    capacity,
    waitingListCapacity,
    bookedCount,
    waitingCount,
    totalCount,
    totalCapacity,
    eventIsFull,
    waitingListEnabled,
    waitingListIsFull,
    canAddMore,
    nextRegistrationStatus: !canAddMore ? null : eventIsFull ? "waiting" : "registered",
  };
}

export function normalizeSessionEventOverrides(input: SessionEventOverridesInput) {
  const price = Number(input.defaultPriceCasual);

  return {
    location: input.location.trim(),
    startAt: input.startAt.trim(),
    endAt: input.endAt.trim(),
    defaultPriceCasual: Number.isFinite(price) ? Math.round(price * 100) / 100 : Number.NaN,
    capacity: Math.max(0, Math.floor(Number(input.capacity) || 0)),
    waitingListCapacity: normalizeWaitingListCapacity(input.waitingListCapacity),
  };
}

export function getSessionEventOverrideValidationError(input: {
  values: SessionEventOverridesInput;
  registrationCount?: number;
}) {
  const values = normalizeSessionEventOverrides(input.values);

  if (!values.location) {
    return "Event location is required.";
  }

  if (!/^\d{2}:\d{2}$/.test(values.startAt) || !/^\d{2}:\d{2}$/.test(values.endAt)) {
    return "Event start and end time must use HH:MM format.";
  }

  if (values.endAt <= values.startAt) {
    return "Event end time must be after the start time.";
  }

  if (!Number.isFinite(values.defaultPriceCasual) || values.defaultPriceCasual < 0) {
    return "Casual price must be zero or more.";
  }

  const registrationCount = Math.max(0, input.registrationCount || 0);
  if (registrationCount > values.capacity + values.waitingListCapacity) {
    return `This event already has ${registrationCount} registrations. Increase capacity or waiting list spots before saving smaller totals.`;
  }

  return "";
}

function getTimestampMillis(value: unknown) {
  if (
    typeof value === "object"
    && value !== null
    && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function rebalanceEventRegistrations(
  db: Firestore,
  sessionEventId: string,
  capacity: number,
  dataPartition?: DataPartition,
) {
  const registrationsSnapshot = await getDocs(
    dataPartition
      ? query(collection(db, "registrations"), where("sessionEventId", "==", sessionEventId), where("dataPartition", "==", dataPartition))
      : query(collection(db, "registrations"), where("sessionEventId", "==", sessionEventId)),
  );

  const registrations = registrationsSnapshot.docs
    .map((registrationDoc) => ({
      id: registrationDoc.id,
      ref: registrationDoc.ref,
      ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
    }))
    .sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));

  let bookedCount = 0;
  let waitingCount = 0;

  for (const [index, registration] of registrations.entries()) {
    const shouldBeRegistered = index < capacity;
    const nextStatus = shouldBeRegistered ? "registered" : "waiting";
    if (registration.status !== nextStatus) {
      await setDoc(registration.ref, { status: nextStatus }, { merge: true });
    }
    if (shouldBeRegistered) bookedCount += 1;
    else waitingCount += 1;
  }

  await setDoc(doc(db, "sessionEvents", sessionEventId), {
    bookedCount,
    waitingCount,
  }, { merge: true });

  return { bookedCount, waitingCount };
}

export async function updateSessionEventOverrides(
  db: Firestore,
  input: {
    series: SessionSeries;
    event: SessionEvent;
    registrations: RegistrationItem[];
    values: SessionEventOverridesInput;
  },
) {
  const values = normalizeSessionEventOverrides(input.values);
  const validationError = getSessionEventOverrideValidationError({
    values,
    registrationCount: input.registrations.length,
  });

  if (validationError) {
    throw new Error(validationError);
  }

  await setDoc(doc(db, "sessionEvents", input.event.id), {
    ...values,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const capacityChanged = values.capacity !== input.event.capacity;
  const priceChanged = values.defaultPriceCasual !== input.event.defaultPriceCasual;
  let bookedCount = input.event.bookedCount;
  let waitingCount = input.event.waitingCount ?? 0;

  if (capacityChanged) {
    const rebalancedCounts = await rebalanceEventRegistrations(
      db,
      input.event.id,
      values.capacity,
      input.event.dataPartition,
    );
    bookedCount = rebalancedCounts.bookedCount;
    waitingCount = rebalancedCounts.waitingCount;
  }

  const updatedEvent: SessionEvent = {
    ...input.event,
    ...values,
    bookedCount,
    waitingCount,
  };

  if (priceChanged) {
    for (const registration of input.registrations) {
      await syncPaymentRecordForRegistration(db, input.series, updatedEvent, registration);
    }
  }

  return updatedEvent;
}

export async function createSessionEventForSeries(
  db: Firestore,
  series: SessionSeries,
  eventDate = getDefaultNextSessionEventDate(series),
) {
  if (!eventDate) {
    throw new Error("Event series is missing an event date.");
  }

  const sameSeriesEventsSnapshot = await getDocs(
    query(
      collection(db, "sessionEvents"),
      where("sessionSeriesId", "==", series.id),
      where("dataPartition", "==", series.dataPartition || "live"),
    ),
  );
  const sameSeriesEvents = sameSeriesEventsSnapshot.docs.map((eventDoc) => ({
    id: eventDoc.id,
    ...(eventDoc.data() as Omit<SessionEvent, "id">),
  }));
  const resolvedEventDate = eventDate;
  const activeEvent = getActiveEventBlockingNextEventCreation(sameSeriesEvents);

  if (activeEvent) {
    throw new Error(`There is already an active event on ${activeEvent.eventDate}. Mark it completed or cancelled before creating the next event.`);
  }

  const conflictingEvent = getExistingNonCancelledEventForDate(sameSeriesEvents, resolvedEventDate);
  if (conflictingEvent) {
    throw new Error(`There is already a ${conflictingEvent.status || "active"} event on ${resolvedEventDate}.`);
  }

  const reusableCancelledEvent = getCancelledEventForDate(sameSeriesEvents, resolvedEventDate);
  const eventId = buildSessionEventId(series.id, resolvedEventDate);
  const eventRef = doc(db, "sessionEvents", eventId);

  if (reusableCancelledEvent) {
    await setDoc(eventRef, { locked: false }, { merge: true });
    await clearEventRegistrationsAndPayments(db, eventId, series.dataPartition);
  }

  await setDoc(eventRef, {
    sessionSeriesId: series.id,
    organiserId: series.organiserId,
    organiserName: series.organiserName || "Organiser",
    title: series.title,
    typeOfSport: series.typeOfSport,
    location: series.location,
    dayOfWeek: series.dayOfWeek,
    eventDate: resolvedEventDate,
    startAt: series.startAt,
    endAt: series.endAt,
    defaultPriceCasual: series.defaultPriceCasual,
    capacity: series.capacity,
    waitingListCapacity: normalizeWaitingListCapacity(series.waitingListCapacity),
    dataPartition: series.dataPartition,
    bookedCount: 0,
    waitingCount: 0,
    status: "active",
    locked: false,
    createdAt: serverTimestamp(),
    ...(reusableCancelledEvent ? { updatedAt: serverTimestamp() } : {}),
  });

  const seriesMembershipsSnapshot = series.seriesMembershipEnabled
    ? await getDocs(
      query(
        collection(db, "seriesMemberships"),
        where("seriesId", "==", series.id),
        where("organiserId", "==", series.organiserId),
        where("dataPartition", "==", series.dataPartition || "live"),
      ),
    )
    : null;

  const membershipsById = new Map(
    (seriesMembershipsSnapshot?.docs || []).map((membershipDoc) => [
      membershipDoc.id,
      membershipDoc.data() as {
        playerId: string;
        playerName: string;
        playerEmail: string;
        status: string;
        startDate?: string | null;
        endDate?: string | null;
        autoPaidUntilDate?: string | null;
        playerPaid?: boolean;
        organiserReceived?: boolean;
        organiserPaid?: boolean;
        paymentReference?: string | null;
        approvedAtDate?: string | null;
        skipNextEvent?: boolean;
        skipCount?: number;
        skipDates?: string[];
        createdAt?: unknown;
      },
    ]),
  );

  const { plannedRegistrations, skippedMembershipIds } = planEventRegistrations({
    eventDate: resolvedEventDate,
    capacity: series.capacity,
    waitingListCapacity: normalizeWaitingListCapacity(series.waitingListCapacity),
    activeMemberships: Array.from(membershipsById.entries())
      .map(([id, membership]) => ({
        id,
        playerId: membership.playerId,
        playerName: membership.playerName,
        playerEmail: membership.playerEmail,
        status: membership.status as "pending" | "active" | "paused" | "cancelled" | "rejected",
        startDate: membership.startDate ?? series.seriesMembershipDefaultStartDate ?? membership.approvedAtDate ?? null,
        endDate: membership.endDate ?? series.seriesMembershipDefaultEndDate ?? null,
        autoPaidUntilDate: membership.autoPaidUntilDate ?? series.seriesMembershipAutoPaidUntilDate ?? null,
        playerPaid: !!membership.playerPaid,
        organiserReceived: !!(membership.organiserReceived ?? membership.organiserPaid),
        paymentReference: membership.paymentReference ?? null,
        skipNextEvent: !!membership.skipNextEvent,
        joinedOrder: getTimestampMillis(membership.createdAt),
      })),
  });

  for (const registration of plannedRegistrations) {
    await setDoc(
      doc(db, "registrations", buildRegistrationId(eventId, registration.userId)),
      {
        sessionEventId: eventId,
        sessionSeriesId: series.id,
        userId: registration.userId,
        playerName: registration.playerName,
        playerEmail: registration.playerEmail,
        dataPartition: series.dataPartition,
        playerPaid: registration.playerPaid,
        organiserPaid: registration.organiserPaid,
        paymentReference: registration.paymentReference ?? null,
        status: registration.status,
        source: registration.source,
        seriesMembershipId: registration.seriesMembershipId || null,
        createdAt: serverTimestamp(),
      },
    );

    await syncPaymentRecordForRegistration(db, series, {
      id: eventId,
      sessionSeriesId: series.id,
      organiserId: series.organiserId,
      organiserName: series.organiserName,
      title: series.title,
      typeOfSport: series.typeOfSport,
      location: series.location,
      dayOfWeek: series.dayOfWeek,
      eventDate: resolvedEventDate,
      startAt: series.startAt,
      endAt: series.endAt,
      defaultPriceCasual: series.defaultPriceCasual,
      capacity: series.capacity,
      waitingListCapacity: normalizeWaitingListCapacity(series.waitingListCapacity),
      bookedCount: 0,
      waitingCount: 0,
      dataPartition: series.dataPartition,
      status: "active",
    }, {
      id: buildRegistrationId(eventId, registration.userId),
      sessionEventId: eventId,
      sessionSeriesId: series.id,
      userId: registration.userId,
      playerName: registration.playerName,
      playerEmail: registration.playerEmail,
      dataPartition: series.dataPartition,
      playerPaid: registration.playerPaid,
      organiserPaid: registration.organiserPaid,
      paymentReference: registration.paymentReference ?? null,
      status: registration.status,
      source: registration.source,
      seriesMembershipId: registration.seriesMembershipId || null,
      createdAt: undefined,
    });
  }

  for (const membershipId of skippedMembershipIds) {
    const existingMembership = membershipsById.get(membershipId);
    if (!existingMembership) continue;

    await setDoc(doc(db, "seriesMemberships", membershipId), {
      skipNextEvent: false,
      skipCount: Math.max(0, existingMembership.skipCount || 0) + 1,
      skipDates: normalizeSkipDates([
        ...(existingMembership.skipDates || []),
        resolvedEventDate,
      ]),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  for (const registration of plannedRegistrations.filter((item) => item.source === "series-membership" && item.seriesMembershipId)) {
    await setDoc(doc(db, "seriesMemberships", String(registration.seriesMembershipId)), {
      lastAutoRegisteredEventId: eventId,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  await setDoc(eventRef, {
    bookedCount: plannedRegistrations.filter((registration) => registration.status === "registered").length,
    waitingCount: plannedRegistrations.filter((registration) => registration.status === "waiting").length,
  }, { merge: true });

  return {
    eventDate: resolvedEventDate,
    eventId,
  };
}
