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

export type UserRecord = {
  id: string;
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
};

export async function getUsersByRole(
  db: Firestore,
  role: UserRecord["role"],
) {
  const snapshot = await getDocs(
    query(collection(db, "users"), where("role", "==", role)),
  );

  return snapshot.docs.map((userDoc) => ({
    id: userDoc.id,
    ...(userDoc.data() as Omit<UserRecord, "id">),
  }));
}

export async function getAllUsers(db: Firestore) {
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs.map((userDoc) => ({
    id: userDoc.id,
    ...(userDoc.data() as Omit<UserRecord, "id">),
  }));
}

export async function backfillSharedPlayerDirectoryFromUsers(db: Firestore) {
  const players = await getUsersByRole(db, "player");
  for (const player of players) {
    await setDoc(
      doc(db, "players", player.id),
      {
        ownerOrganiserId: null,
        userId: player.id,
        displayName: player.displayName || player.email || "Player",
        email: player.email || "",
        source: "self-registered",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  return players;
}
