import test from "node:test";
import assert from "node:assert/strict";
import {
  getCurrentOnboardingVersion,
  getOnboardingContent,
  needsOnboarding,
} from "../src/lib/onboarding.ts";

test("player and organiser onboarding content expose versioned guides", () => {
  const player = getOnboardingContent("player");
  const organiser = getOnboardingContent("organiser");

  assert.equal(typeof player?.version, "string");
  assert.equal(typeof organiser?.version, "string");
  assert.equal((player?.sections.length || 0) > 0, true);
  assert.equal((organiser?.sections.length || 0) > 0, true);
  assert.equal(
    organiser?.sections.some((section) => section.title === "Stripe Connect setup"),
    true,
  );
});

test("admin does not require onboarding", () => {
  assert.equal(getCurrentOnboardingVersion("admin"), null);
  assert.equal(needsOnboarding({ role: "admin" }), false);
});

test("missing or stale per-user version requires onboarding", () => {
  const currentVersion = getCurrentOnboardingVersion("player");
  assert.equal(currentVersion === null, false);

  assert.equal(
    needsOnboarding({
      role: "player",
      seenVersions: {},
    }),
    true,
  );

  assert.equal(
    needsOnboarding({
      role: "player",
      seenVersions: { player: "older-version" },
    }),
    true,
  );
});

test("matching per-user version clears onboarding requirement", () => {
  const currentVersion = getCurrentOnboardingVersion("organiser");
  assert.equal(currentVersion === null, false);

  assert.equal(
    needsOnboarding({
      role: "organiser",
      seenVersions: { organiser: String(currentVersion) },
    }),
    false,
  );
});
