import test from "node:test";
import assert from "node:assert/strict";
import {
  getOrganiserBenefitStatus,
  getRecentSkipCount,
  planEventRegistrations,
} from "../src/lib/member-benefits.ts";

test("benefit status reports qualification once minimum games is reached", () => {
  assert.deepEqual(
    getOrganiserBenefitStatus({
      confirmedGames: 12,
      minGamesRequired: 10,
    }),
    {
      qualified: true,
      remainingGames: 0,
    },
  );
});

test("recent skip count only includes the last 10 weeks", () => {
  const count = getRecentSkipCount(
    ["2026-01-01", "2026-02-20", "2026-04-01", "2026-04-15"],
    "2026-04-18",
  );

  assert.equal(count, 3);
});

test("event planning gives active members priority before roster copy", () => {
  const result = planEventRegistrations({
    capacity: 2,
    waitingListCapacity: 1,
    activeMemberships: [
      {
        id: "series-1__player-1",
        playerId: "player-1",
        playerName: "Member One",
        playerEmail: "member1@example.com",
        joinedOrder: 1,
      },
      {
        id: "series-1__player-2",
        playerId: "player-2",
        playerName: "Member Two",
        playerEmail: "member2@example.com",
        skipNextEvent: true,
        joinedOrder: 2,
      },
    ],
    previousRegistrations: [
      {
        userId: "player-2",
        playerName: "Member Two",
        playerEmail: "member2@example.com",
        createdOrder: 1,
      },
      {
        userId: "player-3",
        playerName: "Roster Player",
        playerEmail: "roster@example.com",
        createdOrder: 2,
      },
    ],
  });

  assert.deepEqual(result.skippedMembershipIds, ["series-1__player-2"]);
  assert.deepEqual(
    result.plannedRegistrations.map((registration) => ({
      userId: registration.userId,
      source: registration.source,
      status: registration.status,
    })),
    [
      {
        userId: "player-1",
        source: "series-membership",
        status: "registered",
      },
      {
        userId: "player-3",
        source: "roster-copy",
        status: "registered",
      },
    ],
  );
});
