"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { deletePaymentRecord } from "@/lib/payments";
import AppShell from "@/components/app-shell";
import DatePicker from "@/components/date-picker";
import SearchablePlayerSelect from "@/components/searchable-player-select";
import { auth, db } from "@/lib/firebase";
import { getDataPartitionForEmail, resolveDataPartition, type DataPartition } from "@/lib/data-partition";
import type { AppRole } from "@/lib/roles";
import {
  buildSeriesMembershipId,
  getSeriesMembershipsForSeries,
  updateSeriesMembershipSettings,
  updateSeriesMembershipStatus,
  type SeriesMembership,
} from "@/lib/member-benefits";
import { getVisiblePlayersForOrganiser, type PlayerDirectoryEntry } from "@/lib/players";
import {
  DAY_OF_WEEK_OPTIONS,
  getEffectiveNextGameOn,
  getSuggestedNextGameOn,
  SPORT_OPTIONS,
} from "@/lib/session-options";
import {
  buildSessionEventId,
  createSessionEventForSeries,
  getWaitingListCapacityInputValue,
  normalizeWaitingListCapacity,
  type SessionSeries as SessionSeriesRecord,
} from "@/lib/session-series";
import { getUserById, getUsersByRole, type UserRecord } from "@/lib/users";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
  dataPartition?: DataPartition;
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
  cancellationPolicyHours?: number | null;
  organiserId: string;
  organiserName?: string;
  dataPartition?: "test" | "live";
  status: string;
  copyRosterFromLastEvent?: boolean;
  seriesMembershipEnabled?: boolean;
  seriesMembershipDefaultStartDate?: string | null;
  seriesMembershipDefaultEndDate?: string | null;
  seriesMembershipAutoPaidUntilDate?: string | null;
};

type MembershipDraft = {
  startDate: string;
  endDate: string;
  autoPaidUntilDate: string;
};

function buildMembershipDraft(membership: SeriesMembership): MembershipDraft {
  return {
    startDate: membership.startDate ?? "",
    endDate: membership.endDate ?? "",
    autoPaidUntilDate: membership.autoPaidUntilDate ?? "",
  };
}

function formatDateOnly(value?: string | null) {
  if (!value) return "None";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

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
  const [dataPartition, setDataPartition] = useState<DataPartition>("live");
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [seriesMemberships, setSeriesMemberships] = useState<SeriesMembership[]>([]);
  const [membershipDraftsById, setMembershipDraftsById] = useState<Record<string, MembershipDraft>>({});
  const [memberBusyKey, setMemberBusyKey] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [typeOfSport, setTypeOfSport] = useState<(typeof SPORT_OPTIONS)[number]>("Badminton");
  const [location, setLocation] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<(typeof DAY_OF_WEEK_OPTIONS)[number]>("Mon");
  const [nextGameOn, setNextGameOn] = useState("");
  const [originalNextGameOn, setOriginalNextGameOn] = useState("");
  const [startAt, setStartAt] = useState("19:00");
  const [endAt, setEndAt] = useState("21:00");
  const [firstSessionOn, setFirstSessionOn] = useState("");
  const [defaultPriceCasual, setDefaultPriceCasual] = useState("15");
  const [capacity, setCapacity] = useState("12");
  const [waitingListCapacity, setWaitingListCapacity] = useState("0");
  const [cancellationPolicyHours, setCancellationPolicyHours] = useState("24");
  const [status, setStatus] = useState("active");
  const [seriesMembershipEnabled, setSeriesMembershipEnabled] = useState(false);
  const [seriesMembershipDefaultStartDate, setSeriesMembershipDefaultStartDate] = useState("");
  const [seriesMembershipDefaultEndDate, setSeriesMembershipDefaultEndDate] = useState("");
  const [seriesMembershipAutoPaidUntilDate, setSeriesMembershipAutoPaidUntilDate] = useState("");

  const computedNextGameOn = useMemo(
    () => getSuggestedNextGameOn(dayOfWeek, startAt),
    [dayOfWeek, startAt],
  );

  useEffect(() => {
    const nextDrafts: Record<string, MembershipDraft> = {};
    seriesMemberships.forEach((membership) => {
      nextDrafts[membership.id] = buildMembershipDraft(membership);
    });
    setMembershipDraftsById(nextDrafts);
  }, [seriesMemberships]);

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
      const resolvedPartition = resolveDataPartition(profile.email || user.email || "", profile.dataPartition || "live");
      setDataPartition(resolvedPartition);
      if (profile.role === "admin") {
        const organiserUsers = await getUsersByRole(db, "organiser", resolvedPartition);
        setOrganisers(organiserUsers);
      }
      const [visiblePlayers, memberships] = await Promise.all([
        getVisiblePlayersForOrganiser(db, session.organiserId || user.uid, resolvedPartition),
        getSeriesMembershipsForSeries(db, sessionId, session.organiserId || user.uid, resolvedPartition),
      ]);
      setPlayerDirectory(visiblePlayers.sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setSeriesMemberships(memberships.sort((a, b) => a.playerName.localeCompare(b.playerName)));
      setAllowed(true);
      setTitle(session.title);
      setTypeOfSport(session.typeOfSport);
      setLocation(session.location);
      setDayOfWeek(session.dayOfWeek);
      setStartAt(session.startAt);
      setEndAt(session.endAt);
      setOwnerOrganiserId(session.organiserId || user.uid);
      const effectiveNextGameOn = getEffectiveNextGameOn(
        session.dayOfWeek,
        session.startAt,
        session.nextGameOn,
      );
      setNextGameOn(effectiveNextGameOn);
      setOriginalNextGameOn(effectiveNextGameOn);
      setFirstSessionOn(session.firstSessionOn);
      setDefaultPriceCasual(String(session.defaultPriceCasual));
      setCapacity(String(session.capacity));
      setWaitingListCapacity(getWaitingListCapacityInputValue(session.waitingListCapacity));
      setCancellationPolicyHours(String(session.cancellationPolicyHours ?? 24));
      setStatus(session.status);
      setSeriesMembershipEnabled(session.seriesMembershipEnabled ?? false);
      setSeriesMembershipDefaultStartDate(session.seriesMembershipDefaultStartDate ?? "");
      setSeriesMembershipDefaultEndDate(session.seriesMembershipDefaultEndDate ?? "");
      setSeriesMembershipAutoPaidUntilDate(session.seriesMembershipAutoPaidUntilDate ?? "");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router, sessionId]);

  async function refreshSeriesMemberships(nextOrganiserId = ownerOrganiserId) {
    if (!sessionId || !nextOrganiserId) return;
    const memberships = await getSeriesMembershipsForSeries(db, sessionId, nextOrganiserId, dataPartition);
    setSeriesMemberships(memberships.sort((a, b) => a.playerName.localeCompare(b.playerName)));
  }

  function handleMembershipDraftChange(
    membershipId: string,
    field: keyof MembershipDraft,
    value: string,
  ) {
    setMembershipDraftsById((current) => ({
      ...current,
      [membershipId]: {
        ...(current[membershipId] || { startDate: "", endDate: "", autoPaidUntilDate: "" }),
        [field]: value,
      },
    }));
  }

  async function handleAddSeriesMember(selection: { type: "existing"; player: PlayerDirectoryEntry } | { type: "create"; name: string }) {
    if (selection.type === "create") return;
    const currentUser = auth.currentUser;
    if (!currentUser || !sessionId || !ownerOrganiserId) return;

    const player = selection.player;
    const playerId = player.userId || player.id;
    if (seriesMemberships.some((membership) => membership.playerId === playerId && membership.status !== "cancelled")) {
      return;
    }

    const membershipId = buildSeriesMembershipId(sessionId, playerId);
    setMemberBusyKey("add-member");
    try {
      await setDoc(doc(db, "seriesMemberships", membershipId), {
        seriesId: sessionId,
        organiserId: ownerOrganiserId,
        playerId,
        playerName: player.displayName,
        playerEmail: player.email,
        status: "active",
        startDate: null,
        endDate: null,
        autoPaidUntilDate: null,
        approvedAtDate: new Date().toISOString().slice(0, 10),
        skipNextEvent: false,
        skipCount: 0,
        skipDates: [],
        dataPartition,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await refreshSeriesMemberships();
    } finally {
      setMemberBusyKey(null);
    }
  }

  async function handleSeriesMembershipDetailsSave(membership: SeriesMembership) {
    setMemberBusyKey(`save-membership-${membership.id}`);
    try {
      const draft = membershipDraftsById[membership.id] || buildMembershipDraft(membership);
      await updateSeriesMembershipSettings(db, membership.id, {
        startDate: draft.startDate || null,
        endDate: draft.endDate || null,
        autoPaidUntilDate: draft.autoPaidUntilDate || null,
      });
      await refreshSeriesMemberships(membership.organiserId);
    } finally {
      setMemberBusyKey(null);
    }
  }

  async function handleSeriesMembershipStatusChange(
    membership: SeriesMembership,
    status: SeriesMembership["status"],
  ) {
    setMemberBusyKey(`${status}-membership-${membership.id}`);
    try {
      const draft = membershipDraftsById[membership.id] || buildMembershipDraft(membership);
      await updateSeriesMembershipSettings(db, membership.id, {
        startDate: draft.startDate || null,
        endDate: draft.endDate || null,
        autoPaidUntilDate: draft.autoPaidUntilDate || null,
        approvedAtDate: status === "active"
          ? (membership.approvedAtDate || new Date().toISOString().slice(0, 10))
          : membership.approvedAtDate,
      });
      await updateSeriesMembershipStatus(db, membership.id, status);
      await refreshSeriesMemberships(membership.organiserId);
    } finally {
      setMemberBusyKey(null);
    }
  }

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
      const dataPartition = getDataPartitionForEmail(organiser?.email || "");

      const updatedSeries: SessionSeriesRecord = {
        id: sessionId,
        title: title.trim(),
        organiserId,
        organiserName,
        dataPartition,
        typeOfSport,
        location: location.trim(),
        dayOfWeek,
        nextGameOn,
        startAt,
        endAt,
        firstSessionOn,
        defaultPriceCasual: Number(defaultPriceCasual),
        capacity: Number(capacity),
        waitingListCapacity: normalizeWaitingListCapacity(waitingListCapacity),
        cancellationPolicyHours: Number(cancellationPolicyHours || 0),
        status,
        seriesMembershipEnabled,
        seriesMembershipDefaultStartDate: seriesMembershipDefaultStartDate || null,
        seriesMembershipDefaultEndDate: seriesMembershipDefaultEndDate || null,
        seriesMembershipAutoPaidUntilDate: seriesMembershipAutoPaidUntilDate || null,
      };

      await updateDoc(doc(db, "sessions", sessionId), updatedSeries);

      if (originalNextGameOn && nextGameOn !== originalNextGameOn) {
        const previousEventId = buildSessionEventId(sessionId, originalNextGameOn);
        const previousEventRef = doc(db, "sessionEvents", previousEventId);
        const previousEventSnapshot = await getDoc(previousEventRef);

        if (previousEventSnapshot.exists()) {
          const registrationsSnapshot = await getDocs(
            query(
              collection(db, "registrations"),
              where("sessionEventId", "==", previousEventId),
              where("dataPartition", "==", dataPartition),
            ),
          );

          for (const registrationDoc of registrationsSnapshot.docs) {
            await deletePaymentRecord(db, registrationDoc.id);
            await deleteDoc(registrationDoc.ref);
          }

          await deleteDoc(previousEventRef);
        }

        await createSessionEventForSeries(db, updatedSeries, nextGameOn);
      }

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
    <AppShell role={currentRole ?? "organiser"} contentClassName="max-w-3xl">
      <div className="w-full rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
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

          <section className="rounded-2xl border border-zinc-200 p-4 md:col-span-2" data-testid="edit-series-members">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Series members</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Members are auto-added before casual players when the next event is created.
            </p>
            <div className="mt-4">
              <SearchablePlayerSelect
                players={playerDirectory.filter((player) => {
                  const playerId = player.userId || player.id;
                  return !seriesMemberships.some((membership) => membership.playerId === playerId && membership.status !== "cancelled");
                })}
                allowCreate={false}
                noOptionsText="No eligible players available."
                disabled={memberBusyKey === "add-member"}
                onSelectOrCreate={handleAddSeriesMember}
              />
            </div>

            <div className="mt-4 space-y-3">
              {seriesMemberships.length ? seriesMemberships.map((membership) => {
                const membershipDraft = membershipDraftsById[membership.id] || buildMembershipDraft(membership);

                return (
                  <div key={membership.id} className="rounded-2xl border border-zinc-200 p-4" data-testid={`series-membership-card-${membership.id}`}>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-zinc-900">{membership.playerName}</div>
                          <div className="text-sm text-zinc-500">{membership.playerEmail}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            Status: {membership.status} · Total skips: {membership.skipCount} · Recent 10 weeks: {membership.recentTenWeekSkipCount || 0}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            Start: {formatDateOnly(membership.startDate || seriesMembershipDefaultStartDate || membership.approvedAtDate)}
                            {" · "}End: {formatDateOnly(membership.endDate || seriesMembershipDefaultEndDate)}
                            {" · "}Auto paid: {formatDateOnly(membership.autoPaidUntilDate || seriesMembershipAutoPaidUntilDate)}
                          </div>
                          {membership.skipNextEvent ? (
                            <div className="mt-1 text-xs font-medium text-amber-700">Will skip the next auto-registration.</div>
                          ) : null}
                        </div>
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                          {membership.status}
                        </span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block text-xs text-zinc-600">
                          <span className="mb-1 block font-medium text-zinc-700">Member start override</span>
                          <input
                            type="date"
                            value={membershipDraft.startDate}
                            onChange={(event) => handleMembershipDraftChange(membership.id, "startDate", event.target.value)}
                            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          />
                        </label>
                        <label className="block text-xs text-zinc-600">
                          <span className="mb-1 block font-medium text-zinc-700">Member end override</span>
                          <input
                            type="date"
                            value={membershipDraft.endDate}
                            min={membershipDraft.startDate || undefined}
                            onChange={(event) => handleMembershipDraftChange(membership.id, "endDate", event.target.value)}
                            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          />
                        </label>
                        <label className="block text-xs text-zinc-600">
                          <span className="mb-1 block font-medium text-zinc-700">Auto paid override</span>
                          <input
                            type="date"
                            value={membershipDraft.autoPaidUntilDate}
                            onChange={(event) => handleMembershipDraftChange(membership.id, "autoPaidUntilDate", event.target.value)}
                            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSeriesMembershipDetailsSave(membership)}
                          disabled={memberBusyKey === `save-membership-${membership.id}`}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {memberBusyKey === `save-membership-${membership.id}` ? "Saving..." : "Save member"}
                        </button>
                        {membership.status === "pending" || membership.status === "paused" || membership.status === "rejected" || membership.status === "cancelled" ? (
                          <button
                            type="button"
                            onClick={() => void handleSeriesMembershipStatusChange(membership, "active")}
                            disabled={memberBusyKey === `active-membership-${membership.id}`}
                            className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Make active
                          </button>
                        ) : null}
                        {membership.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => void handleSeriesMembershipStatusChange(membership, "paused")}
                            disabled={memberBusyKey === `paused-membership-${membership.id}`}
                            className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Pause
                          </button>
                        ) : null}
                        {membership.status !== "cancelled" ? (
                          <button
                            type="button"
                            onClick={() => void handleSeriesMembershipStatusChange(membership, "cancelled")}
                            disabled={memberBusyKey === `cancelled-membership-${membership.id}`}
                            className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="text-sm text-zinc-500">No members for this series yet.</div>
              )}
            </div>
          </section>

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
    </AppShell>
  );
}

export default function EditSessionPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900"><div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading session series...</div></main>}>
      <EditSessionPageInner />
    </Suspense>
  );
}
