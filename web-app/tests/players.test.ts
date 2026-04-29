import test from "node:test";
import assert from "node:assert/strict";
import { shouldSyncSelfRegisteredPlayerDirectoryEntry } from "../src/lib/player-directory-sync.ts";
import {
  filterPlayersSelectableByOrganiserApproval,
} from "../src/lib/player-selection.ts";

type TestPlayerDirectoryEntry = {
  id: string;
  ownerOrganiserId: string | null;
  userId: string | null;
  displayName: string;
  email: string;
  source: "self-registered" | "manual";
};

test("admin and organiser accounts should not be mirrored into the shared player directory", () => {
  assert.equal(shouldSyncSelfRegisteredPlayerDirectoryEntry("player"), true);
  assert.equal(shouldSyncSelfRegisteredPlayerDirectoryEntry("organiser"), false);
  assert.equal(shouldSyncSelfRegisteredPlayerDirectoryEntry("admin"), false);
});

test("organiser dropdowns only include approved self-registered players", () => {
  const players: TestPlayerDirectoryEntry[] = [
    {
      id: "approved-player",
      ownerOrganiserId: null,
      userId: "approved-player",
      displayName: "Approved Player",
      email: "approved@example.com",
      source: "self-registered",
    },
    {
      id: "rejected-player",
      ownerOrganiserId: null,
      userId: "rejected-player",
      displayName: "Rejected Player",
      email: "rejected@example.com",
      source: "self-registered",
    },
    {
      id: "manual-player",
      ownerOrganiserId: "organiser-1",
      userId: null,
      displayName: "Manual Player",
      email: "",
      source: "manual",
    },
  ];

  const result = filterPlayersSelectableByOrganiserApproval(players, new Set(["approved-player"]));

  assert.deepEqual(
    result.map((player) => player.id),
    ["approved-player", "manual-player"],
  );
});
