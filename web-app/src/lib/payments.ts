import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { applyFreeEventPaymentState, type RegistrationItem, type SessionEvent, type SessionSeries } from "./session-series";

type DataPartition = "test" | "live";

function getDataPartitionForEmail(email: string): DataPartition {
  return email.trim().toLowerCase().endsWith("@example.com") ? "test" : "live";
}

export type PaymentRecord = {
  id: string;
  sessionSeriesId: string;
  sessionEventId: string;
  registrationId: string;
  organiserId: string;
  userId: string;
  playerName: string;
  playerEmail: string;
  dataPartition?: DataPartition;
  amount: number;
  amountCents?: number;
  platformFeeCents?: number;
  stripeFeeRecoveryCents?: number;
  playerTotalCents?: number;
  playerPaid: boolean;
  organiserPaid: boolean;
  paymentReference?: string | null;
  paymentMethod?: "manual" | "stripe" | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  effectivePaid: boolean;
  status: "pending" | "checkout_pending" | "paid";
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

export async function syncPaymentRecordForRegistration(
  db: Firestore,
  series: SessionSeries,
  eventItem: SessionEvent,
  registration: RegistrationItem,
) {
  const paidRegistration = applyFreeEventPaymentState(registration, eventItem);
  const effectivePaid = !!(paidRegistration.playerPaid || paidRegistration.organiserPaid);
  return upsertPaymentRecord(db, {
    sessionSeriesId: paidRegistration.sessionSeriesId,
    sessionEventId: paidRegistration.sessionEventId,
    registrationId: paidRegistration.id,
    organiserId: eventItem.organiserId || series.organiserId,
    userId: paidRegistration.userId,
    playerName: paidRegistration.playerName,
    playerEmail: paidRegistration.playerEmail,
    dataPartition: paidRegistration.dataPartition || getDataPartitionForEmail(paidRegistration.playerEmail),
    amount: eventItem.defaultPriceCasual ?? series.defaultPriceCasual,
    playerPaid: !!paidRegistration.playerPaid,
    organiserPaid: !!paidRegistration.organiserPaid,
    paymentReference: paidRegistration.paymentReference ?? null,
    paymentMethod: paidRegistration.stripeCheckoutSessionId ? "stripe" : "manual",
    stripeCheckoutSessionId: paidRegistration.stripeCheckoutSessionId ?? null,
    stripePaymentIntentId: paidRegistration.stripePaymentIntentId ?? null,
    effectivePaid,
    status: effectivePaid ? "paid" : "pending",
  });
}

export async function deletePaymentRecord(db: Firestore, registrationId: string) {
  await deleteDoc(doc(db, "payments", buildPaymentId(registrationId)));
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
