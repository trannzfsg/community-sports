import test from "node:test";
import assert from "node:assert/strict";
import {
  attachFeedbackVotes,
  buildFeedbackVoteId,
  getToggledFeedbackVoteValue,
  sortFeedbackComments,
  sortFeedbackSection,
  type FeedbackComment,
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
  const comments: FeedbackComment[] = [
    {
      id: "comment-2",
      feedbackId: "feedback-1",
      body: "Second",
      authorId: "user-2",
      authorName: "User 2",
      authorEmail: "user2@example.com",
      authorRole: "organiser",
      dataPartition: "test",
      createdAt: timestamp(20),
    },
    {
      id: "comment-1",
      feedbackId: "feedback-1",
      body: "First",
      authorId: "user-1",
      authorName: "User 1",
      authorEmail: "user1@example.com",
      authorRole: "player",
      dataPartition: "test",
      createdAt: timestamp(10),
    },
  ];

  const [item] = attachFeedbackVotes(feedback, votes, "user-2", comments);
  assert.equal(item.upvotes, 2);
  assert.equal(item.downvotes, 1);
  assert.equal(item.netVotes, 1);
  assert.equal(item.currentUserVote, -1);
  assert.equal(item.commentCount, 2);
  assert.deepEqual(item.comments.map((comment) => comment.id), ["comment-1", "comment-2"]);
});

test("getToggledFeedbackVoteValue clears repeated votes", () => {
  assert.equal(getToggledFeedbackVoteValue(null, 1), 1);
  assert.equal(getToggledFeedbackVoteValue(-1, 1), 1);
  assert.equal(getToggledFeedbackVoteValue(1, 1), null);
  assert.equal(getToggledFeedbackVoteValue(-1, -1), null);
});

test("sortFeedbackSection sorts all supported orderings descending", () => {
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
    {
      id: "popular",
      body: "Popular",
      authorId: "a",
      authorName: "C",
      authorEmail: "c@example.com",
      authorRole: "player",
      dataPartition: "test",
      status: "active",
      createdAt: timestamp(150),
    },
  ], [
    { id: "v1", feedbackId: "popular", userId: "u1", value: 1, dataPartition: "test" },
    { id: "v2", feedbackId: "popular", userId: "u2", value: 1, dataPartition: "test" },
    { id: "v3", feedbackId: "old", userId: "u3", value: -1, dataPartition: "test" },
    { id: "v4", feedbackId: "old", userId: "u4", value: -1, dataPartition: "test" },
  ], "user");

  assert.deepEqual(sortFeedbackSection(active, "date").map((item) => item.id), ["new", "popular", "old"]);
  assert.deepEqual(sortFeedbackSection(active, "upvotes").map((item) => item.id), ["popular", "new", "old"]);
  assert.deepEqual(sortFeedbackSection(active, "downvotes").map((item) => item.id), ["old", "new", "popular"]);
  assert.deepEqual(sortFeedbackSection(active, "netVotes").map((item) => item.id), ["popular", "new", "old"]);
});

test("sortFeedbackComments sorts oldest first", () => {
  const comments: FeedbackComment[] = [
    {
      id: "new",
      feedbackId: "feedback-1",
      body: "New",
      authorId: "user-1",
      authorName: "User",
      authorEmail: "user@example.com",
      authorRole: "player",
      dataPartition: "test",
      createdAt: timestamp(200),
    },
    {
      id: "old",
      feedbackId: "feedback-1",
      body: "Old",
      authorId: "user-1",
      authorName: "User",
      authorEmail: "user@example.com",
      authorRole: "player",
      dataPartition: "test",
      createdAt: timestamp(100),
    },
  ];

  assert.deepEqual(sortFeedbackComments(comments).map((comment) => comment.id), ["old", "new"]);
});
