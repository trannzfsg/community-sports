import test from "node:test";
import assert from "node:assert/strict";
import { getDashboardEventPresentation } from "../src/lib/dashboard-event-state.ts";

test("player state: going", () => {
  const result = getDashboardEventPresentation({
    role: "player",
    playerIsGoing: true,
    playerIsWaiting: false,
    playerCanJoin: false,
    eventIsFull: true,
    waitingListIsFull: false,
  });

  assert.equal(result.stateText, "going");
  assert.equal(result.className, "ring-emerald-300 bg-emerald-50");
});

test("player state: waiting list", () => {
  const result = getDashboardEventPresentation({
    role: "player",
    playerIsGoing: false,
    playerIsWaiting: true,
    playerCanJoin: true,
    eventIsFull: true,
    waitingListIsFull: false,
  });

  assert.equal(result.stateText, "waiting list");
  assert.equal(result.className, "ring-yellow-300 bg-yellow-50");
});

test("player state: available", () => {
  const result = getDashboardEventPresentation({
    role: "player",
    playerIsGoing: false,
    playerIsWaiting: false,
    playerCanJoin: true,
    eventIsFull: false,
    waitingListIsFull: false,
  });

  assert.equal(result.stateText, "available");
  assert.equal(result.className, "ring-blue-300 bg-blue-50");
});

test("player state: not available when waiting list full", () => {
  const result = getDashboardEventPresentation({
    role: "player",
    playerIsGoing: false,
    playerIsWaiting: false,
    playerCanJoin: false,
    eventIsFull: true,
    waitingListIsFull: true,
  });

  assert.equal(result.stateText, "not available");
  assert.equal(result.className, "ring-red-300 bg-red-50");
});

test("manager states: open/full/waiting list full", () => {
  const open = getDashboardEventPresentation({
    role: "organiser",
    playerIsGoing: false,
    playerIsWaiting: false,
    playerCanJoin: true,
    eventIsFull: false,
    waitingListIsFull: false,
  });
  assert.equal(open.stateText, "open");

  const full = getDashboardEventPresentation({
    role: "organiser",
    playerIsGoing: false,
    playerIsWaiting: false,
    playerCanJoin: false,
    eventIsFull: true,
    waitingListIsFull: false,
  });
  assert.equal(full.stateText, "full");

  const waitingFull = getDashboardEventPresentation({
    role: "admin",
    playerIsGoing: false,
    playerIsWaiting: false,
    playerCanJoin: false,
    eventIsFull: true,
    waitingListIsFull: true,
  });
  assert.equal(waitingFull.stateText, "waiting list full");
});
