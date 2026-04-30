import test from "node:test";
import assert from "node:assert/strict";
import {
  getSubscriptionLabel,
  isPro,
  isSubscriptionActive,
  subscriptionBannerState,
} from "../src/lib/subscription.ts";

test("isSubscriptionActive accepts active, trialing, admin grant, and grace-period cancelled subscriptions", () => {
  const now = new Date("2026-04-30T00:00:00Z");

  assert.equal(isSubscriptionActive({ tier: "pro", status: "active" }, now), true);
  assert.equal(isSubscriptionActive({ tier: "pro", status: "trialing" }, now), true);
  assert.equal(isSubscriptionActive({ tier: "pro", grantedByAdmin: true }, now), true);
  assert.equal(isSubscriptionActive({
    tier: "pro",
    status: "canceled",
    currentPeriodEnd: new Date("2026-05-01T00:00:00Z"),
  }, now), true);
  assert.equal(isSubscriptionActive({
    tier: "pro",
    status: "canceled",
    currentPeriodEnd: new Date("2026-04-01T00:00:00Z"),
  }, now), false);
  assert.equal(isSubscriptionActive({ tier: "free", status: null }, now), false);
});

test("isPro treats admins as pro and limits organiser pro to active subscriptions", () => {
  assert.equal(isPro({ role: "admin" }), true);
  assert.equal(isPro({ role: "organiser", subscription: { tier: "pro", status: "active" } }), true);
  assert.equal(isPro({ role: "organiser", subscription: { tier: "free", status: null } }), false);
  assert.equal(isPro({ role: "player", subscription: { tier: "pro", status: "active" } }), false);
});

test("subscription labels and banner states are stable", () => {
  assert.equal(getSubscriptionLabel({ tier: "pro", grantedByAdmin: true }), "Pro granted by admin");
  assert.equal(getSubscriptionLabel({ tier: "pro", status: "past_due" }), "Pro payment due");
  assert.equal(getSubscriptionLabel(null), "Free");
  assert.equal(subscriptionBannerState({ role: "player" }), "hidden");
  assert.equal(subscriptionBannerState({ role: "organiser", subscription: { tier: "free" } }), "hidden");
  assert.equal(subscriptionBannerState({ role: "organiser", subscription: { tier: "pro", status: "active" } }), "hidden");
});
