"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AppRole } from "@/lib/roles";
import {
  DAY_OF_WEEK_OPTIONS,
  getNextGameOn,
  SPORT_OPTIONS,
} from "@/lib/session-options";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
};

export default function NewSessionPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [typeOfSport, setTypeOfSport] = useState<(typeof SPORT_OPTIONS)[number]>("Badminton");
  const [location, setLocation] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<(typeof DAY_OF_WEEK_OPTIONS)[number]>("Mon");
  const [startAt, setStartAt] = useState("19:00");
  const [endAt, setEndAt] = useState("21:00");
  const [firstSessionOn, setFirstSessionOn] = useState("");
  const [defaultPriceCasual, setDefaultPriceCasual] = useState("15");
  const [capacity, setCapacity] = useState("12");
  const [status, setStatus] = useState("active");
  const computedNextGameOn = useMemo(() => getNextGameOn(dayOfWeek), [dayOfWeek]);
  const [nextGameOn, setNextGameOn] = useState(computedNextGameOn);

  useEffect(() => {
    setNextGameOn(computedNextGameOn);
  }, [computedNextGameOn]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      const profileSnapshot = await getDoc(doc(db, "users", user.uid));
      const profile = profileSnapshot.data() as UserProfile | undefined;

      if (!profile || (profile.role !== "admin" && profile.role !== "organiser")) {
        router.push("/dashboard");
        return;
      }

      setAllowed(true);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("You need to be signed in.");
      }

      await addDoc(collection(db, "sessions"), {
        title: title.trim(),
        typeOfSport,
        location: location.trim(),
        dayOfWeek,
        nextGameOn,
        startAt,
        endAt,
        firstSessionOn,
        defaultPriceCasual: Number(defaultPriceCasual),
        bookedCount: 0,
        capacity: Number(capacity),
        organiserId: currentUser.uid,
        status,
        createdAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Failed to create session.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading session form...
        </div>
      </main>
    );
  }

  if (!allowed) {
    return null;
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Sessions
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Create a session</h1>
        <p className="mt-3 text-zinc-600">
          Admins can create any session. Organisers create and manage only their own sessions.
        </p>

        <form className="mt-8 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="Monday Social Badminton"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Type of sport</span>
            <select
              value={typeOfSport}
              onChange={(event) => setTypeOfSport(event.target.value as (typeof SPORT_OPTIONS)[number])}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
            >
              {SPORT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Location</span>
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="Community Hall Court 1"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Day of week</span>
            <select
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(event.target.value as (typeof DAY_OF_WEEK_OPTIONS)[number])}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
            >
              {DAY_OF_WEEK_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Next game on</span>
            <input
              type="date"
              value={nextGameOn}
              onChange={(event) => setNextGameOn(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">First session on</span>
            <input
              type="date"
              value={firstSessionOn}
              onChange={(event) => setFirstSessionOn(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Start time</span>
            <input
              type="time"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">End time</span>
            <input
              type="time"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Casual price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={defaultPriceCasual}
              onChange={(event) => setDefaultPriceCasual(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Capacity</span>
            <input
              type="number"
              min="1"
              step="1"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="full">full</option>
            </select>
          </label>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">
              {error}
            </div>
          ) : null}

          <div className="md:col-span-2 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Creating..." : "Create session"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
