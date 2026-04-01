import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  bookedCount: number;
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
  createdAt?: unknown;
};

export function buildSessionEventId(seriesId: string, eventDate: string) {
  return `${seriesId}__${eventDate.replaceAll("-", "")}`;
}

export function buildRegistrationId(eventId: string, userId: string) {
  return `${eventId}__${encodeURIComponent(userId).replaceAll("%", "_")}`;
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
  const existingEvent = await getDoc(eventRef);

  if (existingEvent.exists()) {
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
    bookedCount: 0,
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
            createdAt: serverTimestamp(),
          },
        );
        copiedCount += 1;
      }
    }
  }

  if (copiedCount > 0) {
    await updateDoc(eventRef, {
      bookedCount: copiedCount,
    });
  }

  return eventId;
}
