import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { getUsersByRole } from "./users";
import type { SkillLevel } from "./skill-levels";
import { buildPaymentId } from "./payments";
import { buildRegistrationId, type RegistrationItem, type SessionEvent, type SessionSeries } from "./session-series";

type DataPartition = "test" | "live";

function getDataPartitionForEmail(email: string): DataPartition {
  return email.trim().toLowerCase().endsWith("@example.com") ? "test" : "live";
}

function resolveDataPartition(email?: string | null, fallback: DataPartition = "live"): DataPartition {
  const normalized = email?.trim().toLowerCase() || "";
  return normalized ? getDataPartitionForEmail(normalized) : fallback;
}

export type PlayerDirectoryEntry = {
  id: string;
  ownerOrganiserId: string | null;
  userId: string | null;
  displayName: string;
  email: string;
  dataPartition?: DataPartition;
  source: "self-registered" | "manual";
  skillLevel?: SkillLevel | null;
  status?: "active" | "inactive" | null;
};

export function normalizePlayerEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildManualPlayerId(ownerOrganiserId: string, displayName: string, email?: string) {
  const normalizedEmail = normalizePlayerEmail(email || "");
  const suffix = normalizedEmail || displayName.trim().toLowerCase();
  return `manual-player__${encodeURIComponent(ownerOrganiserId)}__${encodeURIComponent(suffix)}`;
}

export async function ensureSelfRegisteredPlayers(db: Firestore, dataPartition?: DataPartition) {
  const usersSnapshot = dataPartition
    ? await getDocs(query(collection(db, "users"), where("dataPartition", "==", dataPartition)))
    : await getDocs(collection(db, "users"));

  await Promise.all(
    usersSnapshot.docs.map(async (userDoc) => {
      const data = userDoc.data() as {
        displayName?: string;
        email?: string;
        role?: string;
      };

      if (!data.email || data.role !== "player") {
        return;
      }

      await setDoc(
        doc(db, "players", userDoc.id),
        {
          ownerOrganiserId: null,
          userId: userDoc.id,
          displayName: data.displayName || data.email,
          email: data.email,
          dataPartition: getDataPartitionForEmail(data.email),
          source: "self-registered",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }),
  );
}

export async function getVisiblePlayersForOrganiser(
  db: Firestore,
  organiserId: string,
  dataPartition?: DataPartition,
) {
  const partition = resolveDataPartition(undefined, dataPartition);
  const [[ownedPlayersSnapshot, sharedPlayersSnapshot], adminUsers, organiserUsers] = await Promise.all([
    Promise.all([
      getDocs(query(collection(db, "players"), where("dataPartition", "==", partition), where("ownerOrganiserId", "==", organiserId))),
      getDocs(query(collection(db, "players"), where("dataPartition", "==", partition), where("ownerOrganiserId", "==", null))),
    ]),
    getUsersByRole(db, "admin", partition),
    getUsersByRole(db, "organiser", partition),
  ]);

  const excludedUserIds = new Set([
    ...adminUsers.map((user) => user.id),
    ...organiserUsers.map((user) => user.id),
  ]);

  const merged = new Map<string, PlayerDirectoryEntry>();

  for (const snapshot of [ownedPlayersSnapshot, sharedPlayersSnapshot]) {
    for (const playerDoc of snapshot.docs) {
      const player = {
        id: playerDoc.id,
        ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
      };

      if (player.userId && excludedUserIds.has(player.userId)) {
        continue;
      }

      if (player.dataPartition && player.dataPartition !== partition) {
        continue;
      }

      if (player.ownerOrganiserId != null && player.ownerOrganiserId !== organiserId && player.ownerOrganiserId !== null) {
        continue;
      }

      const dedupeKey = normalizePlayerEmail(player.email) || `id:${player.id}`;
      const existing = merged.get(dedupeKey);

      if (!existing) {
        merged.set(dedupeKey, player);
        continue;
      }

      const existingIsSelfRegistered = existing.ownerOrganiserId == null && !!existing.userId;
      const playerIsSelfRegistered = player.ownerOrganiserId == null && !!player.userId;
      if (!existingIsSelfRegistered && playerIsSelfRegistered) {
        merged.set(dedupeKey, player);
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    const nameCompare = a.displayName.localeCompare(b.displayName);
    if (nameCompare !== 0) return nameCompare;
    return a.email.localeCompare(b.email);
  });
}

export async function createManualPlayer(
  db: Firestore,
  ownerOrganiserId: string,
  displayName: string,
  email: string,
) {
  const normalizedEmail = normalizePlayerEmail(email);
  const id = buildManualPlayerId(ownerOrganiserId, displayName, normalizedEmail);
  await setDoc(
    doc(db, "players", id),
    {
      ownerOrganiserId,
      userId: null,
      displayName: displayName.trim(),
      email: normalizedEmail,
      dataPartition: getDataPartitionForEmail(normalizedEmail),
      source: "manual",
      skillLevel: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}

export async function promoteManualPlayerToSelfRegistered(
  db: Firestore,
  userId: string,
  email: string,
  displayName: string,
) {
  const normalizedEmail = normalizePlayerEmail(email);

  await setDoc(
    doc(db, "players", userId),
    {
      ownerOrganiserId: null,
      userId,
      displayName: displayName.trim(),
      email: normalizedEmail,
      dataPartition: getDataPartitionForEmail(normalizedEmail),
      source: "self-registered",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function migrateManualPlayersToSelfRegistered(
  db: Firestore,
  userId: string,
  email: string,
  displayName: string,
) {
  const normalizedEmail = normalizePlayerEmail(email);
  if (!normalizedEmail) return;

  const matchingPlayersSnapshot = await getDocs(
    query(collection(db, "players"), where("email", "==", normalizedEmail), where("dataPartition", "==", getDataPartitionForEmail(normalizedEmail))),
  );

  const manualPlayers = matchingPlayersSnapshot.docs
    .map((playerDoc) => ({
      id: playerDoc.id,
      ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
    }))
    .filter((player) => player.ownerOrganiserId != null);

  if (!manualPlayers.length) {
    return;
  }

  const existingSelfSnapshot = await getDoc(doc(db, "players", userId));
  const fallbackSkillLevel = manualPlayers.find((player) => player.skillLevel)?.skillLevel ?? null;

  await setDoc(doc(db, "players", userId), {
    ownerOrganiserId: null,
    userId,
    displayName: displayName.trim(),
    email: normalizedEmail,
    dataPartition: getDataPartitionForEmail(normalizedEmail),
    source: "self-registered",
    skillLevel: existingSelfSnapshot.data()?.skillLevel ?? fallbackSkillLevel,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  for (const manualPlayer of manualPlayers) {
    const registrationsSnapshot = await getDocs(
      query(collection(db, "registrations"), where("userId", "==", manualPlayer.id), where("dataPartition", "==", getDataPartitionForEmail(normalizedEmail))),
    );

    for (const registrationDoc of registrationsSnapshot.docs) {
      const registration = {
        id: registrationDoc.id,
        ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
      };

      const nextRegistrationId = buildRegistrationId(registration.sessionEventId, userId);
      const nextRegistrationRef = doc(db, "registrations", nextRegistrationId);
      const existingRegistrationSnapshot = await getDoc(nextRegistrationRef);
      const paymentSnapshot = await getDoc(doc(db, "payments", buildPaymentId(registration.id)));
      const paymentData = paymentSnapshot.exists()
        ? paymentSnapshot.data() as {
            organiserId?: string;
            amount?: number;
            playerPaid?: boolean;
            organiserPaid?: boolean;
            paymentReference?: string | null;
            effectivePaid?: boolean;
            status?: "pending" | "paid";
          }
        : null;
      const seriesSnapshot = await getDoc(doc(db, "sessions", registration.sessionSeriesId));
      const eventSnapshot = await getDoc(doc(db, "sessionEvents", registration.sessionEventId));
      const seriesData = seriesSnapshot.exists()
        ? { id: seriesSnapshot.id, ...(seriesSnapshot.data() as Omit<SessionSeries, "id">) }
        : null;
      const eventData = eventSnapshot.exists()
        ? { id: eventSnapshot.id, ...(eventSnapshot.data() as Omit<SessionEvent, "id">) }
        : null;

      if (existingRegistrationSnapshot.exists()) {
        const existingRegistration = existingRegistrationSnapshot.data() as Omit<RegistrationItem, "id">;
        await setDoc(nextRegistrationRef, {
          ...existingRegistration,
          playerName: displayName.trim(),
          playerEmail: normalizedEmail,
          dataPartition: getDataPartitionForEmail(normalizedEmail),
          userId,
          playerPaid: existingRegistration.playerPaid || registration.playerPaid,
          organiserPaid: existingRegistration.organiserPaid || registration.organiserPaid,
          paymentReference: existingRegistration.paymentReference ?? registration.paymentReference ?? null,
          status: existingRegistration.status || registration.status || "registered",
          updatedAt: serverTimestamp(),
        }, { merge: true });

        if (seriesData && eventData) {
          await setDoc(doc(db, "payments", buildPaymentId(nextRegistrationId)), {
            sessionSeriesId: registration.sessionSeriesId,
            sessionEventId: registration.sessionEventId,
            registrationId: nextRegistrationId,
            organiserId: paymentData?.organiserId || eventData.organiserId || seriesData.organiserId,
            userId,
            playerName: displayName.trim(),
            playerEmail: normalizedEmail,
            dataPartition: getDataPartitionForEmail(normalizedEmail),
            amount: paymentData?.amount ?? eventData.defaultPriceCasual ?? seriesData.defaultPriceCasual,
            playerPaid: (paymentData?.playerPaid ?? false) || existingRegistration.playerPaid || registration.playerPaid,
            organiserPaid: (paymentData?.organiserPaid ?? false) || existingRegistration.organiserPaid || registration.organiserPaid,
            paymentReference: existingRegistration.paymentReference ?? paymentData?.paymentReference ?? registration.paymentReference ?? null,
            effectivePaid: (paymentData?.effectivePaid ?? false) || !!(existingRegistration.playerPaid || existingRegistration.organiserPaid || registration.playerPaid || registration.organiserPaid),
            status: ((paymentData?.effectivePaid ?? false) || existingRegistration.playerPaid || existingRegistration.organiserPaid || registration.playerPaid || registration.organiserPaid) ? "paid" : "pending",
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }

        await deleteDoc(doc(db, "payments", buildPaymentId(registration.id)));
        await deleteDoc(registrationDoc.ref);
        continue;
      }

      await setDoc(nextRegistrationRef, {
        ...registration,
        userId,
        playerName: displayName.trim(),
        playerEmail: normalizedEmail,
        dataPartition: getDataPartitionForEmail(normalizedEmail),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (seriesData && eventData) {
        await setDoc(doc(db, "payments", buildPaymentId(nextRegistrationId)), {
          sessionSeriesId: registration.sessionSeriesId,
          sessionEventId: registration.sessionEventId,
          registrationId: nextRegistrationId,
          organiserId: paymentData?.organiserId || eventData.organiserId || seriesData.organiserId,
          userId,
          playerName: displayName.trim(),
          playerEmail: normalizedEmail,
          dataPartition: getDataPartitionForEmail(normalizedEmail),
          amount: paymentData?.amount ?? eventData.defaultPriceCasual ?? seriesData.defaultPriceCasual,
          playerPaid: paymentData?.playerPaid ?? !!registration.playerPaid,
          organiserPaid: paymentData?.organiserPaid ?? !!registration.organiserPaid,
          paymentReference: paymentData?.paymentReference ?? registration.paymentReference ?? null,
          effectivePaid: paymentData?.effectivePaid ?? !!(registration.playerPaid || registration.organiserPaid),
          status: paymentData?.status ?? ((registration.playerPaid || registration.organiserPaid) ? "paid" : "pending"),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      await deleteDoc(doc(db, "payments", buildPaymentId(registration.id)));
      await deleteDoc(registrationDoc.ref);
    }

    await deleteDoc(doc(db, "players", manualPlayer.id));
  }
}

export async function updateManualPlayerSkillLevel(
  db: Firestore,
  playerId: string,
  skillLevel: SkillLevel | null,
) {
  await setDoc(
    doc(db, "players", playerId),
    {
      skillLevel,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
