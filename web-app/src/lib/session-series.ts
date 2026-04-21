import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { DayOfWeek, TypeOfSport } from "./session-options";

type DataPartition = "test" | "live";

function normalizeSkipDates(skipDates: string[], maxEntries = 104) {
  return Array.from(new Set(
    skipDates
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort((a, b) => a.localeCompare(b)),
  )).slice(-maxEntries);
}

function planEventRegistrations(input: {
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
    skipNextEvent?: boolean;
    joinedOrder?: number;
  }>;
  previousRegistrations: Array<{
    userId: string;
    playerName: string;
    playerEmail: string;
    createdOrder?: number;
  }>;
}) {
  const plannedRegistrations: Array<{
    userId: string;
    playerName: string;
    playerEmail: string;
    source: "series-membership" | "roster-copy";
    seriesMembershipId?: string | null;
    playerPaid: boolean;
    organiserPaid: boolean;
    status: "registered" | "waiting";
  }> = [];
  const skippedMembershipIds: string[] = [];
  const reservedMembershipPlayerIds = new Set<string>();

  const pushPlannedRegistration = (entry: {
    userId: string;
    playerName: string;
    playerEmail: string;
    source: "series-membership" | "roster-copy";
    seriesMembershipId?: string | null;
    playerPaid?: boolean;
    organiserPaid?: boolean;
  }) => {
    const bookedCount = plannedRegistrations.filter((item) => item.status === "registered").length;
    const waitingCount = plannedRegistrations.filter((item) => item.status === "waiting").length;
    const waitingListCapacity = Math.max(0, input.waitingListCapacity || 0);
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
        reservedMembershipPlayerIds.add(membership.playerId);
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
      reservedMembershipPlayerIds.add(membership.playerId);

      pushPlannedRegistration({
        userId: membership.playerId,
        playerName: membership.playerName,
        playerEmail: membership.playerEmail,
        source: "series-membership",
        seriesMembershipId: membership.id,
        playerPaid: shouldAutoPay,
        organiserPaid: shouldAutoPay,
      });
    });

  input.previousRegistrations
    .slice()
    .sort((a, b) => {
      const aOrder = a.createdOrder ?? 0;
      const bOrder = b.createdOrder ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.playerName.localeCompare(b.playerName);
    })
    .forEach((registration) => {
      if (reservedMembershipPlayerIds.has(registration.userId)) {
        return;
      }

      if (plannedRegistrations.some((item) => item.userId === registration.userId)) {
        return;
      }

      pushPlannedRegistration({
        userId: registration.userId,
        playerName: registration.playerName,
        playerEmail: registration.playerEmail,
        source: "roster-copy",
        seriesMembershipId: null,
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

export function getRegistrationCapacityState(input: {
  capacity: number;
  waitingListCapacity?: number;
  bookedCount?: number;
  waitingCount?: number;
}): RegistrationCapacityState {
  const capacity = Math.max(0, input.capacity || 0);
  const waitingListCapacity = Math.max(0, input.waitingListCapacity || 0);
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

export async function createSessionEventForSeries(
  db: Firestore,
  series: SessionSeries,
  eventDate = series.nextGameOn,
) {
  if (!eventDate) {
    throw new Error("Session series is missing nextGameOn.");
  }

  const eventId = buildSessionEventId(series.id, eventDate);
  const eventRef = doc(db, "sessionEvents", eventId);
  const sameSeriesEventsSnapshot = await getDocs(
    query(
      collection(db, "sessionEvents"),
      where("sessionSeriesId", "==", series.id),
      where("dataPartition", "==", series.dataPartition || "live"),
    ),
  );

  const eventAlreadyExists = sameSeriesEventsSnapshot.docs.some((eventDoc) => {
    const data = eventDoc.data() as Omit<SessionEvent, "id">;
    return eventDoc.id === eventId || data.eventDate === eventDate;
  });

  if (eventAlreadyExists) {
    return eventId;
  }

  const currentActiveEvent = sameSeriesEventsSnapshot.docs
    .map((eventDoc) => ({
      id: eventDoc.id,
      ...(eventDoc.data() as Omit<SessionEvent, "id">),
    }))
    .filter((event) => event.eventDate < eventDate && event.status !== "completed" && event.status !== "cancelled")
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .at(-1);

  await setDoc(eventRef, {
    sessionSeriesId: series.id,
    organiserId: series.organiserId,
    organiserName: series.organiserName || "Organiser",
    title: series.title,
    typeOfSport: series.typeOfSport,
    location: series.location,
    dayOfWeek: series.dayOfWeek,
    eventDate,
    startAt: series.startAt,
    endAt: series.endAt,
    defaultPriceCasual: series.defaultPriceCasual,
    capacity: series.capacity,
    waitingListCapacity: series.waitingListCapacity || 0,
    dataPartition: series.dataPartition,
    bookedCount: 0,
    waitingCount: 0,
    status: "active",
    createdAt: serverTimestamp(),
  });

  if (currentActiveEvent) {
    await updateDoc(doc(db, "sessionEvents", currentActiveEvent.id), {
      status: "completed",
    });
  }

  const previousEventsSnapshot = await getDocs(
    query(
      collection(db, "sessionEvents"),
      where("sessionSeriesId", "==", series.id),
      where("dataPartition", "==", series.dataPartition || "live"),
    ),
  );

  const previousEvents = previousEventsSnapshot.docs
    .map((eventDoc) => ({
      id: eventDoc.id,
      ...(eventDoc.data() as Omit<SessionEvent, "id">),
    }))
    .filter((event) => event.id !== eventId && event.eventDate < eventDate)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const lastEvent = previousEvents.at(-1);
  const previousRegistrations = lastEvent && series.copyRosterFromLastEvent
    ? await getDocs(
      query(
        collection(db, "registrations"),
        where("sessionEventId", "==", lastEvent.id),
        where("dataPartition", "==", series.dataPartition || "live"),
      ),
    )
    : null;
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
        approvedAtDate?: string | null;
        skipNextEvent?: boolean;
        skipCount?: number;
        skipDates?: string[];
        createdAt?: unknown;
      },
    ]),
  );

  const { plannedRegistrations, skippedMembershipIds } = planEventRegistrations({
    eventDate,
    capacity: series.capacity,
    waitingListCapacity: series.waitingListCapacity || 0,
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
        skipNextEvent: !!membership.skipNextEvent,
        joinedOrder: getTimestampMillis(membership.createdAt),
      })),
    previousRegistrations: (previousRegistrations?.docs || []).map((registrationDoc) => {
      const registration = registrationDoc.data() as Omit<RegistrationItem, "id">;
      return {
        userId: registration.userId,
        playerName: registration.playerName,
        playerEmail: registration.playerEmail,
        createdOrder: getTimestampMillis(registration.createdAt),
      };
    }),
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
      eventDate,
      startAt: series.startAt,
      endAt: series.endAt,
      defaultPriceCasual: series.defaultPriceCasual,
      capacity: series.capacity,
      waitingListCapacity: series.waitingListCapacity || 0,
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
      paymentReference: null,
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
        eventDate,
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

  return eventId;
}
