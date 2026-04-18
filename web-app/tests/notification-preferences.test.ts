import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultNotificationPreferences,
  normalizeNotificationPreferences,
} from "../src/lib/notification-preferences.ts";

test("buildDefaultNotificationPreferences disables every notification", () => {
  const preferences = buildDefaultNotificationPreferences("user-123", "test");

  assert.deepEqual(preferences, {
    userId: "user-123",
    dataPartition: "test",
    email: {
      enabled: false,
    },
    telegram: {
      enabled: false,
      chatId: "",
      chatType: "private",
    },
    organiser: {
      approvalRequested: false,
      playerRegistered: false,
      playerRemoved: false,
      paymentReferenceUpdated: false,
    },
    player: {
      approvalApproved: false,
      paymentDueSoon: false,
      movedFromWaitlist: false,
      paymentConfirmed: false,
      newEventOpened: false,
    },
  });
});

test("normalizeNotificationPreferences merges partial values with defaults", () => {
  const preferences = normalizeNotificationPreferences(
    {
      userId: "wrong-user",
      email: {enabled: true},
      telegram: {
        enabled: true,
        chatId: "  -100987654321  ",
        chatType: "group",
      },
      organiser: {
        approvalRequested: true,
      },
      player: {
        paymentConfirmed: true,
      },
    },
    {
      userId: "user-123",
      dataPartition: "live",
    },
  );

  assert.deepEqual(preferences, {
    userId: "wrong-user",
    dataPartition: "live",
    email: {
      enabled: true,
    },
    telegram: {
      enabled: true,
      chatId: "-100987654321",
      chatType: "group",
    },
    organiser: {
      approvalRequested: true,
      playerRegistered: false,
      playerRemoved: false,
      paymentReferenceUpdated: false,
    },
    player: {
      approvalApproved: false,
      paymentDueSoon: false,
      movedFromWaitlist: false,
      paymentConfirmed: true,
      newEventOpened: false,
    },
    createdAt: undefined,
    updatedAt: undefined,
  });
});
