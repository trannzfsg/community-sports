import test from "node:test";
import assert from "node:assert/strict";
import { shouldRemoveRegistrationForInactivatedPlayer } from "../src/lib/admin-player-flows.ts";

test("past event registrations are preserved when player is inactivated", () => {
  assert.equal(
    shouldRemoveRegistrationForInactivatedPlayer({
      today: "2026-04-03",
      eventDate: "2026-04-02",
    }),
    false,
  );
});

test("today and future event registrations are removed when player is inactivated", () => {
  assert.equal(
    shouldRemoveRegistrationForInactivatedPlayer({
      today: "2026-04-03",
      eventDate: "2026-04-03",
    }),
    true,
  );

  assert.equal(
    shouldRemoveRegistrationForInactivatedPlayer({
      today: "2026-04-03",
      eventDate: "2026-04-10",
    }),
    true,
  );
});
