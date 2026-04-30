"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import AppShell from "@/components/app-shell";
import ProLockedOverlay from "@/components/pro-locked-overlay";
import { auth, db } from "@/lib/firebase";
import { getSubscriptionLabel, isPro, type UserSubscription } from "@/lib/subscription";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
} from "@/lib/subscription-billing";
import type { DataPartition } from "@/lib/data-partition";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  dataPartition?: DataPartition;
  subscription?: UserSubscription | null;
};

function formatPeriodEnd(subscription?: UserSubscription | null) {
  const value = subscription?.currentPeriodEnd;
  if (!value) return null;
  const date = "toDate" in value ? value.toDate() : value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function OrganiserSubscriptionPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        setError("");
        if (!user) {
          router.push("/login");
          return;
        }

        const snapshot = await getDoc(doc(db, "users", user.uid));
        const nextProfile = snapshot.data() as UserProfile | undefined;
        if (!nextProfile || nextProfile.role !== "organiser") {
          router.push("/dashboard");
          return;
        }

        setCurrentUser(user);
        setProfile(nextProfile);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load subscription.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  async function handleBillingAction(action: "checkout" | "portal") {
    if (!currentUser) return;
    setBusy(action);
    setError("");
    try {
      const idToken = await currentUser.getIdToken();
      const returnUrl = `${window.location.origin}/organiser/subscription`;
      const result = action === "checkout"
        ? await createBillingCheckoutSession({ idToken, returnUrl })
        : await createBillingPortalSession({ idToken, returnUrl });
      window.location.assign(result.url);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to open Stripe Billing.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading subscription...</div>
      </main>
    );
  }

  const subscription = profile?.subscription ?? null;
  const proActive = isPro(profile);
  const periodEnd = formatPeriodEnd(subscription);
  const canManageStripe = !!subscription?.stripeCustomerId && !subscription.grantedByAdmin;

  return (
    <AppShell role="organiser" contentClassName="max-w-4xl">
      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Pro</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Subscription</h1>
        <p className="mt-3 text-zinc-600">
          Pro unlocks organiser premium features as they are released.
        </p>

        <div className="mt-6 rounded-2xl border border-zinc-200 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-500">Current plan</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-950">{getSubscriptionLabel(subscription)}</div>
              {periodEnd ? <div className="mt-1 text-sm text-zinc-500">Current period ends {periodEnd}</div> : null}
            </div>
            <div className={`rounded-full px-4 py-2 text-sm font-semibold ${proActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
              {proActive ? "Pro enabled" : "Free"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <ProLockedOverlay feature="inAppPayments" compact />
          <ProLockedOverlay feature="accounting" compact />
          <ProLockedOverlay feature="pushNotifications" compact />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {proActive && canManageStripe ? (
            <button
              type="button"
              onClick={() => void handleBillingAction("portal")}
              disabled={busy != null}
              className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "portal" ? "Opening..." : "Manage billing"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleBillingAction("checkout")}
              disabled={busy != null || proActive}
              className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "checkout" ? "Opening..." : proActive ? "Pro active" : "Upgrade to Pro"}
            </button>
          )}
        </div>

        {subscription?.grantedByAdmin ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            This organiser has Pro access granted by an admin.
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
