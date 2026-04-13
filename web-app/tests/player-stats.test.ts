import test from "node:test";
import assert from "node:assert/strict";
import {
  splitOrganiserVisiblePlayers,
  type OrganiserVisiblePlayerSplitCandidate,
} from "../src/lib/organiser-visible-players.ts";

type TestPlayer = OrganiserVisiblePlayerSplitCandidate & {
  key: string;
  displayName: string;
  email: string;
  skillLevel: null;
  gamesPlayed: number;
  playerId: string;
  userId: string | null;
  ownerOrganiserId: string;
  isSelfRegistered: boolean;
};

function buildPlayer(overrides: Partial<TestPlayer>): TestPlayer {
  return {
    key: "player-key",
    displayName: "Player",
    email: "player@example.com",
    skillLevel: null,
    gamesPlayed: 0,
    playerId: "player-1",
    userId: null,
    ownerOrganiserId: "organiser-1",
    isSelfRegistered: false,
    isEditablePrivatePlayer: false,
    hasRegisteredForOrganiser: false,
    ...overrides,
  };
}

test("splitOrganiserVisiblePlayers keeps editable private players out of registered history", () => {
  const editablePrivatePlayer = buildPlayer({
    key: "private-player",
    isEditablePrivatePlayer: true,
    hasRegisteredForOrganiser: true,
  });
  const linkedRegisteredPlayer = buildPlayer({
    key: "linked-player",
    userId: "user-1",
    isSelfRegistered: true,
    hasRegisteredForOrganiser: true,
  });
  const result = splitOrganiserVisiblePlayers([
    editablePrivatePlayer,
    linkedRegisteredPlayer,
  ]);

  assert.deepEqual(
    result.privatePlayers.map((player) => player.key),
    ["private-player"],
  );
  assert.deepEqual(
    result.registeredPlayers.map((player) => player.key),
    ["linked-player"],
  );
});
