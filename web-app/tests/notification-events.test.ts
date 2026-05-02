import test from "node:test";
import assert from "node:assert/strict";
import {
  countUnreadNotifications,
  normalizeNotificationEvent,
  sortNotificationEvents,
} from "../src/lib/notification-events.ts";

test("normalizeNotificationEvent keeps inbox fields stable", () => {
  const event = normalizeNotificationEvent("event-1", {
    title: " Payment confirmed ",
    body: " Your organiser confirmed payment. ",
    status: "sent",
    sourceCollection: "registrations",
    sourceId: "registration-1",
    createdAt: "2026-05-01T10:30:00Z",
    readAt: null,
  });

  assert.equal(event.id, "event-1");
  assert.equal(event.title, "Payment confirmed");
  assert.equal(event.body, "Your organiser confirmed payment.");
  assert.equal(event.status, "sent");
  assert.equal(event.sourceCollection, "registrations");
  assert.equal(event.sourceId, "registration-1");
  assert.equal(event.createdAt?.toISOString(), "2026-05-01T10:30:00.000Z");
  assert.equal(event.readAt, null);
});

test("sortNotificationEvents and countUnreadNotifications support the inbox", () => {
  const older = normalizeNotificationEvent("older", {
    createdAt: "2026-05-01T09:00:00Z",
    readAt: "2026-05-01T09:05:00Z",
  });
  const newer = normalizeNotificationEvent("newer", {
    createdAt: "2026-05-01T10:00:00Z",
  });

  assert.deepEqual(sortNotificationEvents([older, newer]).map((event) => event.id), [
    "newer",
    "older",
  ]);
  assert.equal(countUnreadNotifications([older, newer]), 1);
});
