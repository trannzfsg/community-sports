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
import type { UserSubscription } from "@/lib/subscription";

type DataPartition = "test" | "live";

function getDataPartitionForEmail(email: string): DataPartition {
  return email.trim().toLowerCase().endsWith("@example.com") ? "test" : "live";
}

export type UserRecord = {
  id: string;
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  status?: "active" | "inactive";
  dataPartition?: DataPartition;
  isPending?: boolean;
  subscription?: UserSubscription | null;
};

function isRegisteredUserRecord(user: UserRecord) {
  return user.isPending !== true && !user.id.includes("@");
}

export async function getUsersByRole(
  db: Firestore,
  role: UserRecord["role"],
  dataPartition?: DataPartition,
) {
  const constraints = [where("role", "==", role)];
  if (dataPartition) {
    constraints.push(where("dataPartition", "==", dataPartition));
  }

  const snapshot = await getDocs(query(collection(db, "users"), ...constraints));

  return snapshot.docs.map((userDoc) => ({
    id: userDoc.id,
    ...(userDoc.data() as Omit<UserRecord, "id">),
  })).filter(isRegisteredUserRecord);
}

export async function getUserById(db: Firestore, userId: string) {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<UserRecord, "id">),
  };
}

export async function getAllUsers(db: Firestore, dataPartition?: DataPartition) {
  const snapshot = dataPartition
    ? await getDocs(query(collection(db, "users"), where("dataPartition", "==", dataPartition)))
    : await getDocs(collection(db, "users"));
  return snapshot.docs.map((userDoc) => ({
    id: userDoc.id,
    ...(userDoc.data() as Omit<UserRecord, "id">),
  })).filter(isRegisteredUserRecord);
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
        dataPartition: getDataPartitionForEmail(player.email || ""),
        source: "self-registered",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  return players;
}
