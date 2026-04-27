"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import AppShell from "@/components/app-shell";
import DatePicker from "@/components/date-picker";
import { auth, db } from "@/lib/firebase";
import { getDataPartitionForEmail, resolveDataPartition, type DataPartition } from "@/lib/data-partition";
import type { AppRole } from "@/lib/roles";
import {
  DAY_OF_WEEK_OPTIONS,
  getNextDateForDayOfWeekAfterToday,
  SPORT_OPTIONS,
} from "@/lib/session-options";
import { createSessionEventForSeries, normalizeWaitingListCapacity, type SessionSeries } from "@/lib/session-series";
import { getUserById, getUsersByRole, type UserRecord } from "@/lib/users";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
  dataPartition?: DataPartition;
};

export default function NewSessionPage() {
  const router = useRouter();
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
  const [startAt, setStartAt] = useState("19:00");
  const [endAt, setEndAt] = useState("21:00");
  const [defaultPriceCasual, setDefaultPriceCasual] = useState("15");
  const [capacity, setCapacity] = useState("12");
  const [waitingListCapacity, setWaitingListCapacity] = useState("");
  const [cancellationPolicyHours, setCancellationPolicyHours] = useState("24");
  const [status, setStatus] = useState("active");
  const [seriesMembershipEnabled, setSeriesMembershipEnabled] = useState(false);
  const [seriesMembershipDefaultStartDate, setSeriesMembershipDefaultStartDate] = useState("");
  const [seriesMembershipDefaultEndDate, setSeriesMembershipDefaultEndDate] = useState("");
  const [seriesMembershipAutoPaidUntilDate, setSeriesMembershipAutoPaidUntilDate] = useState("");
  const [createNextEventNow, setCreateNextEventNow] = useState(true);
  const computedNextGameOn = useMemo(
    () => getNextDateForDayOfWeekAfterToday(dayOfWeek),
    [dayOfWeek],
  );

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

      setCurrentRole(profile.role);
      const dataPartition = resolveDataPartition(profile.email || user.email || "", profile.dataPartition || "live");
      if (profile.role === "admin") {
        const organiserUsers = await getUsersByRole(db, "organiser", dataPartition);
        setOrganisers(organiserUsers);
        setOwnerOrganiserId(organiserUsers[0]?.id || "");
      } else {
        setOwnerOrganiserId(user.uid);
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

      const organiserId = currentRole === "organiser" ? currentUser.uid : ownerOrganiserId;
      if (!organiserId) {
        throw new Error("Event series must have an organiser owner.");
      }

      const organiser = await getUserById(db, organiserId);
      const organiserName = organiser?.displayName || organiser?.email || "Organiser";
      const dataPartition = getDataPartitionForEmail(organiser?.email || "");

      const normalizedWaitingListCapacity = normalizeWaitingListCapacity(waitingListCapacity);

      const seriesRef = await addDoc(collection(db, "sessions"), {
        title: title.trim(),
        typeOfSport,
        location: location.trim(),
        dayOfWeek,
        nextGameOn: computedNextGameOn,
        startAt,
        endAt,
        firstSessionOn: computedNextGameOn,
        defaultPriceCasual: Number(defaultPriceCasual),
        capacity: Number(capacity),
        waitingListCapacity: normalizedWaitingListCapacity,
        cancellationPolicyHours: Number(cancellationPolicyHours || 0),
        organiserId,
        organiserName,
        dataPartition,
        status,
        seriesMembershipEnabled,
        seriesMembershipDefaultStartDate: seriesMembershipDefaultStartDate || null,
        seriesMembershipDefaultEndDate: seriesMembershipDefaultEndDate || null,
        seriesMembershipAutoPaidUntilDate: seriesMembershipAutoPaidUntilDate || null,
        createdAt: serverTimestamp(),
      });

      if (createNextEventNow) {
        const series: SessionSeries = {
          id: seriesRef.id,
          title: title.trim(),
          typeOfSport,
          location: location.trim(),
          dayOfWeek,
          nextGameOn: computedNextGameOn,
          startAt,
          endAt,
          firstSessionOn: computedNextGameOn,
          defaultPriceCasual: Number(defaultPriceCasual),
          capacity: Number(capacity),
          waitingListCapacity: normalizedWaitingListCapacity,
          cancellationPolicyHours: Number(cancellationPolicyHours || 0),
          organiserId,
          organiserName,
          dataPartition,
          status,
          seriesMembershipEnabled,
          seriesMembershipDefaultStartDate: seriesMembershipDefaultStartDate || null,
          seriesMembershipDefaultEndDate: seriesMembershipDefaultEndDate || null,
          seriesMembershipAutoPaidUntilDate: seriesMembershipAutoPaidUntilDate || null,
        };
        await createSessionEventForSeries(db, series);
      }

      router.push("/dashboard");
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Failed to create event series.");
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
    <AppShell role={currentRole ?? "organiser"} contentClassName="max-w-3xl">
      <div className="w-full rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Event series
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Create an event series</h1>
        <p className="mt-3 text-zinc-600">
          An event series defines the recurring schedule. Individual events happen on specific dates inside that series.
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
            <span className="mb-2 block text-sm font-medium text-zinc-700">Event series title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" placeholder="Monday Social Badminton" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Type of sport</span>
            <select value={typeOfSport} onChange={(event) => setTypeOfSport(event.target.value as (typeof SPORT_OPTIONS)[number])} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
              {SPORT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Location</span>
            <input value={location} onChange={(event) => setLocation(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" placeholder="Community Hall Court 1" required />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Day of week</span>
            <select value={dayOfWeek} onChange={(event) => setDayOfWeek(event.target.value as (typeof DAY_OF_WEEK_OPTIONS)[number])} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
              {DAY_OF_WEEK_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
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
            <input type="number" min="0" step="1" value={waitingListCapacity} onChange={(event) => setWaitingListCapacity(event.target.value)} placeholder="Unlimited" className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" />
            <span className="mt-2 block text-sm text-zinc-500">Leave blank or use 0 for unlimited waiting list.</span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Cancellation policy (hours)</span>
            <input type="number" min="0" step="1" value={cancellationPolicyHours} onChange={(event) => setCancellationPolicyHours(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
            <span className="mt-2 block text-sm text-zinc-500">Use 0 to allow players to cancel at any time. Default is 24 hours before the event starts.</span>
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
            <input type="checkbox" checked={seriesMembershipEnabled} onChange={(event) => setSeriesMembershipEnabled(event.target.checked)} className="mt-1 h-4 w-4" />
            <span className="text-sm text-zinc-700">Enable organiser-managed recurring membership for automatic registration into future events.</span>
          </label>

          {seriesMembershipEnabled ? (
            <div className="rounded-2xl border border-zinc-200 p-4 md:col-span-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Membership defaults</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Leave the start date blank to use the organiser approval date. Leave the end date blank for open-ended membership. If auto paid is set, auto-registered members are marked as paid and received through that event date.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-700">Default member start date</span>
                  <DatePicker
                    value={seriesMembershipDefaultStartDate}
                    onChange={setSeriesMembershipDefaultStartDate}
                    allowClear
                    placeholder="Use approval date"
                    clearLabel="Use approval date"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-700">Default member end date</span>
                  <DatePicker
                    value={seriesMembershipDefaultEndDate}
                    onChange={setSeriesMembershipDefaultEndDate}
                    allowClear
                    min={seriesMembershipDefaultStartDate || undefined}
                    placeholder="No end date"
                    clearLabel="No end date"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-700">Auto paid and received until</span>
                  <DatePicker
                    value={seriesMembershipAutoPaidUntilDate}
                    onChange={setSeriesMembershipAutoPaidUntilDate}
                    allowClear
                    placeholder="No auto-paid date"
                    clearLabel="No auto-paid date"
                  />
                </label>
              </div>
            </div>
          ) : null}

          <label className="flex items-start gap-3 md:col-span-2">
            <input type="checkbox" checked={createNextEventNow} onChange={(event) => setCreateNextEventNow(event.target.checked)} className="mt-1 h-4 w-4" />
            <span className="text-sm text-zinc-700">Create the next event immediately for the next scheduled date.</span>
          </label>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">{error}</div> : null}

          <div className="md:col-span-2 flex gap-3">
            <button type="submit" disabled={busy} className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Creating..." : "Create event series"}
            </button>
            <button type="button" onClick={() => router.push("/dashboard")} className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium hover:bg-zinc-100">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
