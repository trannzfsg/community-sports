"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import AppShell from "@/components/app-shell";
import { auth, db } from "@/lib/firebase";
import {
  getCurrentOnboardingVersion,
  getOnboardingContent,
  needsOnboarding,
  type OnboardingVersionState,
} from "@/lib/onboarding";
import type { AppRole } from "@/lib/roles";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
  onboardingSeenVersions?: OnboardingVersionState | null;
};

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const onboardingContent = useMemo(
    () => getOnboardingContent(profile?.role ?? "admin"),
    [profile?.role],
  );
  const onboardingIsRequired = needsOnboarding({
    role: profile?.role ?? "admin",
    seenVersions: profile?.onboardingSeenVersions,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        setError("");
        if (!currentUser) {
          router.push("/login");
          return;
        }

        const profileSnapshot = await getDoc(doc(db, "users", currentUser.uid));
        if (!profileSnapshot.exists()) {
          router.push("/dashboard");
          return;
        }

        const nextProfile = profileSnapshot.data() as UserProfile;
        if (nextProfile.role !== "player" && nextProfile.role !== "organiser") {
          router.push("/dashboard");
          return;
        }

        setUser(currentUser);
        setProfile(nextProfile);
      } catch (loadError) {
        console.error("[onboarding] load failed:", loadError);
        setError(loadError instanceof Error ? loadError.message : "Failed to load onboarding.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  async function handleAcknowledge() {
    if (!user || !profile) {
      return;
    }

    const currentVersion = getCurrentOnboardingVersion(profile.role);
    if (!currentVersion) {
      router.push(returnTo);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextSeenVersions: OnboardingVersionState = {
        ...(profile.onboardingSeenVersions || {}),
        [profile.role]: currentVersion,
      };
      await setDoc(doc(db, "users", user.uid), {
        onboardingSeenVersions: nextSeenVersions,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProfile((current) => current ? { ...current, onboardingSeenVersions: nextSeenVersions } : current);
      router.push(returnTo);
    } catch (saveError) {
      console.error("[onboarding] save failed:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Failed to save onboarding status.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading onboarding...
        </div>
      </main>
    );
  }

  if (!profile || !onboardingContent) {
    return null;
  }

  return (
    <AppShell role={profile.role} contentClassName="max-w-4xl">
      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid="onboarding-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">{onboardingContent.badge}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{onboardingContent.title}</h1>
            <p className="mt-3 max-w-3xl text-zinc-600">{onboardingContent.intro}</p>
          </div>
          <span className="rounded-full bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-700">
            Version {onboardingContent.version}
          </span>
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600" data-testid="onboarding-status-message">
          {onboardingIsRequired
            ? "Please review this onboarding once for your current role. Future onboarding updates will reopen automatically when the version changes."
            : "You are viewing the current onboarding guide for your role. Use the menu item any time you want to review it again."}
        </div>

        <div className="mt-8 space-y-6">
          {onboardingContent.sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-zinc-200 p-5">
              <h2 className="text-lg font-semibold text-zinc-900">{section.title}</h2>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-zinc-900" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleAcknowledge()}
            disabled={busy}
            data-testid="onboarding-primary-action"
            className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Saving..." : onboardingIsRequired ? "Finish onboarding" : "Back to dashboard"}
          </button>
          {!onboardingIsRequired ? (
            <Link
              href={returnTo}
              data-testid="onboarding-secondary-action"
              className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              Close
            </Link>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900"><div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading onboarding...</div></main>}>
      <OnboardingPageInner />
    </Suspense>
  );
}
