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
  const [ownedPlayersSnapshot, sessionsSnapshot] = await Promise.all([
    getDocs(query(collection(db, "players"), where("dataPartition", "==", partition), where("ownerOrganiserId", "==", organiserId))),
    getDocs(query(collection(db, "sessions"), where("dataPartition", "==", partition), where("organiserId", "==", organiserId))),
  ]);

  const ownedPlayers = ownedPlayersSnapshot.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
  })).filter((player) => (!player.dataPartition || player.dataPartition === partition) && player.ownerOrganiserId === organiserId);
  const ownedSessionIds = new Set(sessionsSnapshot.docs.map((sessionDoc) => sessionDoc.id));
  const registrationsSnapshot = await getDocs(
    query(collection(db, "registrations"), where("dataPartition", "==", partition)),
  );

  const registeredEntries = registrationsSnapshot.docs.map((registrationDoc) => ({
    id: registrationDoc.id,
    ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
  })).filter((registration) => ownedSessionIds.has(registration.sessionSeriesId));

  const playersById = new Map<string, PlayerDirectoryEntry>();
  for (const player of ownedPlayers) {
    playersById.set(player.id, player);
  }

  const registeredPlayerIds = Array.from(
    new Set(
      registeredEntries
        .map((registration) => registration.userId)
        .filter((userId) => !!userId),
    ),
  );

  const [linkedPlayers, linkedUsers] = await Promise.all([
    Promise.all(
      registeredPlayerIds
        .filter((playerId) => !playersById.has(playerId))
        .map(async (playerId) => {
          try {
            const snapshot = await getDoc(doc(db, "players", playerId));
            if (!snapshot.exists()) return null;
            const player = {
              id: snapshot.id,
              ...(snapshot.data() as Omit<PlayerDirectoryEntry, "id">),
            };
            return (!player.dataPartition || player.dataPartition === partition) ? player : null;
          } catch {
            return null;
          }
        }),
    ),
    Promise.all(
      Array.from(
        new Set(
          [
            ...ownedPlayers.map((player) => player.userId).filter((userId): userId is string => !!userId),
            ...registeredEntries
              .map((registration) => registration.userId)
              .filter((userId) => !!userId && !userId.startsWith("manual-player__")),
          ],
        ),
      ).map(async (userId) => {
        try {
          const snapshot = await getDoc(doc(db, "users", userId));
          if (!snapshot.exists()) return null;
          const user = snapshot.data() as {
            email?: string;
            status?: "active" | "inactive";
            displayName?: string;
          };
          const userPartition = resolveDataPartition(user.email || "", partition);
          if (userPartition !== partition) return null;
          return {
            id: snapshot.id,
            ...user,
          };
        } catch {
          return null;
        }
      }),
    ),
  ]);

  for (const player of linkedPlayers.filter((item): item is PlayerDirectoryEntry => item != null)) {
    playersById.set(player.id, player);
  }

  const usersById = new Map(
    linkedUsers
      .filter((user): user is NonNullable<typeof user> => user != null)
      .map((user) => [user.id, user]),
  );

  const visiblePlayers = new Map<string, OrganiserVisiblePlayerRecord>();

  for (const player of ownedPlayers) {
    const key = buildVisiblePlayerKey({ email: player.email, fallback: player.id });
    const existing = visiblePlayers.get(key);
    const linkedUser = player.userId ? usersById.get(player.userId) : null;
    const status = linkedUser?.status || player.status || "active";
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
    const linkedUser = registration.userId.startsWith("manual-player__")
      ? null
      : usersById.get(registration.userId);
    const key = buildVisiblePlayerKey({
      email: storedPlayer?.email || linkedUser?.email || registration.playerEmail,
      fallback: storedPlayer?.id || buildFallbackPlayerKey(registration),
    });
    const existing = visiblePlayers.get(key);
    const gamesPlayedIncrement = isPlayedRegistration(registration) ? 1 : 0;
    const displayName = storedPlayer?.displayName || linkedUser?.displayName || registration.playerName || "Player";
    const email = storedPlayer?.email || linkedUser?.email || registration.playerEmail || "";
    const skillLevel = storedPlayer?.skillLevel || null;
    const ownerOrganiserId = storedPlayer?.ownerOrganiserId ?? null;
    const userId = storedPlayer?.userId || (registration.userId.startsWith("manual-player__") ? null : registration.userId);
    const status = linkedUser?.status || storedPlayer?.status || "active";
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
