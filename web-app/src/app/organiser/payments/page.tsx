"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import AppShell from "@/components/app-shell";
import { auth, db } from "@/lib/firebase";
import {
  canReceiveOnlinePayments,
  createConnectAccountLink,
  getStripeConnectStatusLabel,
  refreshConnectAccountStatus,
  type StripeConnectStatus,
} from "@/lib/stripe-connect";
import type { DataPartition } from "@/lib/data-partition";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  dataPartition?: DataPartition;
  stripeConnect?: StripeConnectStatus | null;
};

function statusClassName(ready: boolean) {
  return ready ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600";
}

export default function OrganiserPaymentsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"setup" | "refresh" | null>(null);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async (user: User) => {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const nextProfile = snapshot.data() as UserProfile | undefined;
    if (!nextProfile || nextProfile.role !== "organiser") {
      router.push("/dashboard");
      return;
    }

    setCurrentUser(user);
    setProfile(nextProfile);
  }, [router]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        setError("");
        if (!user) {
          router.push("/login");
          return;
        }

        await loadProfile(user);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load payment setup.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [loadProfile, router]);

  async function handleSetup() {
    if (!currentUser) return;
    setBusy("setup");
    setError("");
    try {
      const idToken = await currentUser.getIdToken();
      const returnUrl = `${window.location.origin}/organiser/payments`;
      const result = await createConnectAccountLink({ idToken, returnUrl });
      window.location.assign(result.url);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Unable to open Stripe setup.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    if (!currentUser) return;
    setBusy("refresh");
    setError("");
    try {
      const idToken = await currentUser.getIdToken();
      const returnUrl = `${window.location.origin}/organiser/payments`;
      const result = await refreshConnectAccountStatus({ idToken, returnUrl });
      setProfile((current) => current ? {
        ...current,
        stripeConnect: result.stripeConnect,
      } : current);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh Stripe status.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading payment setup...</div>
      </main>
    );
  }

  const connect = profile?.stripeConnect ?? null;
  const ready = canReceiveOnlinePayments(profile);

  return (
    <AppShell role="organiser" contentClassName="max-w-4xl">
      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Payments</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Online payment setup</h1>
        <p className="mt-3 max-w-3xl text-zinc-600">
          Stripe Connect is optional. You can keep using manual payment references; Connect is only required before online payments are enabled for a series.
        </p>

        <div className="mt-6 rounded-2xl border border-zinc-200 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-500">Stripe Connect status</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-950">{getStripeConnectStatusLabel(connect)}</div>
              {connect?.disabledReason ? (
                <div className="mt-1 text-sm text-zinc-500">Stripe needs attention: {connect.disabledReason}</div>
              ) : null}
              {connect?.currentlyDue?.length ? (
                <div className="mt-1 text-sm text-zinc-500">Outstanding Stripe fields: {connect.currentlyDue.length}</div>
              ) : null}
            </div>
            <div className={`rounded-full px-4 py-2 text-sm font-semibold ${statusClassName(ready)}`}>
              {ready ? "Ready for online payments" : "Manual payments only"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 p-4">
            <h2 className="text-base font-semibold text-zinc-950">1. Start setup</h2>
            <p className="mt-2 text-sm text-zinc-600">Open Stripe&apos;s secure onboarding page from here.</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 p-4">
            <h2 className="text-base font-semibold text-zinc-950">2. Add payout details</h2>
            <p className="mt-2 text-sm text-zinc-600">Stripe collects identity, bank, and business details directly.</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 p-4">
            <h2 className="text-base font-semibold text-zinc-950">3. Enable online payments</h2>
            <p className="mt-2 text-sm text-zinc-600">Once ready, online checkout can be enabled on paid series.</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleSetup()}
            disabled={busy != null}
            className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "setup" ? "Opening..." : connect?.accountId ? "Continue Stripe setup" : "Set up Stripe Connect"}
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={busy != null || !connect?.accountId}
            className="rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "refresh" ? "Refreshing..." : "Refresh status"}
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
