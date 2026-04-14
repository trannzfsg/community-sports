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
import { normalizePlayerEmail, type PlayerDirectoryEntry } from "./players";
import type { RegistrationItem, SessionEvent } from "./session-series";

type DataPartition = "test" | "live";

function resolveDataPartition(email?: string | null, fallback: DataPartition = "live"): DataPartition {
  const normalized = email?.trim().toLowerCase() || "";
  return normalized ? (normalized.endsWith("@example.com") ? "test" : "live") : fallback;
}

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
  status: "active" | "inactive";
  gamesPlayed: number;
  playerId: string | null;
  userId: string | null;
  ownerOrganiserId: string | null;
  isSelfRegistered: boolean;
  isOwnedPrivatePlayer: boolean;
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
    query(collection(db, "players"), where("email", "==", normalizedEmail), where("dataPartition", "==", resolveDataPartition(normalizedEmail))),
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
  dataPartition?: DataPartition,
) {
  const partition = resolveDataPartition(undefined, dataPartition);
  const registrationsSnapshot = await getDocs(
    query(collection(db, "registrations"), where("userId", "==", userId), where("dataPartition", "==", partition)),
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
  dataPartition?: DataPartition,
) {
  const partition = resolveDataPartition(undefined, dataPartition);
  const [ownedPlayersSnapshot, sessionsSnapshot, usersSnapshot] = await Promise.all([
    getDocs(query(collection(db, "players"), where("ownerOrganiserId", "==", organiserId), where("dataPartition", "==", partition))),
    getDocs(query(collection(db, "sessions"), where("organiserId", "==", organiserId), where("dataPartition", "==", partition))),
    getDocs(query(collection(db, "users"), where("dataPartition", "==", partition))),
  ]);

  const ownedPlayers = ownedPlayersSnapshot.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
  }));
  const users = usersSnapshot.docs.map((userDoc) => ({
    id: userDoc.id,
    ...(userDoc.data() as {
      email?: string;
      status?: "active" | "inactive";
      isPending?: boolean;
      userId?: string | null;
    }),
  }));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const pendingUsersByEmail = new Map(
    users
      .filter((user) => user.isPending && user.email)
      .map((user) => [normalizePlayerEmail(user.email || ""), user]),
  );

  const registrationsBySeries = await Promise.all(
    sessionsSnapshot.docs.map((sessionDoc) => (
      getDocs(query(collection(db, "registrations"), where("sessionSeriesId", "==", sessionDoc.id), where("dataPartition", "==", partition)))
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
    const linkedUser = player.userId ? usersById.get(player.userId) : null;
    const pendingUser = pendingUsersByEmail.get(normalizePlayerEmail(player.email));
    const status = linkedUser?.status || pendingUser?.status || player.status || "active";
    const nextRecord: OrganiserVisiblePlayerRecord = {
      key,
      displayName: player.displayName,
      email: player.email,
      skillLevel: player.skillLevel || null,
      status,
      gamesPlayed: 0,
      playerId: player.id,
      userId: player.userId || null,
      ownerOrganiserId: player.ownerOrganiserId,
      isSelfRegistered: player.ownerOrganiserId == null && !!player.userId,
      isOwnedPrivatePlayer: player.ownerOrganiserId === organiserId && !player.userId,
      isEditablePrivatePlayer: player.ownerOrganiserId === organiserId && !player.userId && status !== "inactive",
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
      status: existing.status === "inactive" || nextRecord.status === "inactive" ? "inactive" : "active",
      playerId: existing.playerId || nextRecord.playerId,
      userId: existing.userId || nextRecord.userId,
      ownerOrganiserId: existing.ownerOrganiserId ?? nextRecord.ownerOrganiserId,
      isOwnedPrivatePlayer: existing.isOwnedPrivatePlayer || nextRecord.isOwnedPrivatePlayer,
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
    const linkedUser = userId ? usersById.get(userId) : null;
    const pendingUser = email ? pendingUsersByEmail.get(normalizePlayerEmail(email)) : null;
    const status = linkedUser?.status || pendingUser?.status || storedPlayer?.status || "active";
    const isOwnedPrivatePlayer = ownerOrganiserId === organiserId && !userId;

    if (existing) {
      existing.gamesPlayed += gamesPlayedIncrement;
      existing.hasRegisteredForOrganiser = true;
      if (!existing.displayName && displayName) existing.displayName = displayName;
      if (!existing.email && email) existing.email = email;
      if (!existing.skillLevel && skillLevel) existing.skillLevel = skillLevel;
      if (!existing.userId && userId) existing.userId = userId;
      if (existing.ownerOrganiserId == null && ownerOrganiserId != null) existing.ownerOrganiserId = ownerOrganiserId;
      if (existing.status !== "inactive" && status === "inactive") existing.status = "inactive";
      existing.isSelfRegistered = existing.userId != null;
      existing.isOwnedPrivatePlayer = existing.isOwnedPrivatePlayer || isOwnedPrivatePlayer;
      existing.isEditablePrivatePlayer = existing.isOwnedPrivatePlayer && existing.status !== "inactive";
      continue;
    }

    visiblePlayers.set(key, {
      key,
      displayName,
      email,
      skillLevel,
      status,
      gamesPlayed: gamesPlayedIncrement,
      playerId: storedPlayer?.id || null,
      userId,
      ownerOrganiserId,
      isSelfRegistered: userId != null,
      isOwnedPrivatePlayer,
      isEditablePrivatePlayer: isOwnedPrivatePlayer && status !== "inactive",
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
