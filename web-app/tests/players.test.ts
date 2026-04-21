import test from "node:test";
import assert from "node:assert/strict";
import { shouldSyncSelfRegisteredPlayerDirectoryEntry } from "../src/lib/player-directory-sync.ts";

test("admin and organiser accounts should not be mirrored into the shared player directory", () => {
  assert.equal(shouldSyncSelfRegisteredPlayerDirectoryEntry("player"), true);
  assert.equal(shouldSyncSelfRegisteredPlayerDirectoryEntry("organiser"), false);
  assert.equal(shouldSyncSelfRegisteredPlayerDirectoryEntry("admin"), false);
});
