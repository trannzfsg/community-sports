import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { DayOfWeek, TypeOfSport } from "@/lib/session-options";

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
  status: string;
  copyRosterFromLastEvent?: boolean;
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
  status: string;
};

export type RegistrationItem = {
  id: string;
  sessionEventId: string;
  sessionSeriesId: string;
  userId: string;
  playerName: string;
  playerEmail: string;
  playerPaid: boolean;
  organiserPaid: boolean;
  status?: "registered" | "waiting";
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
) {
  const registrationsSnapshot = await getDocs(
    query(collection(db, "registrations"), where("sessionEventId", "==", sessionEventId)),
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
    ),
  );

  const eventAlreadyExists = sameSeriesEventsSnapshot.docs.some((eventDoc) => {
    const data = eventDoc.data() as Omit<SessionEvent, "id">;
    return eventDoc.id === eventId || data.eventDate === eventDate;
  });

  if (eventAlreadyExists) {
    return eventId;
  }

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
    bookedCount: 0,
    waitingCount: 0,
    status: series.status,
    createdAt: serverTimestamp(),
  });

  let copiedCount = 0;

  if (series.copyRosterFromLastEvent) {
    const previousEventsSnapshot = await getDocs(
      query(
        collection(db, "sessionEvents"),
        where("sessionSeriesId", "==", series.id),
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

    if (lastEvent) {
      const previousRegistrationsSnapshot = await getDocs(
        query(
          collection(db, "registrations"),
          where("sessionEventId", "==", lastEvent.id),
        ),
      );

      for (const registrationDoc of previousRegistrationsSnapshot.docs) {
        const registration = registrationDoc.data() as Omit<RegistrationItem, "id">;
        await setDoc(
          doc(db, "registrations", buildRegistrationId(eventId, registration.userId)),
          {
            sessionEventId: eventId,
            sessionSeriesId: series.id,
            userId: registration.userId,
            playerName: registration.playerName,
            playerEmail: registration.playerEmail,
            playerPaid: false,
            organiserPaid: false,
            status: "registered",
            createdAt: serverTimestamp(),
          },
        );
        copiedCount += 1;
      }
    }
  }

  if (copiedCount > 0) {
    await rebalanceEventRegistrations(db, eventId, series.capacity);
  }

  return eventId;
}
