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

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildManagedUserId(email: string) {
  return normalizeEmail(email);
}

export async function getManagedUserByEmail(db: Firestore, email: string) {
  const canonicalId = buildManagedUserId(email);
  const legacyId = email.trim();

  const candidateIds = Array.from(new Set([canonicalId, legacyId])).filter(Boolean);

  for (const id of candidateIds) {
    const snapshot = await getDoc(doc(db, "managedUsers", id));
    if (snapshot.exists()) {
      return {
        id: snapshot.id,
        ...(snapshot.data() as Omit<ManagedUserRecord, "id">),
      };
    }
  }

  return null;
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
      email: normalizeEmail(input.email),
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
