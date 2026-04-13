import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { splitOrganiserVisiblePlayers } from "./organiser-visible-players";
import { normalizePlayerEmail, type PlayerDirectoryEntry } from "@/lib/players";
import type { RegistrationItem, SessionEvent } from "@/lib/session-series";

export type OrganiserGameCount = {
  organiserId: string;
  organiserName: string;
  gamesPlayed: number;
};

export type OrganiserVisiblePlayerRecord = {
  key: string;
  displayName: string;
  email: string;
  skillLevel: PlayerDirectoryEntry["skillLevel"];
  gamesPlayed: number;
  playerId: string | null;
  userId: string | null;
  ownerOrganiserId: string | null;
  isSelfRegistered: boolean;
  isEditablePrivatePlayer: boolean;
  hasRegisteredForOrganiser: boolean;
};

function isPlayedRegistration(registration: RegistrationItem) {
  return registration.status !== "waiting" && registration.organiserPaid;
}

function buildFallbackPlayerKey(registration: RegistrationItem) {
  const normalizedEmail = normalizePlayerEmail(registration.playerEmail || "");
  return normalizedEmail || registration.userId || registration.id;
}

function buildVisiblePlayerKey(input: {
  email?: string | null;
  fallback: string;
}) {
  return normalizePlayerEmail(input.email || "") || input.fallback;
}

export async function linkManualPlayersToSelfRegisteredUser(
  db: Firestore,
  userId: string,
  email: string,
) {
  const normalizedEmail = normalizePlayerEmail(email);
  if (!normalizedEmail) return;

  const snapshot = await getDocs(
    query(collection(db, "players"), where("email", "==", normalizedEmail)),
  );

  await Promise.all(
    snapshot.docs
      .filter((playerDoc) => {
        const data = playerDoc.data() as Omit<PlayerDirectoryEntry, "id">;
        return data.ownerOrganiserId != null && !data.userId;
      })
      .map((playerDoc) => (
        setDoc(doc(db, "players", playerDoc.id), {
          userId,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      )),
  );
}

export async function getGamesPlayedByOrganiserForPlayer(
  db: Firestore,
  userId: string,
) {
  const registrationsSnapshot = await getDocs(
    query(collection(db, "registrations"), where("userId", "==", userId)),
  );

  const playedRegistrations = registrationsSnapshot.docs
    .map((registrationDoc) => ({
      id: registrationDoc.id,
      ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
    }))
    .filter(isPlayedRegistration);

  const eventIds = Array.from(new Set(playedRegistrations.map((registration) => registration.sessionEventId)));
  const eventEntries = await Promise.all(
    eventIds.map(async (eventId) => {
      const eventSnapshot = await getDoc(doc(db, "sessionEvents", eventId));
      if (!eventSnapshot.exists()) return null;
      return {
        id: eventSnapshot.id,
        ...(eventSnapshot.data() as Omit<SessionEvent, "id">),
      };
    }),
  );

  const eventsById = new Map(
    eventEntries
      .filter((event): event is SessionEvent => event != null)
      .map((event) => [event.id, event]),
  );

  const organiserCounts = new Map<string, OrganiserGameCount>();
  for (const registration of playedRegistrations) {
    const event = eventsById.get(registration.sessionEventId);
    if (!event) continue;

    const existing = organiserCounts.get(event.organiserId);
    if (existing) {
      existing.gamesPlayed += 1;
      continue;
    }

    organiserCounts.set(event.organiserId, {
      organiserId: event.organiserId,
      organiserName: event.organiserName || "Organiser",
      gamesPlayed: 1,
    });
  }

  return Array.from(organiserCounts.values()).sort((a, b) => {
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
    return a.organiserName.localeCompare(b.organiserName);
  });
}

export async function getVisiblePlayersForOrganiserManagement(
  db: Firestore,
  organiserId: string,
) {
  const [ownedPlayersSnapshot, sessionsSnapshot] = await Promise.all([
    getDocs(query(collection(db, "players"), where("ownerOrganiserId", "==", organiserId))),
    getDocs(query(collection(db, "sessions"), where("organiserId", "==", organiserId))),
  ]);

  const ownedPlayers = ownedPlayersSnapshot.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
  }));

  const registrationsBySeries = await Promise.all(
    sessionsSnapshot.docs.map((sessionDoc) => (
      getDocs(query(collection(db, "registrations"), where("sessionSeriesId", "==", sessionDoc.id)))
    )),
  );

  const registeredEntries = registrationsBySeries.flatMap((snapshot) => snapshot.docs.map((registrationDoc) => ({
    id: registrationDoc.id,
    ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
  })));

  const playerIds = Array.from(new Set(registeredEntries.map((registration) => registration.userId).filter(Boolean)));
  const playerSnapshots = await Promise.all(
    playerIds.map(async (playerId) => {
      const playerSnapshot = await getDoc(doc(db, "players", playerId));
      return playerSnapshot.exists()
        ? {
            id: playerSnapshot.id,
            ...(playerSnapshot.data() as Omit<PlayerDirectoryEntry, "id">),
          }
        : null;
    }),
  );

  const playersById = new Map(
    playerSnapshots
      .filter((player): player is PlayerDirectoryEntry => player != null)
      .map((player) => [player.id, player]),
  );

  const visiblePlayers = new Map<string, OrganiserVisiblePlayerRecord>();

  for (const player of ownedPlayers) {
    const key = buildVisiblePlayerKey({ email: player.email, fallback: player.id });
    const existing = visiblePlayers.get(key);
    const nextRecord: OrganiserVisiblePlayerRecord = {
      key,
      displayName: player.displayName,
      email: player.email,
      skillLevel: player.skillLevel || null,
      gamesPlayed: 0,
      playerId: player.id,
      userId: player.userId || null,
      ownerOrganiserId: player.ownerOrganiserId,
      isSelfRegistered: player.ownerOrganiserId == null && !!player.userId,
      isEditablePrivatePlayer: player.ownerOrganiserId === organiserId && !player.userId,
      hasRegisteredForOrganiser: false,
    };

    if (!existing) {
      visiblePlayers.set(key, nextRecord);
      continue;
    }

    const nextIsPreferred = nextRecord.isSelfRegistered && !existing.isSelfRegistered;
    visiblePlayers.set(key, nextIsPreferred ? {
      ...nextRecord,
      gamesPlayed: existing.gamesPlayed,
      hasRegisteredForOrganiser: existing.hasRegisteredForOrganiser,
    } : {
      ...existing,
      skillLevel: existing.skillLevel || nextRecord.skillLevel,
      playerId: existing.playerId || nextRecord.playerId,
      userId: existing.userId || nextRecord.userId,
      ownerOrganiserId: existing.ownerOrganiserId ?? nextRecord.ownerOrganiserId,
    });
  }

  for (const registration of registeredEntries) {
    const storedPlayer = playersById.get(registration.userId);
    const key = buildVisiblePlayerKey({
      email: storedPlayer?.email || registration.playerEmail,
      fallback: storedPlayer?.id || buildFallbackPlayerKey(registration),
    });
    const existing = visiblePlayers.get(key);
    const gamesPlayedIncrement = isPlayedRegistration(registration) ? 1 : 0;
    const displayName = storedPlayer?.displayName || registration.playerName || "Player";
    const email = storedPlayer?.email || registration.playerEmail || "";
    const skillLevel = storedPlayer?.skillLevel || null;
    const ownerOrganiserId = storedPlayer?.ownerOrganiserId ?? null;
    const userId = storedPlayer?.userId || (registration.userId.startsWith("manual-player__") ? null : registration.userId);

    if (existing) {
      existing.gamesPlayed += gamesPlayedIncrement;
      existing.hasRegisteredForOrganiser = true;
      if (!existing.displayName && displayName) existing.displayName = displayName;
      if (!existing.email && email) existing.email = email;
      if (!existing.skillLevel && skillLevel) existing.skillLevel = skillLevel;
      if (!existing.userId && userId) existing.userId = userId;
      if (existing.ownerOrganiserId == null && ownerOrganiserId != null) existing.ownerOrganiserId = ownerOrganiserId;
      existing.isSelfRegistered = existing.userId != null;
      existing.isEditablePrivatePlayer = existing.ownerOrganiserId === organiserId && !existing.userId;
      continue;
    }

    visiblePlayers.set(key, {
      key,
      displayName,
      email,
      skillLevel,
      gamesPlayed: gamesPlayedIncrement,
      playerId: storedPlayer?.id || null,
      userId,
      ownerOrganiserId,
      isSelfRegistered: userId != null,
      isEditablePrivatePlayer: ownerOrganiserId === organiserId && !userId,
      hasRegisteredForOrganiser: true,
    });
  }

  const items = Array.from(visiblePlayers.values()).sort((a, b) => {
    const gamesCompare = b.gamesPlayed - a.gamesPlayed;
    if (gamesCompare !== 0) return gamesCompare;
    const nameCompare = a.displayName.localeCompare(b.displayName);
    if (nameCompare !== 0) return nameCompare;
    return a.email.localeCompare(b.email);
  });

  return splitOrganiserVisiblePlayers(items);
}
