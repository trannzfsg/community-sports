import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFreeEventPaymentState,
  buildRegistrationId,
  getActiveEventBlockingNextEventCreation,
  getCancelledEventForDate,
  getCancellationPolicyLabel,
  getDefaultNextSessionEventDate,
  getExistingNonCancelledEventForDate,
  getRegistrationCapacityState,
  getSessionEventOverrideValidationError,
  isFreeCasualPrice,
  isCancellationPolicyActive,
  normalizeSessionEventOverrides,
  normalizeWaitingListCapacity,
  planEventRegistrations,
  resolveNextSessionEventDate,
  UNLIMITED_WAITING_LIST_CAPACITY,
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

test("zero waiting-list capacity means unlimited hidden waiting list", () => {
  const state = getRegistrationCapacityState({
    capacity: 4,
    waitingListCapacity: 0,
    bookedCount: 4,
    waitingCount: 0,
  });

  assert.equal(state.waitingListCapacity, UNLIMITED_WAITING_LIST_CAPACITY);
  assert.equal(state.waitingListEnabled, true);
  assert.equal(state.waitingListIsFull, false);
  assert.equal(state.canAddMore, true);
  assert.equal(state.nextRegistrationStatus, "waiting");
});

test("next session event date skips over an existing weekly event on the requested date", () => {
  const nextDate = resolveNextSessionEventDate("2026-04-27", [
    "2026-04-20",
    "2026-04-27",
  ]);

  assert.equal(nextDate, "2026-05-04");
});

test("default next event date is the next series weekday after today", () => {
  const nextDate = getDefaultNextSessionEventDate(
    { dayOfWeek: "Mon" },
    new Date("2026-04-27T08:00:00.000+10:00"),
  );

  assert.equal(nextDate, "2026-05-04");
});

test("active events block next-event creation until they are closed", () => {
  const activeEvent = getActiveEventBlockingNextEventCreation([
    { id: "old-complete", eventDate: "2026-04-20", status: "completed" },
    { id: "current-active", eventDate: "2026-04-27", status: "active" },
    { id: "cancelled", eventDate: "2026-05-04", status: "cancelled" },
  ]);

  assert.equal(activeEvent?.id, "current-active");
});

test("cancelled event on the target date is reusable without treating it as a conflict", () => {
  const events = [
    { id: "cancelled", eventDate: "2026-05-04", status: "cancelled" },
    { id: "completed", eventDate: "2026-04-27", status: "completed" },
  ];

  assert.equal(getCancelledEventForDate(events, "2026-05-04")?.id, "cancelled");
  assert.equal(getExistingNonCancelledEventForDate(events, "2026-05-04"), undefined);
  assert.equal(getExistingNonCancelledEventForDate(events, "2026-04-27")?.id, "completed");
});

test("event creation planning auto-registers active series members", () => {
  const result = planEventRegistrations({
    eventDate: "2026-05-05",
    capacity: 1,
    waitingListCapacity: 1,
    activeMemberships: [
      {
        id: "membership-1",
        playerId: "player-1",
        playerName: "Member One",
        playerEmail: "member1@example.com",
        status: "active",
        playerPaid: true,
        organiserReceived: true,
        paymentReference: "MEM-PAID",
        joinedOrder: 1,
      },
      {
        id: "membership-2",
        playerId: "player-2",
        playerName: "Member Two",
        playerEmail: "member2@example.com",
        status: "active",
        joinedOrder: 2,
      },
    ],
  });

  assert.deepEqual(
    result.plannedRegistrations.map((registration) => ({
      userId: registration.userId,
      source: registration.source,
      status: registration.status,
      playerPaid: registration.playerPaid,
      organiserPaid: registration.organiserPaid,
      paymentReference: registration.paymentReference,
    })),
    [
      {
        userId: "player-1",
        source: "series-membership",
        status: "registered",
        playerPaid: true,
        organiserPaid: true,
        paymentReference: "MEM-PAID",
      },
      {
        userId: "player-2",
        source: "series-membership",
        status: "waiting",
        playerPaid: false,
        organiserPaid: false,
        paymentReference: null,
      },
    ],
  );
});

test("zero casual price auto marks registered entries as paid and received", () => {
  assert.equal(isFreeCasualPrice(0), true);
  assert.equal(isFreeCasualPrice(0.01), false);

  const result = planEventRegistrations({
    eventDate: "2026-05-05",
    capacity: 1,
    waitingListCapacity: 1,
    defaultPriceCasual: 0,
    activeMemberships: [
      {
        id: "membership-1",
        playerId: "player-1",
        playerName: "Member One",
        playerEmail: "member1@example.com",
        status: "active",
        joinedOrder: 1,
      },
      {
        id: "membership-2",
        playerId: "player-2",
        playerName: "Member Two",
        playerEmail: "member2@example.com",
        status: "active",
        joinedOrder: 2,
      },
    ],
  });

  assert.deepEqual(
    result.plannedRegistrations.map((registration) => ({
      status: registration.status,
      playerPaid: registration.playerPaid,
      organiserPaid: registration.organiserPaid,
    })),
    [
      { status: "registered", playerPaid: true, organiserPaid: true },
      { status: "waiting", playerPaid: false, organiserPaid: false },
    ],
  );
});

test("free event payment state applies only to registered players", () => {
  const baseRegistration = {
    id: "registration-1",
    sessionEventId: "event-1",
    sessionSeriesId: "series-1",
    userId: "player-1",
    playerName: "Player One",
    playerEmail: "player1@example.com",
    playerPaid: false,
    organiserPaid: false,
    status: "registered" as const,
  };

  assert.deepEqual(
    applyFreeEventPaymentState(baseRegistration, { defaultPriceCasual: 0 }),
    {
      ...baseRegistration,
      playerPaid: true,
      organiserPaid: true,
    },
  );

  assert.deepEqual(
    applyFreeEventPaymentState({ ...baseRegistration, status: "waiting" }, { defaultPriceCasual: 0 }),
    { ...baseRegistration, status: "waiting" },
  );
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

test("waiting-list normalization treats blank and zero as the hidden unlimited cap", () => {
  assert.equal(normalizeWaitingListCapacity(""), UNLIMITED_WAITING_LIST_CAPACITY);
  assert.equal(normalizeWaitingListCapacity(0), UNLIMITED_WAITING_LIST_CAPACITY);
  assert.equal(normalizeWaitingListCapacity("0"), UNLIMITED_WAITING_LIST_CAPACITY);
  assert.equal(normalizeWaitingListCapacity(3.9), 3);
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
