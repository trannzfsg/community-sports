import {
  addDoc,
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
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const byEmailSnapshot = await getDocs(
    query(collection(db, "managedUsers"), where("email", "==", normalizedEmail)),
  );

  if (!byEmailSnapshot.empty) {
    const managedUserDoc = byEmailSnapshot.docs[0];
    return {
      id: managedUserDoc.id,
      ...(managedUserDoc.data() as Omit<ManagedUserRecord, "id">),
    };
  }

  const legacyId = email.trim();
  const candidateIds = Array.from(new Set([normalizedEmail, legacyId])).filter(Boolean);

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
    id?: string;
    email: string;
    displayName: string;
    role: ManagedUserRole;
    status?: ManagedUserStatus;
    userId?: string | null;
  },
) {
  const normalizedEmail = normalizeEmail(input.email);
  const payload = {
    email: normalizedEmail,
    displayName: input.displayName.trim(),
    role: input.role,
    status: input.status || "active",
    userId: input.userId ?? null,
    updatedAt: serverTimestamp(),
  };

  const id = input.id || (await getManagedUserByEmail(db, normalizedEmail))?.id;
  if (id) {
    await setDoc(doc(db, "managedUsers", id), payload, { merge: true });
    return id;
  }

  const created = await addDoc(collection(db, "managedUsers"), payload);
  return created.id;
}
