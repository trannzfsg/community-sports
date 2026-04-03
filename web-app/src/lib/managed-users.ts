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

export type ManagedUserRole = "player" | "organiser";
export type ManagedUserStatus = "active" | "inactive";

export type ManagedUserRecord = {
  id: string;
  email: string;
  displayName: string;
  role: ManagedUserRole;
  status: ManagedUserStatus;
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

  const snapshot = await getDoc(doc(db, "users", buildManagedUserId(normalized)));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as Omit<ManagedUserRecord, "id">;
  if (!data.isPending) return null;

  return {
    id: snapshot.id,
    ...data,
  };
}

export async function getManagedUsersByRole(
  db: Firestore,
  role: ManagedUserRole,
) {
  const snapshot = await getDocs(
    query(collection(db, "users"), where("role", "==", role), where("isPending", "==", true)),
  );

  return snapshot.docs.map((managedUserDoc) => ({
    id: managedUserDoc.id,
    ...(managedUserDoc.data() as Omit<ManagedUserRecord, "id">),
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
  const id = input.id || buildManagedUserId(normalizedEmail);

  await setDoc(
    doc(db, "users", id),
    {
      email: normalizedEmail,
      displayName: input.displayName.trim(),
      role: input.role,
      status: input.status || "active",
      userId: input.userId ?? null,
      isPending: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}
