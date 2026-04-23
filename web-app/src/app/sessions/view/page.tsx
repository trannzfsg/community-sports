"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import AppShell from "@/components/app-shell";
import EventRegistrationRow from "@/components/event-registration-row";
import { auth, db } from "@/lib/firebase";
import { resolveDataPartition, type DataPartition } from "@/lib/data-partition";
import type { AppRole } from "@/lib/roles";
import {
  updateSessionEventOverrides,
  type RegistrationItem,
  type SessionEvent,
  type SessionEventOverridesInput,
  type SessionSeries,
} from "@/lib/session-series";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
  dataPartition?: DataPartition;
};

type EventWithRegistrations = {
  event: SessionEvent;
  registrations: RegistrationItem[];
};

type EventOverrideDraft = {
  location: string;
  startAt: string;
  endAt: string;
  defaultPriceCasual: string;
  capacity: string;
  waitingListCapacity: string;
};

function getSessionViewErrorMessage(error: unknown) {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "permission-denied"
  ) {
    return "You need organiser approval before viewing this session history.";
  }

  return error instanceof Error ? error.message : "Failed to load session history.";
}

function getTimestampMillis(value: unknown) {
  if (
    typeof value === "object"
    && value !== null
    && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function getTodayString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildEventOverrideDraft(event: SessionEvent): EventOverrideDraft {
  return {
    location: event.location || "",
    startAt: event.startAt || "",
    endAt: event.endAt || "",
    defaultPriceCasual: String(event.defaultPriceCasual ?? 0),
    capacity: String(event.capacity ?? 0),
    waitingListCapacity: String(event.waitingListCapacity ?? 0),
  };
}

function getEmptyEventOverrideDraft(): EventOverrideDraft {
  return {
    location: "",
    startAt: "",
    endAt: "",
    defaultPriceCasual: "",
    capacity: "",
    waitingListCapacity: "0",
  };
}

function formatPrice(value: number) {
  const normalized = Math.round(value * 100) / 100;
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
}

function SessionViewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const seriesId = searchParams.get("id");

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [series, setSeries] = useState<SessionSeries | null>(null);
  const [eventList, setEventList] = useState<EventWithRegistrations[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDraftsById, setEventDraftsById] = useState<Record<string, EventOverrideDraft>>({});

  const today = getTodayString();

  async function loadData(currentUser: User) {
    if (!seriesId) return;

    const seriesSnap = await getDoc(doc(db, "sessions", seriesId));
    if (!seriesSnap.exists()) {
      setLoadError("Session series not found.");
      return;
    }
    const seriesData = { id: seriesSnap.id, ...(seriesSnap.data() as Omit<SessionSeries, "id">) };
    setSeries(seriesData);

    const profileSnap = await getDoc(doc(db, "users", currentUser.uid));
    const profileData = profileSnap.data() as UserProfile | undefined;
    const dataPartition = resolveDataPartition(
      profileData?.email || currentUser.email || "",
      profileData?.dataPartition || "live",
    );

    if (profileData?.role === "organiser" && seriesData.organiserId !== currentUser.uid) {
      router.push("/dashboard");
      return;
    }

    const eventsSnap = await getDocs(
      query(
        collection(db, "sessionEvents"),
        where("sessionSeriesId", "==", seriesId),
        where("organiserId", "==", seriesData.organiserId),
        where("dataPartition", "==", dataPartition),
      ),
    );

    const rawEvents = eventsSnap.docs
      .map((eventDoc) => ({ id: eventDoc.id, ...(eventDoc.data() as Omit<SessionEvent, "id">) }))
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate));

    const withRegistrations: EventWithRegistrations[] = await Promise.all(
      rawEvents.map(async (event) => {
        const regsSnap = await getDocs(
          query(
            collection(db, "registrations"),
            where("sessionEventId", "==", event.id),
            where("dataPartition", "==", dataPartition),
          ),
        );
        const registrations = regsSnap.docs
          .map((regDoc) => ({ id: regDoc.id, ...(regDoc.data() as Omit<RegistrationItem, "id">) }))
          .sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));
        return { event, registrations };
      }),
    );

    setEventList(withRegistrations);
  }

  useEffect(() => {
    if (!seriesId) {
      router.push("/dashboard");
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        setLoadError("");
        if (!currentUser) {
          router.push("/");
          return;
        }
        setUser(currentUser);

        const profileSnap = await getDoc(doc(db, "users", currentUser.uid));
        const profileData = profileSnap.data() as UserProfile | undefined;
        setProfile(profileData ?? { role: "player" });

        await loadData(currentUser);
      } catch (err) {
        console.error("[session-view] load failed:", err);
        setLoadError(getSessionViewErrorMessage(err));
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, router]);

  async function handleToggleLock(eventItem: SessionEvent, registrations: RegistrationItem[]) {
    const isLocking = !eventItem.locked;
    const lockBusyKey = `lock-${eventItem.id}`;

    if (isLocking) {
      const unconfirmed = registrations.filter((registration) => registration.status !== "waiting" && !registration.organiserPaid);
      const warningText = unconfirmed.length > 0
        ? `${unconfirmed.length} player(s) have unconfirmed payments. Lock anyway? No one (including you) will be able to change registrations or payments until unlocked.`
        : "Lock this event? No one (including you) will be able to change registrations or payments until unlocked.";
      if (!confirm(warningText)) return;
    }

    setBusyKey(lockBusyKey);
    try {
      await updateDoc(doc(db, "sessionEvents", eventItem.id), { locked: isLocking });
      setEventList((current) =>
        current.map((item) =>
          item.event.id === eventItem.id
            ? { ...item, event: { ...item.event, locked: isLocking } }
            : item,
        ),
      );
    } catch (err) {
      console.error("[session-view] toggle lock failed:", err);
      alert(err instanceof Error ? err.message : "Failed to toggle lock.");
    } finally {
      setBusyKey(null);
    }
  }

  function handleStartEditingEvent(eventItem: SessionEvent) {
    setEditingEventId(eventItem.id);
    setEventDraftsById((current) => ({
      ...current,
      [eventItem.id]: current[eventItem.id] ?? buildEventOverrideDraft(eventItem),
    }));
  }

  function handleCancelEditingEvent(eventItem: SessionEvent) {
    setEditingEventId(null);
    setEventDraftsById((current) => ({
      ...current,
      [eventItem.id]: buildEventOverrideDraft(eventItem),
    }));
  }

  function handleEventDraftChange(
    eventId: string,
    field: keyof EventOverrideDraft,
    value: string,
  ) {
    const existingEvent = eventList.find((item) => item.event.id === eventId)?.event;
    const fallbackDraft = existingEvent ? buildEventOverrideDraft(existingEvent) : getEmptyEventOverrideDraft();

    setEventDraftsById((current) => ({
      ...current,
      [eventId]: {
        ...(current[eventId] ?? fallbackDraft),
        [field]: value,
      },
    }));
  }

  async function handleSaveEventOverrides(eventItem: SessionEvent, registrations: RegistrationItem[]) {
    if (!series) {
      return;
    }

    const draft = eventDraftsById[eventItem.id] ?? buildEventOverrideDraft(eventItem);
    const saveBusyKey = `save-${eventItem.id}`;
    const nextValues: SessionEventOverridesInput = {
      location: draft.location,
      startAt: draft.startAt,
      endAt: draft.endAt,
      defaultPriceCasual: Number(draft.defaultPriceCasual),
      capacity: Number(draft.capacity),
      waitingListCapacity: Number(draft.waitingListCapacity),
    };

    setBusyKey(saveBusyKey);
    try {
      const updatedEvent = await updateSessionEventOverrides(db, {
        series,
        event: eventItem,
        registrations,
        values: nextValues,
      });
      setEventList((current) =>
        current.map((item) =>
          item.event.id === eventItem.id
            ? { ...item, event: updatedEvent }
            : item,
        ),
      );
      setEventDraftsById((current) => ({
        ...current,
        [eventItem.id]: buildEventOverrideDraft(updatedEvent),
      }));
      setEditingEventId(null);
    } catch (err) {
      console.error("[session-view] save event overrides failed:", err);
      alert(err instanceof Error ? err.message : "Failed to save event overrides.");
    } finally {
      setBusyKey(null);
    }
  }

  const canManage = profile?.role === "admin" || profile?.role === "organiser";

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading event history...
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.15em] text-red-600">Error</div>
          <div className="mt-3 text-lg font-medium text-red-800">{loadError}</div>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-700 underline">Back to dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <AppShell role={profile?.role ?? "player"} contentClassName="max-w-4xl">
      <div className="flex w-full flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Event history</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{series?.title ?? "Session"}</h1>
              {series ? (
                <p className="mt-2 text-sm text-zinc-500">
                  Series defaults: {series.location} · {series.dayOfWeek} · {series.startAt}–{series.endAt}
                  {series.organiserName ? ` · Organiser: ${series.organiserName}` : ""}
                </p>
              ) : null}
            </div>
            <Link href="/dashboard" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Back</Link>
          </div>
        </div>

        {eventList.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm ring-1 ring-zinc-200">
            No events recorded for this series yet.
          </div>
        ) : (
          eventList.map(({ event, registrations }) => {
            const isPast = event.eventDate < today;
            const unconfirmedRegistered = registrations.filter((registration) => registration.status !== "waiting" && !registration.organiserPaid);
            const hasUnconfirmedWarning = canManage && isPast && unconfirmedRegistered.length > 0 && !event.locked;
            const isOrganiserOwned = profile?.role === "admin" || (profile?.role === "organiser" && event.organiserId === user?.uid);
            const isEditing = editingEventId === event.id;
            const draft = eventDraftsById[event.id] ?? buildEventOverrideDraft(event);
            const canEditOverrides = isOrganiserOwned
              && !event.locked
              && !isPast
              && event.status !== "completed"
              && event.status !== "cancelled";
            const registeredCount = registrations.filter((registration) => registration.status !== "waiting").length;
            const waitingCount = registrations.filter((registration) => registration.status === "waiting").length;
            const lockBusyKey = `lock-${event.id}`;
            const saveBusyKey = `save-${event.id}`;

            return (
              <article key={event.id} className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ${event.locked ? "ring-zinc-300" : "ring-zinc-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{event.eventDate}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${event.status === "active" ? "bg-emerald-100 text-emerald-700" : event.status === "completed" ? "bg-zinc-100 text-zinc-600" : "bg-red-100 text-red-700"}`}>
                        {event.status || "active"}
                      </span>
                      {event.locked ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Locked</span>
                      ) : null}
                      {hasUnconfirmedWarning ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          {unconfirmedRegistered.length} unconfirmed payment{unconfirmedRegistered.length !== 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {registeredCount}/{event.capacity} registered
                      {(event.waitingListCapacity ?? 0) > 0 ? ` · ${waitingCount}/${event.waitingListCapacity} waiting` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEditOverrides ? (
                      isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSaveEventOverrides(event, registrations)}
                            disabled={busyKey === saveBusyKey}
                            className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busyKey === saveBusyKey ? "Saving..." : "Save event details"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelEditingEvent(event)}
                            disabled={busyKey === saveBusyKey}
                            className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartEditingEvent(event)}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100"
                        >
                          Edit event details
                        </button>
                      )
                    ) : null}
                    {isOrganiserOwned ? (
                      <button
                        type="button"
                        onClick={() => handleToggleLock(event, registrations)}
                        disabled={busyKey === lockBusyKey || busyKey === saveBusyKey}
                        className={`rounded-full border px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${event.locked ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-zinc-300 hover:bg-zinc-100"}`}
                      >
                        {busyKey === lockBusyKey ? "..." : event.locked ? "Unlock event" : "Lock event"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isEditing ? (
                  <div className="mt-4 grid gap-3 rounded-2xl border border-zinc-200 p-4 md:grid-cols-2">
                    <label className="block text-xs text-zinc-600">
                      <span className="mb-1 block font-medium text-zinc-700">Event location</span>
                      <input
                        type="text"
                        value={draft.location}
                        onChange={(inputEvent) => handleEventDraftChange(event.id, "location", inputEvent.target.value)}
                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                      />
                    </label>
                    <label className="block text-xs text-zinc-600">
                      <span className="mb-1 block font-medium text-zinc-700">Casual price</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.defaultPriceCasual}
                        onChange={(inputEvent) => handleEventDraftChange(event.id, "defaultPriceCasual", inputEvent.target.value)}
                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                      />
                    </label>
                    <label className="block text-xs text-zinc-600">
                      <span className="mb-1 block font-medium text-zinc-700">Start time</span>
                      <input
                        type="time"
                        value={draft.startAt}
                        onChange={(inputEvent) => handleEventDraftChange(event.id, "startAt", inputEvent.target.value)}
                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                      />
                    </label>
                    <label className="block text-xs text-zinc-600">
                      <span className="mb-1 block font-medium text-zinc-700">End time</span>
                      <input
                        type="time"
                        value={draft.endAt}
                        onChange={(inputEvent) => handleEventDraftChange(event.id, "endAt", inputEvent.target.value)}
                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                      />
                    </label>
                    <label className="block text-xs text-zinc-600">
                      <span className="mb-1 block font-medium text-zinc-700">Player capacity</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draft.capacity}
                        onChange={(inputEvent) => handleEventDraftChange(event.id, "capacity", inputEvent.target.value)}
                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                      />
                    </label>
                    <label className="block text-xs text-zinc-600">
                      <span className="mb-1 block font-medium text-zinc-700">Waiting list spots</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draft.waitingListCapacity}
                        onChange={(inputEvent) => handleEventDraftChange(event.id, "waitingListCapacity", inputEvent.target.value)}
                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                      />
                    </label>
                    <p className="text-[11px] text-zinc-500 md:col-span-2">
                      These values are stored on this event only. Existing registrations stay intact, and smaller totals are blocked if they would remove spots already in use.
                    </p>
                  </div>
                ) : (
                  <dl className="mt-4 grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
                    <div><dt className="text-zinc-500">Location</dt><dd>{event.location}</dd></div>
                    <div><dt className="text-zinc-500">Time</dt><dd>{event.startAt} - {event.endAt}</dd></div>
                    <div><dt className="text-zinc-500">Casual price</dt><dd>${formatPrice(event.defaultPriceCasual)}</dd></div>
                    <div><dt className="text-zinc-500">Capacity</dt><dd>{event.capacity} players</dd></div>
                    <div><dt className="text-zinc-500">Waiting list</dt><dd>{event.waitingListCapacity ?? 0} spots</dd></div>
                    <div><dt className="text-zinc-500">Stored event values</dt><dd>Kept for history and audit</dd></div>
                  </dl>
                )}

                {!canEditOverrides && isOrganiserOwned && !event.locked ? (
                  <p className="mt-4 text-xs text-zinc-500">
                    Past, completed, and cancelled events stay read-only here so their stored event values remain visible for history.
                  </p>
                ) : null}
                {event.locked ? (
                  <p className="mt-4 text-xs text-zinc-500">
                    Unlock this event first if you need to change its stored event details.
                  </p>
                ) : null}

                {registrations.length === 0 ? (
                  <p className="mt-4 text-sm text-zinc-500">No registrations for this event.</p>
                ) : (
                  <div className="mt-2 space-y-1">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">Participants</h4>
                    {registrations.map((registration) => {
                      const isOwnRegistration = registration.userId === user?.uid;
                      return (
                        <EventRegistrationRow
                          key={registration.id}
                          registration={registration}
                          isOwnRegistration={isOwnRegistration}
                        />
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </AppShell>
  );
}

export default function SessionViewPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900"><div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading event history...</div></main>}>
      <SessionViewPageInner />
    </Suspense>
  );
}
