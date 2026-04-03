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
import { getUsersByRole } from "@/lib/users";
import type { SkillLevel } from "@/lib/skill-levels";

export type PlayerDirectoryEntry = {
  id: string;
  ownerOrganiserId: string | null;
  userId: string | null;
  displayName: string;
  email: string;
  source: "self-registered" | "manual";
  skillLevel?: SkillLevel | null;
};

export function normalizePlayerEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildManualPlayerId(ownerOrganiserId: string, displayName: string, email?: string) {
  const normalizedEmail = normalizePlayerEmail(email || "");
  const suffix = normalizedEmail || displayName.trim().toLowerCase();
  return `manual-player__${encodeURIComponent(ownerOrganiserId)}__${encodeURIComponent(suffix)}`;
}

export async function ensureSelfRegisteredPlayers(db: Firestore) {
  const usersSnapshot = await getDocs(collection(db, "users"));

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
          source: "self-registered",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }),
  );
}

export async function getVisiblePlayersForOrganiser(db: Firestore, organiserId: string) {
  const [snapshots, adminUsers, organiserUsers] = await Promise.all([
    Promise.all([
      getDocs(query(collection(db, "players"), where("ownerOrganiserId", "==", organiserId))),
      getDocs(query(collection(db, "players"), where("ownerOrganiserId", "==", null))),
    ]),
    getUsersByRole(db, "admin"),
    getUsersByRole(db, "organiser"),
  ]);

  const excludedUserIds = new Set([
    ...adminUsers.map((user) => user.id),
    ...organiserUsers.map((user) => user.id),
  ]);

  const merged = new Map<string, PlayerDirectoryEntry>();

  for (const snapshot of snapshots) {
    for (const playerDoc of snapshot.docs) {
      const player = {
        id: playerDoc.id,
        ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
      };

      if (player.userId && excludedUserIds.has(player.userId)) {
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
      source: "self-registered",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
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
