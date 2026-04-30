import test from "node:test";
import assert from "node:assert/strict";
import {
  canReceiveOnlinePayments,
  getStripeConnectStatusLabel,
} from "../src/lib/stripe-connect.ts";

test("canReceiveOnlinePayments requires organiser and ready Connect account", () => {
  assert.equal(canReceiveOnlinePayments({ role: "organiser" }), false);
  assert.equal(canReceiveOnlinePayments({
    role: "organiser",
    stripeConnect: {
      accountId: "acct_123",
      chargesEnabled: true,
      payoutsEnabled: true,
    },
  }), true);
  assert.equal(canReceiveOnlinePayments({
    role: "organiser",
    stripeConnect: {
      accountId: "acct_123",
      chargesEnabled: true,
      payoutsEnabled: false,
    },
  }), false);
  assert.equal(canReceiveOnlinePayments({
    role: "player",
    stripeConnect: {
      accountId: "acct_123",
      chargesEnabled: true,
      payoutsEnabled: true,
    },
  }), false);
});

test("getStripeConnectStatusLabel returns stable setup labels", () => {
  assert.equal(getStripeConnectStatusLabel(null), "Not set up");
  assert.equal(getStripeConnectStatusLabel({
    accountId: "acct_123",
    detailsSubmitted: false,
  }), "Setup incomplete");
  assert.equal(getStripeConnectStatusLabel({
    accountId: "acct_123",
    detailsSubmitted: true,
    chargesEnabled: false,
    payoutsEnabled: false,
  }), "Pending review");
  assert.equal(getStripeConnectStatusLabel({
    accountId: "acct_123",
    chargesEnabled: true,
    payoutsEnabled: true,
  }), "Ready");
});
