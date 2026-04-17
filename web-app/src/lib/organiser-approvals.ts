import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";

type DataPartition = "test" | "live";

export type OrganiserApprovalStatus = "pending" | "approved" | "rejected";

export type OrganiserApprovalRecord = {
  id: string;
  organiserId: string;
  organiserName: string;
  playerId: string;
  playerName: string;
  playerEmail: string;
  dataPartition: DataPartition;
  status: OrganiserApprovalStatus;
};

export function buildOrganiserApprovalId(organiserId: string, playerId: string) {
  return `${organiserId}__${playerId}`;
}

export async function requestOrganiserApproval(
  db: Firestore,
  input: {
    organiserId: string;
    organiserName: string;
    playerId: string;
    playerName: string;
    playerEmail: string;
    dataPartition: DataPartition;
  },
) {
  const approvalId = buildOrganiserApprovalId(input.organiserId, input.playerId);
  await setDoc(doc(db, "organiserApprovals", approvalId), {
    organiserId: input.organiserId,
    organiserName: input.organiserName,
    playerId: input.playerId,
    playerName: input.playerName,
    playerEmail: input.playerEmail,
    dataPartition: input.dataPartition,
    status: "pending",
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return approvalId;
}

export async function updateOrganiserApprovalStatus(
  db: Firestore,
  approvalId: string,
  status: OrganiserApprovalStatus,
) {
  await updateDoc(doc(db, "organiserApprovals", approvalId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function getPlayerOrganiserApprovals(
  db: Firestore,
  playerId: string,
  dataPartition: DataPartition,
) {
  const snapshot = await getDocs(
    query(
      collection(db, "organiserApprovals"),
      where("playerId", "==", playerId),
      where("dataPartition", "==", dataPartition),
    ),
  );

  return snapshot.docs.map((approvalDoc) => ({
    id: approvalDoc.id,
    ...(approvalDoc.data() as Omit<OrganiserApprovalRecord, "id">),
  }));
}

export async function getOrganiserApprovalRequests(
  db: Firestore,
  organiserId: string,
  dataPartition: DataPartition,
) {
  const snapshot = await getDocs(
    query(
      collection(db, "organiserApprovals"),
      where("organiserId", "==", organiserId),
      where("dataPartition", "==", dataPartition),
    ),
  );

  return snapshot.docs.map((approvalDoc) => ({
    id: approvalDoc.id,
    ...(approvalDoc.data() as Omit<OrganiserApprovalRecord, "id">),
  }));
}
