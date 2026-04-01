"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import DatePicker from "@/components/date-picker";
import { auth, db } from "@/lib/firebase";
import type { AppRole } from "@/lib/roles";
import {
  DAY_OF_WEEK_OPTIONS,
  getEffectiveNextGameOn,
  getSuggestedNextGameOn,
  SPORT_OPTIONS,
} from "@/lib/session-options";
import { getUserById, getUsersByRole, type UserRecord } from "@/lib/users";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
};

type SessionSeries = {
  title: string;
  typeOfSport: (typeof SPORT_OPTIONS)[number];
  location: string;
  dayOfWeek: (typeof DAY_OF_WEEK_OPTIONS)[number];
  nextGameOn?: string;
  startAt: string;
  endAt: string;
  firstSessionOn: string;
  defaultPriceCasual: number;
  capacity: number;
  waitingListCapacity?: number;
  organiserId: string;
  organiserName?: string;
  status: string;
  copyRosterFromLastEvent?: boolean;
};

function EditSessionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id") ?? "";
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [organisers, setOrganisers] = useState<UserRecord[]>([]);
  const [ownerOrganiserId, setOwnerOrganiserId] = useState("");
  const [currentRole, setCurrentRole] = useState<AppRole | null>(null);

  const [title, setTitle] = useState("");
  const [typeOfSport, setTypeOfSport] = useState<(typeof SPORT_OPTIONS)[number]>("Badminton");
  const [location, setLocation] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<(typeof DAY_OF_WEEK_OPTIONS)[number]>("Mon");
  const [nextGameOn, setNextGameOn] = useState("");
  const [startAt, setStartAt] = useState("19:00");
  const [endAt, setEndAt] = useState("21:00");
  const [firstSessionOn, setFirstSessionOn] = useState("");
  const [defaultPriceCasual, setDefaultPriceCasual] = useState("15");
  const [capacity, setCapacity] = useState("12");
  const [waitingListCapacity, setWaitingListCapacity] = useState("0");
  const [status, setStatus] = useState("active");
  const [copyRosterFromLastEvent, setCopyRosterFromLastEvent] = useState(true);

  const computedNextGameOn = useMemo(
    () => getSuggestedNextGameOn(dayOfWeek, startAt),
    [dayOfWeek, startAt],
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !sessionId) {
        router.push("/dashboard");
        return;
      }

      const profileSnapshot = await getDoc(doc(db, "users", user.uid));
      const sessionSnapshot = await getDoc(doc(db, "sessions", sessionId));

      const profile = profileSnapshot.data() as UserProfile | undefined;
      const session = sessionSnapshot.data() as SessionSeries | undefined;

      if (!profile || !sessionSnapshot.exists() || !session) {
        router.push("/dashboard");
        return;
      }

      const canEdit =
        profile.role === "admin" ||
        (profile.role === "organiser" && session.organiserId === user.uid);

      if (!canEdit) {
        router.push("/dashboard");
        return;
      }

      setCurrentRole(profile.role);
      if (profile.role === "admin") {
        const organiserUsers = await getUsersByRole(db, "organiser");
        setOrganisers(organiserUsers);
      }
      setAllowed(true);
      setTitle(session.title);
      setTypeOfSport(session.typeOfSport);
      setLocation(session.location);
      setDayOfWeek(session.dayOfWeek);
      setStartAt(session.startAt);
      setEndAt(session.endAt);
      setOwnerOrganiserId(session.organiserId || user.uid);
      setNextGameOn(
        getEffectiveNextGameOn(
          session.dayOfWeek,
          session.startAt,
          session.nextGameOn,
        ),
      );
      setFirstSessionOn(session.firstSessionOn);
      setDefaultPriceCasual(String(session.defaultPriceCasual));
      setCapacity(String(session.capacity));
      setWaitingListCapacity(String(session.waitingListCapacity || 0));
      setStatus(session.status);
      setCopyRosterFromLastEvent(session.copyRosterFromLastEvent ?? true);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router, sessionId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("You need to be signed in.");
      }

      const organiserId = currentRole === "organiser" ? currentUser.uid : ownerOrganiserId;
      if (!organiserId) {
        throw new Error("Session series must have an organiser owner.");
      }

      const organiser = await getUserById(db, organiserId);
      const organiserName = organiser?.displayName || organiser?.email || "Organiser";

      await updateDoc(doc(db, "sessions", sessionId), {
        title: title.trim(),
        organiserId,
        organiserName,
        typeOfSport,
        location: location.trim(),
        dayOfWeek,
        nextGameOn,
        startAt,
        endAt,
        firstSessionOn,
        defaultPriceCasual: Number(defaultPriceCasual),
        capacity: Number(capacity),
        waitingListCapacity: Number(waitingListCapacity || 0),
        status,
        copyRosterFromLastEvent,
      });

      router.push("/dashboard");
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Failed to update session series.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading session series...
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
          Session series
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Edit session series</h1>
        <p className="mt-3 text-zinc-600">
          Organisers can edit their own series. Admins can edit any series.
        </p>

        <form className="mt-8 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          {currentRole === "admin" ? (
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-zinc-700">Owner organiser</span>
              <select value={ownerOrganiserId} onChange={(event) => setOwnerOrganiserId(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required>
                {organisers.map((organiser) => (
                  <option key={organiser.id} value={organiser.id}>
                    {(organiser.displayName || organiser.email || organiser.id)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Series title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Type of sport</span>
            <select value={typeOfSport} onChange={(event) => setTypeOfSport(event.target.value as (typeof SPORT_OPTIONS)[number])} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
              {SPORT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Location</span>
            <input value={location} onChange={(event) => setLocation(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Day of week</span>
            <select value={dayOfWeek} onChange={(event) => setDayOfWeek(event.target.value as (typeof DAY_OF_WEEK_OPTIONS)[number])} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
              {DAY_OF_WEEK_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Next game on</span>
            <DatePicker value={nextGameOn} onChange={setNextGameOn} required />
            <button type="button" onClick={() => setNextGameOn(computedNextGameOn)} className="mt-2 text-sm font-medium text-zinc-600 underline-offset-4 hover:underline">
              Reset to suggested date ({computedNextGameOn})
            </button>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">First session on</span>
            <DatePicker value={firstSessionOn} onChange={setFirstSessionOn} required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Start time</span>
            <input type="time" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">End time</span>
            <input type="time" value={endAt} onChange={(event) => setEndAt(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Casual price</span>
            <input type="number" min="0" step="0.01" value={defaultPriceCasual} onChange={(event) => setDefaultPriceCasual(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Capacity</span>
            <input type="number" min="1" step="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Waiting list capacity</span>
            <input type="number" min="0" step="1" value={waitingListCapacity} onChange={(event) => setWaitingListCapacity(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="full">full</option>
            </select>
          </label>

          <label className="flex items-start gap-3 md:col-span-2">
            <input type="checkbox" checked={copyRosterFromLastEvent} onChange={(event) => setCopyRosterFromLastEvent(event.target.checked)} className="mt-1 h-4 w-4" />
            <span className="text-sm text-zinc-700">Automatically copy the roster from the last event in this series when a new event is created.</span>
          </label>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">{error}</div> : null}

          <div className="md:col-span-2 flex gap-3">
            <button type="submit" disabled={busy} className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Saving..." : "Save changes"}
            </button>
            <button type="button" onClick={() => router.push("/dashboard")} className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium hover:bg-zinc-100">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function EditSessionPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900"><div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading session series...</div></main>}>
      <EditSessionPageInner />
    </Suspense>
  );
}
