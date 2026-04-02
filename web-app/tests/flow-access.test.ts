import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessAdminArea,
  canEditSeries,
  canManageSessions,
  getManagerEventState,
  getPlayerEventState,
  getPlayerRegisterButtonLabel,
} from "../src/lib/flow-access.ts";
import type { RegistrationItem } from "../src/lib/session-series.ts";

test("admin + organiser can manage sessions, player cannot", () => {
  assert.equal(canManageSessions("admin"), true);
  assert.equal(canManageSessions("organiser"), true);
  assert.equal(canManageSessions("player"), false);
});

test("only admin can access admin-only areas", () => {
  assert.equal(canAccessAdminArea("admin"), true);
  assert.equal(canAccessAdminArea("organiser"), false);
  assert.equal(canAccessAdminArea("player"), false);
});

test("series edit permission: admin any series, organiser only own series", () => {
  assert.equal(canEditSeries("admin", "admin-1", "org-2"), true);
  assert.equal(canEditSeries("organiser", "org-1", "org-1"), true);
  assert.equal(canEditSeries("organiser", "org-1", "org-2"), false);
  assert.equal(canEditSeries("player", "player-1", "org-1"), false);
});

test("player event state flow", () => {
  const registered = { status: "registered" } as RegistrationItem;
  const waiting = { status: "waiting" } as RegistrationItem;

  assert.equal(getPlayerEventState({ currentRegistration: registered, canAddMore: false }), "going");
  assert.equal(getPlayerEventState({ currentRegistration: waiting, canAddMore: true }), "waiting list");
  assert.equal(getPlayerEventState({ canAddMore: true }), "available");
  assert.equal(getPlayerEventState({ canAddMore: false }), "not available");
});

test("manager event state flow", () => {
  assert.equal(getManagerEventState({ eventIsFull: false, waitingListIsFull: false }), "open");
  assert.equal(getManagerEventState({ eventIsFull: true, waitingListIsFull: false }), "full");
  assert.equal(getManagerEventState({ eventIsFull: true, waitingListIsFull: true }), "waiting list full");
});

test("player registration call-to-action changes when event is full", () => {
  assert.equal(getPlayerRegisterButtonLabel({ eventIsFull: false }), "Register");
  assert.equal(getPlayerRegisterButtonLabel({ eventIsFull: true }), "Join waiting list");
});
