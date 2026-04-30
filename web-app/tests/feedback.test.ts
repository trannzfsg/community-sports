import test from "node:test";
import assert from "node:assert/strict";
import {
  attachFeedbackVotes,
  buildFeedbackVoteId,
  getToggledFeedbackVoteValue,
  sortFeedbackSection,
  type FeedbackItem,
  type FeedbackVote,
} from "../src/lib/feedback.ts";

function timestamp(ms: number) {
  return { toMillis: () => ms } as FeedbackItem["createdAt"];
}

test("buildFeedbackVoteId is deterministic per feedback and user", () => {
  assert.equal(buildFeedbackVoteId("feedback-1", "user-1"), "feedback-1__user-1");
});

test("attachFeedbackVotes counts votes and current user vote", () => {
  const feedback: FeedbackItem[] = [{
    id: "feedback-1",
    body: "Please add more filters.",
    authorId: "author-1",
    authorName: "Author",
    authorEmail: "author@example.com",
    authorRole: "player",
    dataPartition: "test",
    status: "active",
    createdAt: timestamp(1),
  }];
  const votes: FeedbackVote[] = [
    { id: "v1", feedbackId: "feedback-1", userId: "user-1", value: 1, dataPartition: "test" },
    { id: "v2", feedbackId: "feedback-1", userId: "user-2", value: -1, dataPartition: "test" },
    { id: "v3", feedbackId: "feedback-1", userId: "user-3", value: 1, dataPartition: "test" },
  ];

  const [item] = attachFeedbackVotes(feedback, votes, "user-2");
  assert.equal(item.upvotes, 2);
  assert.equal(item.downvotes, 1);
  assert.equal(item.netVotes, 1);
  assert.equal(item.currentUserVote, -1);
});

test("getToggledFeedbackVoteValue clears repeated votes", () => {
  assert.equal(getToggledFeedbackVoteValue(null, 1), 1);
  assert.equal(getToggledFeedbackVoteValue(-1, 1), 1);
  assert.equal(getToggledFeedbackVoteValue(1, 1), null);
  assert.equal(getToggledFeedbackVoteValue(-1, -1), null);
});

test("sortFeedbackSection uses the section date for date sorting", () => {
  const active = attachFeedbackVotes([
    {
      id: "old",
      body: "Old",
      authorId: "a",
      authorName: "B",
      authorEmail: "b@example.com",
      authorRole: "player",
      dataPartition: "test",
      status: "active",
      createdAt: timestamp(100),
    },
    {
      id: "new",
      body: "New",
      authorId: "a",
      authorName: "A",
      authorEmail: "a@example.com",
      authorRole: "player",
      dataPartition: "test",
      status: "active",
      createdAt: timestamp(200),
    },
  ], [], "user");

  assert.deepEqual(sortFeedbackSection(active, "date").map((item) => item.id), ["new", "old"]);
  assert.deepEqual(sortFeedbackSection(active, "author").map((item) => item.id), ["new", "old"]);
});
