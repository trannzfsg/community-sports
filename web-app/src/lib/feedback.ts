import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";

type DataPartition = "test" | "live";

export type FeedbackStatus = "active" | "completed" | "cancelled";
export type FeedbackVoteValue = 1 | -1;
export type FeedbackSectionSort = "date" | "upvotes" | "downvotes" | "netVotes" | "author";

export type FeedbackItem = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  authorRole: "player" | "organiser" | "admin";
  dataPartition: DataPartition;
  status: FeedbackStatus;
  createdAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

export type FeedbackVote = {
  id: string;
  feedbackId: string;
  userId: string;
  value: FeedbackVoteValue;
  dataPartition: DataPartition;
  updatedAt?: Timestamp | null;
};

export type FeedbackWithVotes = FeedbackItem & {
  upvotes: number;
  downvotes: number;
  netVotes: number;
  currentUserVote: FeedbackVoteValue | null;
};

export function buildFeedbackVoteId(feedbackId: string, userId: string) {
  return `${feedbackId}__${userId}`;
}

export function getToggledFeedbackVoteValue(
  currentVote: FeedbackVoteValue | null,
  nextVote: FeedbackVoteValue,
) {
  return currentVote === nextVote ? null : nextVote;
}

export function getFeedbackSectionDate(feedback: FeedbackItem) {
  if (feedback.status === "completed") return feedback.completedAt ?? null;
  if (feedback.status === "cancelled") return feedback.cancelledAt ?? null;
  return feedback.createdAt ?? null;
}

function timestampMillis(value?: Timestamp | null) {
  return value?.toMillis?.() ?? 0;
}

export function attachFeedbackVotes(
  feedbackItems: FeedbackItem[],
  votes: FeedbackVote[],
  currentUserId: string,
): FeedbackWithVotes[] {
  return feedbackItems.map((feedback) => {
    const feedbackVotes = votes.filter((vote) => vote.feedbackId === feedback.id);
    const upvotes = feedbackVotes.filter((vote) => vote.value === 1).length;
    const downvotes = feedbackVotes.filter((vote) => vote.value === -1).length;
    const currentUserVote = feedbackVotes.find((vote) => vote.userId === currentUserId)?.value ?? null;
    return {
      ...feedback,
      upvotes,
      downvotes,
      netVotes: upvotes - downvotes,
      currentUserVote,
    };
  });
}

export function sortFeedbackSection(
  feedbackItems: FeedbackWithVotes[],
  sortBy: FeedbackSectionSort,
) {
  return [...feedbackItems].sort((a, b) => {
    if (sortBy === "upvotes") {
      return b.upvotes - a.upvotes || timestampMillis(getFeedbackSectionDate(b)) - timestampMillis(getFeedbackSectionDate(a));
    }
    if (sortBy === "downvotes") {
      return b.downvotes - a.downvotes || timestampMillis(getFeedbackSectionDate(b)) - timestampMillis(getFeedbackSectionDate(a));
    }
    if (sortBy === "netVotes") {
      return b.netVotes - a.netVotes || timestampMillis(getFeedbackSectionDate(b)) - timestampMillis(getFeedbackSectionDate(a));
    }
    if (sortBy === "author") {
      return a.authorName.localeCompare(b.authorName) || timestampMillis(getFeedbackSectionDate(b)) - timestampMillis(getFeedbackSectionDate(a));
    }
    return timestampMillis(getFeedbackSectionDate(b)) - timestampMillis(getFeedbackSectionDate(a));
  });
}

export async function createFeedback(
  db: Firestore,
  input: {
    body: string;
    authorId: string;
    authorName: string;
    authorEmail: string;
    authorRole: FeedbackItem["authorRole"];
    dataPartition: DataPartition;
  },
) {
  const feedbackRef = doc(collection(db, "siteFeedback"));
  await setDoc(feedbackRef, {
    body: input.body.trim(),
    authorId: input.authorId,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    authorRole: input.authorRole,
    dataPartition: input.dataPartition,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return feedbackRef.id;
}

export async function getFeedback(db: Firestore, dataPartition: DataPartition) {
  const snapshot = await getDocs(
    query(collection(db, "siteFeedback"), where("dataPartition", "==", dataPartition)),
  );
  return snapshot.docs.map((feedbackDoc) => ({
    id: feedbackDoc.id,
    ...(feedbackDoc.data() as Omit<FeedbackItem, "id">),
  }));
}

export async function getFeedbackVotes(db: Firestore, dataPartition: DataPartition) {
  const snapshot = await getDocs(
    query(collection(db, "siteFeedbackVotes"), where("dataPartition", "==", dataPartition)),
  );
  return snapshot.docs.map((voteDoc) => ({
    id: voteDoc.id,
    ...(voteDoc.data() as Omit<FeedbackVote, "id">),
  }));
}

export async function setFeedbackVote(
  db: Firestore,
  input: {
    feedbackId: string;
    userId: string;
    value: FeedbackVoteValue;
    dataPartition: DataPartition;
  },
) {
  await setDoc(doc(db, "siteFeedbackVotes", buildFeedbackVoteId(input.feedbackId, input.userId)), {
    feedbackId: input.feedbackId,
    userId: input.userId,
    value: input.value,
    dataPartition: input.dataPartition,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function deleteFeedbackVote(
  db: Firestore,
  feedbackId: string,
  userId: string,
) {
  await deleteDoc(doc(db, "siteFeedbackVotes", buildFeedbackVoteId(feedbackId, userId)));
}

export async function deleteFeedback(db: Firestore, feedbackId: string) {
  await deleteDoc(doc(db, "siteFeedback", feedbackId));
}

export async function updateFeedbackStatus(
  db: Firestore,
  feedbackId: string,
  status: Exclude<FeedbackStatus, "active">,
) {
  await updateDoc(doc(db, "siteFeedback", feedbackId), {
    status,
    completedAt: status === "completed" ? serverTimestamp() : null,
    cancelledAt: status === "cancelled" ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}
