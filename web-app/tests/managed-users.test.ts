import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManagedUserId,
  normalizeEmail,
  shouldPersistManagedUserRecord,
} from "../src/lib/managed-users.ts";

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  TeSt.User+Tag@Example.COM  "), "test.user+tag@example.com");
});

test("buildManagedUserId always uses canonical normalized email", () => {
  assert.equal(buildManagedUserId(" ORG.Admin@Example.com "), "org.admin@example.com");
});

test("registered organisers should not persist managed user docs", () => {
  assert.equal(shouldPersistManagedUserRecord(null), true);
  assert.equal(shouldPersistManagedUserRecord(""), true);
  assert.equal(shouldPersistManagedUserRecord("registered-organiser-uid"), false);
});
