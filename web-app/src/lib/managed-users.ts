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
};

export function buildManagedUserId(email: string) {
  return email.trim();
}

export async function getManagedUserByEmail(db: Firestore, email: string) {
  const snapshot = await getDoc(doc(db, "managedUsers", buildManagedUserId(email)));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<ManagedUserRecord, "id">),
  };
}

export async function getManagedUsersByRole(
  db: Firestore,
  role: ManagedUserRole,
) {
  const snapshot = await getDocs(
    query(collection(db, "managedUsers"), where("role", "==", role)),
  );

  return snapshot.docs.map((managedUserDoc) => ({
    id: managedUserDoc.id,
    ...(managedUserDoc.data() as Omit<ManagedUserRecord, "id">),
  }));
}

export async function upsertManagedUser(
  db: Firestore,
  input: {
    email: string;
    displayName: string;
    role: ManagedUserRole;
    status?: ManagedUserStatus;
    userId?: string | null;
  },
) {
  const id = buildManagedUserId(input.email);
  await setDoc(
    doc(db, "managedUsers", id),
    {
      email: input.email.trim(),
      displayName: input.displayName.trim(),
      role: input.role,
      status: input.status || "active",
      userId: input.userId ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}
