import {
  collection,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  doc,
  where,
  type Firestore,
} from "firebase/firestore";

export type PlayerDirectoryEntry = {
  id: string;
  ownerOrganiserId: string | null;
  userId: string | null;
  displayName: string;
  email: string;
  source: "self-registered" | "manual";
};

export function buildManualPlayerId(ownerOrganiserId: string, displayName: string) {
  return `manual-player__${encodeURIComponent(ownerOrganiserId)}__${encodeURIComponent(displayName.trim().toLowerCase())}`;
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
  const snapshots = await Promise.all([
    getDocs(query(collection(db, "players"), where("ownerOrganiserId", "==", organiserId))),
    getDocs(query(collection(db, "players"), where("ownerOrganiserId", "==", null))),
  ]);

  const merged = new Map<string, PlayerDirectoryEntry>();

  for (const snapshot of snapshots) {
    for (const playerDoc of snapshot.docs) {
      merged.set(playerDoc.id, {
        id: playerDoc.id,
        ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
      });
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
) {
  const id = buildManualPlayerId(ownerOrganiserId, displayName);
  await setDoc(
    doc(db, "players", id),
    {
      ownerOrganiserId,
      userId: null,
      displayName: displayName.trim(),
      email: "",
      source: "manual",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}
