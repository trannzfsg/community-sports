import type { Timestamp } from "firebase/firestore";

export type SubscriptionTier = "free" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing" | null;
export type SubscriptionModel = "flat_monthly" | "txn_cut" | "admin_grant" | null;
export type PremiumFeatureKey = "inAppPayments" | "accounting" | "pushNotifications";

export type UserSubscription = {
  tier?: SubscriptionTier;
  status?: SubscriptionStatus;
  model?: SubscriptionModel;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Timestamp | Date | null;
  grantedByAdmin?: boolean;
  grantedByAdminAt?: Timestamp | Date | null;
  grantedByAdminBy?: string | null;
};

export type SubscriptionUser = {
  role?: "player" | "organiser" | "admin" | null;
  subscription?: UserSubscription | null;
};

export function isSubscriptionActive(subscription?: UserSubscription | null, now = new Date()) {
  if (!subscription) return false;
  if (subscription.grantedByAdmin === true && subscription.tier === "pro") return true;
  if (subscription.tier !== "pro") return false;
  if (subscription.status === "active" || subscription.status === "trialing") return true;
  if (subscription.status === "canceled" && subscription.currentPeriodEnd) {
    const periodEnd = "toDate" in subscription.currentPeriodEnd
      ? subscription.currentPeriodEnd.toDate()
      : subscription.currentPeriodEnd;
    return periodEnd.getTime() > now.getTime();
  }
  return false;
}

export function isPro(user?: SubscriptionUser | null, now = new Date()) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "organiser" && isSubscriptionActive(user.subscription, now);
}

export function hasFeature(
  user: SubscriptionUser | null | undefined,
  featureKey: PremiumFeatureKey,
) {
  if (!["inAppPayments", "accounting", "pushNotifications"].includes(featureKey)) {
    return false;
  }
  return user?.role === "admin" || user?.role === "organiser" || user?.role === "player";
}

export function getSubscriptionLabel(subscription?: UserSubscription | null) {
  if (subscription?.grantedByAdmin && subscription.tier === "pro") return "Pro granted by admin";
  if (subscription?.tier === "pro" && subscription.status === "active") return "Pro active";
  if (subscription?.tier === "pro" && subscription.status === "trialing") return "Pro trial";
  if (subscription?.tier === "pro" && subscription.status === "past_due") return "Pro payment due";
  if (subscription?.tier === "pro" && subscription.status === "canceled") return "Pro cancelled";
  return "Free";
}

export function subscriptionBannerState(user?: SubscriptionUser | null) {
  if (!user) return "hidden";
  return "hidden";
}
