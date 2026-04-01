import test from "node:test";
import assert from "node:assert/strict";
import { buildRegistrationId, getRegistrationCapacityState } from "../src/lib/session-series.ts";

test("buildRegistrationId is deterministic and safe for document ids", () => {
  const id = buildRegistrationId("series__20260402", "user:test@example.com");
  assert.equal(id, "series__20260402__user_3Atest_40example.com");
});

test("capacity state keeps player in registered list while spots remain", () => {
  const state = getRegistrationCapacityState({
    capacity: 4,
    waitingListCapacity: 2,
    bookedCount: 3,
    waitingCount: 0,
  });

  assert.equal(state.eventIsFull, false);
  assert.equal(state.canAddMore, true);
  assert.equal(state.nextRegistrationStatus, "registered");
});

test("capacity state sends overflow players to waiting list when enabled", () => {
  const state = getRegistrationCapacityState({
    capacity: 4,
    waitingListCapacity: 2,
    bookedCount: 4,
    waitingCount: 1,
  });

  assert.equal(state.eventIsFull, true);
  assert.equal(state.waitingListEnabled, true);
  assert.equal(state.waitingListIsFull, false);
  assert.equal(state.canAddMore, true);
  assert.equal(state.nextRegistrationStatus, "waiting");
});

test("capacity state blocks additions when both event and waiting list are full", () => {
  const state = getRegistrationCapacityState({
    capacity: 4,
    waitingListCapacity: 2,
    bookedCount: 4,
    waitingCount: 2,
  });

  assert.equal(state.eventIsFull, true);
  assert.equal(state.waitingListIsFull, true);
  assert.equal(state.canAddMore, false);
  assert.equal(state.nextRegistrationStatus, null);
});

test("zero waiting-list capacity means full event cannot accept more players", () => {
  const state = getRegistrationCapacityState({
    capacity: 4,
    waitingListCapacity: 0,
    bookedCount: 4,
    waitingCount: 0,
  });

  assert.equal(state.waitingListEnabled, false);
  assert.equal(state.waitingListIsFull, true);
  assert.equal(state.canAddMore, false);
  assert.equal(state.nextRegistrationStatus, null);
});
