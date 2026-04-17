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

type DataPartition = "test" | "live";

function getDataPartitionForEmail(email: string): DataPartition {
  return email.trim().toLowerCase().endsWith("@example.com") ? "test" : "live";
}

export type ManagedUserRole = "player" | "organiser";
export type ManagedUserStatus = "active" | "inactive";

export type ManagedUserRecord = {
  id: string;
  email: string;
  displayName: string;
  role: ManagedUserRole | "admin";
  status: ManagedUserStatus;
  dataPartition?: DataPartition;
  userId?: string | null;
  isPending?: boolean;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildManagedUserId(email: string) {
  return normalizeEmail(email);
}

export async function getManagedUserByEmail(db: Firestore, email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  try {
    const snapshot = await getDoc(doc(db, "managedUsers", buildManagedUserId(normalized)));
    if (!snapshot.exists()) return null;

    const data = snapshot.data() as Omit<ManagedUserRecord, "id">;
    return {
      id: snapshot.id,
      ...data,
      isPending: true,
    };
  } catch (err) {
    // This can happen on first login if users/{uid} doesn't exist yet and the Firestore
    // rule hasn't been deployed. Degrade gracefully.
    console.warn("[auth] getManagedUserByEmail: could not read pending user doc, defaulting to no managed user.", err);
    return null;
  }
}

export async function getManagedUsersByRole(
  db: Firestore,
  role: ManagedUserRole,
  dataPartition?: DataPartition,
) {
  const snapshot = dataPartition
    ? await getDocs(query(collection(db, "managedUsers"), where("dataPartition", "==", dataPartition), where("role", "==", role)))
    : await getDocs(query(collection(db, "managedUsers"), where("role", "==", role)));

  return snapshot.docs.map((managedUserDoc) => ({
    id: managedUserDoc.id,
    ...(managedUserDoc.data() as Omit<ManagedUserRecord, "id">),
    isPending: true,
  })).filter((managedUser) => managedUser.role === role);
}

export async function getManagedUsersInPartition(
  db: Firestore,
  dataPartition: DataPartition,
) {
  const snapshot = await getDocs(
    query(collection(db, "managedUsers"), where("dataPartition", "==", dataPartition)),
  );

  return snapshot.docs.map((managedUserDoc) => ({
    id: managedUserDoc.id,
    ...(managedUserDoc.data() as Omit<ManagedUserRecord, "id">),
    isPending: true,
  }));
}

export async function upsertManagedUser(
  db: Firestore,
  input: {
    id?: string;
    email: string;
    displayName: string;
    role: ManagedUserRole;
    status?: ManagedUserStatus;
    userId?: string | null;
  },
) {
  const normalizedEmail = normalizeEmail(input.email);
  const canonicalId = buildManagedUserId(normalizedEmail);
  const previousId = input.id?.trim() || "";
  const id = previousId && previousId === canonicalId ? previousId : canonicalId;

  await setDoc(
    doc(db, "managedUsers", id),
    {
      email: normalizedEmail,
      displayName: input.displayName.trim(),
      role: input.role,
      status: input.status || "active",
      dataPartition: getDataPartitionForEmail(normalizedEmail),
      userId: input.userId ?? null,
      isPending: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  if (previousId && previousId !== id) {
    await deleteDoc(doc(db, "managedUsers", previousId));
  }

  return id;
}
