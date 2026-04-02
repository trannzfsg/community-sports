import test from "node:test";
import assert from "node:assert/strict";
import { resolveAuthProfile } from "../src/lib/auth-profile.ts";

test("managed user role overrides existing profile role", () => {
  const result = resolveAuthProfile({
    authEmail: "p@example.com",
    existing: { role: "player", displayName: "Player One" },
    managedUser: {
      id: "p@example.com",
      email: "p@example.com",
      displayName: "Org Person",
      role: "organiser",
      status: "active",
    },
  });

  assert.equal(result.role, "organiser");
  assert.equal(result.displayName, "Player One");
  assert.equal(result.email, "p@example.com");
});

test("falls back to player role and active status when unmanaged", () => {
  const result = resolveAuthProfile({
    authEmail: "new@example.com",
    authDisplayName: null,
    existing: {},
    managedUser: null,
  });

  assert.equal(result.role, "player");
  assert.equal(result.status, "active");
  assert.equal(result.displayName, "new@example.com");
});

test("fallback display name has highest priority when provided", () => {
  const result = resolveAuthProfile({
    fallbackDisplayName: "Chosen Name",
    authDisplayName: "Google Name",
    authEmail: "user@example.com",
    existing: { displayName: "Old Name", role: "player" },
  });

  assert.equal(result.displayName, "Chosen Name");
});

test("managed inactive status is preserved", () => {
  const result = resolveAuthProfile({
    authEmail: "inactive@example.com",
    managedUser: {
      id: "inactive@example.com",
      email: "inactive@example.com",
      displayName: "Inactive User",
      role: "player",
      status: "inactive",
    },
  });

  assert.equal(result.status, "inactive");
});
