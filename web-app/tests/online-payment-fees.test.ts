import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOnlinePaymentFeeBreakdown,
  dollarsToCents,
  formatAud,
} from "../src/lib/online-payment-fees.ts";

test("calculates player total with platform fee and card fee recovery", () => {
  const breakdown = calculateOnlinePaymentFeeBreakdown({
    organiserAmountCents: dollarsToCents(15),
  });

  assert.deepEqual(breakdown, {
    organiserAmountCents: 1500,
    platformFeeCents: 30,
    stripeFeeRecoveryCents: 57,
    playerTotalCents: 1587,
  });
});

test("supports custom fee settings", () => {
  const breakdown = calculateOnlinePaymentFeeBreakdown({
    organiserAmountCents: 2500,
    platformFeeBps: 250,
    stripeFeeBps: 200,
    stripeFixedFeeCents: 50,
  });

  assert.equal(breakdown.platformFeeCents, 63);
  assert.equal(breakdown.playerTotalCents, 2667);
  assert.equal(breakdown.stripeFeeRecoveryCents, 104);
});

test("formats Australian dollar totals", () => {
  assert.equal(formatAud(1587), "$15.87");
});
