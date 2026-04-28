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
    eventDate: "2026-04-21",
    capacity: 2,
    waitingListCapacity: 1,
    activeMemberships: [
      {
        id: "series-1__player-1",
        playerId: "player-1",
        playerName: "Member One",
        playerEmail: "member1@example.com",
        status: "active",
        joinedOrder: 1,
      },
      {
        id: "series-1__player-2",
        playerId: "player-2",
        playerName: "Member Two",
        playerEmail: "member2@example.com",
        status: "active",
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
      playerPaid: registration.playerPaid,
      organiserPaid: registration.organiserPaid,
      status: registration.status,
    })),
    [
      {
        userId: "player-1",
        source: "series-membership",
        playerPaid: false,
        organiserPaid: false,
        status: "registered",
      },
      {
        userId: "player-3",
        source: "roster-copy",
        playerPaid: false,
        organiserPaid: false,
        status: "registered",
      },
    ],
  );
});

test("event planning respects membership dates and auto-paid windows", () => {
  const result = planEventRegistrations({
    eventDate: "2026-04-21",
    capacity: 3,
    waitingListCapacity: 0,
    activeMemberships: [
      {
        id: "series-1__future-member",
        playerId: "future-member",
        playerName: "Future Member",
        playerEmail: "future@example.com",
        status: "active",
        startDate: "2026-04-25",
        joinedOrder: 1,
      },
      {
        id: "series-1__ended-member",
        playerId: "ended-member",
        playerName: "Ended Member",
        playerEmail: "ended@example.com",
        status: "active",
        endDate: "2026-04-20",
        joinedOrder: 2,
      },
      {
        id: "series-1__paid-member",
        playerId: "paid-member",
        playerName: "Paid Member",
        playerEmail: "paid@example.com",
        status: "active",
        playerPaid: true,
        organiserPaid: true,
        paymentReference: "MEM-2026",
        joinedOrder: 3,
      },
    ],
    previousRegistrations: [],
  });

  assert.deepEqual(
    result.plannedRegistrations.map((registration) => ({
      userId: registration.userId,
      playerPaid: registration.playerPaid,
      organiserPaid: registration.organiserPaid,
      paymentReference: registration.paymentReference,
    })),
    [
      {
        userId: "paid-member",
        playerPaid: true,
        organiserPaid: true,
        paymentReference: "MEM-2026",
      },
    ],
  );
});
