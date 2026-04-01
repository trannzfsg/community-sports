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

export type PaymentRecord = {
  id: string;
  sessionSeriesId: string;
  sessionEventId: string;
  registrationId: string;
  organiserId: string;
  userId: string;
  playerName: string;
  playerEmail: string;
  amount: number;
  playerPaid: boolean;
  organiserPaid: boolean;
  effectivePaid: boolean;
  status: "pending" | "paid";
};

export function buildPaymentId(registrationId: string) {
  return `payment__${registrationId}`;
}

export async function upsertPaymentRecord(
  db: Firestore,
  payment: Omit<PaymentRecord, "id">,
) {
  const paymentId = buildPaymentId(payment.registrationId);
  await setDoc(doc(db, "payments", paymentId), {
    ...payment,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return paymentId;
}

export async function getPaymentsForEvent(db: Firestore, sessionEventId: string) {
  const snapshot = await getDocs(
    query(collection(db, "payments"), where("sessionEventId", "==", sessionEventId)),
  );

  return snapshot.docs.map((paymentDoc) => ({
    id: paymentDoc.id,
    ...(paymentDoc.data() as Omit<PaymentRecord, "id">),
  }));
}
