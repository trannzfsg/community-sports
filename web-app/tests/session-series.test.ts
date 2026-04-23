import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRegistrationId,
  getCancellationPolicyLabel,
  getRegistrationCapacityState,
  getSessionEventOverrideValidationError,
  isCancellationPolicyActive,
  normalizeSessionEventOverrides,
  resolveNextSessionEventDate,
} from "../src/lib/session-series.ts";

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

test("next session event date skips over an existing weekly event on the requested date", () => {
  const nextDate = resolveNextSessionEventDate("2026-04-27", [
    "2026-04-20",
    "2026-04-27",
  ]);

  assert.equal(nextDate, "2026-05-04");
});

test("cancellation policy becomes active inside the configured hour window", () => {
  const blocked = isCancellationPolicyActive({
    eventDate: "2026-04-27",
    startAt: "19:00",
    cancellationPolicyHours: 24,
    now: new Date("2026-04-26T09:30:00.000Z"),
  });

  assert.equal(blocked, true);
});

test("cancellation policy stays inactive before the cutoff window", () => {
  const blocked = isCancellationPolicyActive({
    eventDate: "2026-04-27",
    startAt: "19:00",
    cancellationPolicyHours: 24,
    now: new Date("2026-04-25T08:59:59.000Z"),
  });

  assert.equal(blocked, false);
});

test("zero-hour cancellation policy disables the cutoff completely", () => {
  const blocked = isCancellationPolicyActive({
    eventDate: "2026-04-27",
    startAt: "19:00",
    cancellationPolicyHours: 0,
    now: new Date("2026-04-27T09:00:00.000Z"),
  });

  assert.equal(blocked, false);
  assert.equal(getCancellationPolicyLabel(0), "No cancellation cutoff");
});

test("event override normalization trims values and clamps numeric fields", () => {
  const normalized = normalizeSessionEventOverrides({
    location: "  Court 3  ",
    startAt: " 18:30 ",
    endAt: " 20:00 ",
    defaultPriceCasual: 17.129,
    capacity: -4,
    waitingListCapacity: 3.9,
  });

  assert.deepEqual(normalized, {
    location: "Court 3",
    startAt: "18:30",
    endAt: "20:00",
    defaultPriceCasual: 17.13,
    capacity: 0,
    waitingListCapacity: 3,
  });
});

test("event override validation blocks reducing total spots below existing registrations", () => {
  const error = getSessionEventOverrideValidationError({
    values: {
      location: "Court 1",
      startAt: "18:30",
      endAt: "20:00",
      defaultPriceCasual: 15,
      capacity: 2,
      waitingListCapacity: 1,
    },
    registrationCount: 4,
  });

  assert.equal(
    error,
    "This event already has 4 registrations. Increase capacity or waiting list spots before saving smaller totals.",
  );
});

test("event override validation requires end time after start time", () => {
  const error = getSessionEventOverrideValidationError({
    values: {
      location: "Court 1",
      startAt: "19:00",
      endAt: "18:30",
      defaultPriceCasual: 15,
      capacity: 6,
      waitingListCapacity: 2,
    },
  });

  assert.equal(error, "Event end time must be after the start time.");
});
