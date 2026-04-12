"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { AppRole } from "@/lib/roles";
import type { RegistrationItem, SessionEvent, SessionSeries } from "@/lib/session-series";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
};

type EventWithRegistrations = {
  event: SessionEvent;
  registrations: RegistrationItem[];
};

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

    if (profileData?.role === "organiser" && seriesData.organiserId !== currentUser.uid) {
      router.push("/dashboard");
      return;
    }

    const eventsSnap = await getDocs(
      query(collection(db, "sessionEvents"), where("sessionSeriesId", "==", seriesId)),
    );

    const rawEvents = eventsSnap.docs
      .map((eventDoc) => ({ id: eventDoc.id, ...(eventDoc.data() as Omit<SessionEvent, "id">) }))
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate)); // newest first

    const withRegistrations: EventWithRegistrations[] = await Promise.all(
      rawEvents.map(async (event) => {
        const regsSnap = await getDocs(
          query(collection(db, "registrations"), where("sessionEventId", "==", event.id)),
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
        setLoadError(err instanceof Error ? err.message : "Failed to load session history.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, router]);

  async function handleToggleLock(eventItem: SessionEvent, registrations: RegistrationItem[]) {
    const isLocking = !eventItem.locked;

    if (isLocking) {
      const unconfirmed = registrations.filter((r) => r.status !== "waiting" && !r.organiserPaid);
      const warningText = unconfirmed.length > 0
        ? `${unconfirmed.length} player(s) have unconfirmed payments. Lock anyway? No one (including you) will be able to change registrations or payments until unlocked.`
        : "Lock this event? No one (including you) will be able to change registrations or payments until unlocked.";
      if (!confirm(warningText)) return;
    }

    setBusyKey(eventItem.id);
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
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Event history</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{series?.title ?? "Session"}</h1>
              {series ? (
                <p className="mt-2 text-sm text-zinc-500">
                  {series.location} · {series.dayOfWeek} · {series.startAt}–{series.endAt}
                  {series.organiserName ? ` · Organiser: ${series.organiserName}` : ""}
                </p>
              ) : null}
            </div>
            <Link href="/dashboard" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Back</Link>
          </div>
        </div>

        {eventList.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 text-sm text-zinc-500">
            No events recorded for this series yet.
          </div>
        ) : (
          eventList.map(({ event, registrations }) => {
            const isPast = event.eventDate < today;
            const unconfirmedRegistered = registrations.filter((r) => r.status !== "waiting" && !r.organiserPaid);
            const hasUnconfirmedWarning = canManage && isPast && unconfirmedRegistered.length > 0 && !event.locked;
            const isOrganiserOwned = profile?.role === "admin" || (profile?.role === "organiser" && event.organiserId === user?.uid);

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
                      {registrations.filter((r) => r.status !== "waiting").length}/{event.capacity} registered
                      {(event.waitingListCapacity ?? 0) > 0 ? ` · ${registrations.filter((r) => r.status === "waiting").length}/${event.waitingListCapacity} waiting` : ""}
                    </p>
                  </div>
                  {isOrganiserOwned ? (
                    <button
                      type="button"
                      onClick={() => handleToggleLock(event, registrations)}
                      disabled={busyKey === event.id}
                      className={`rounded-full border px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${event.locked ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-zinc-300 hover:bg-zinc-100"}`}
                    >
                      {busyKey === event.id ? "..." : event.locked ? "Unlock event" : "Lock event"}
                    </button>
                  ) : null}
                </div>

                {registrations.length === 0 ? (
                  <p className="mt-4 text-sm text-zinc-500">No registrations for this event.</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">Participants</h4>
                    {registrations.map((registration) => {
                      const isOwnRegistration = registration.userId === user?.uid;
                      const isWaiting = registration.status === "waiting";
                      return (
                        <div key={registration.id} className={`rounded-xl p-3 ring-1 ${isOwnRegistration ? "bg-blue-50/30 ring-blue-300" : "bg-white ring-zinc-200"}`}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-medium text-zinc-900">
                                {registration.playerName}{isOwnRegistration ? " (you)" : ""}
                              </div>
                              <div className="text-xs text-zinc-500">{registration.playerEmail || "Manually added player"}</div>
                              {isWaiting ? <div className="mt-0.5 text-xs text-zinc-500">Waiting list</div> : null}
                              {canManage && registration.paymentReference ? (
                                <div className="mt-0.5 text-xs text-zinc-500">Payment ref: <span className="font-medium text-zinc-700">{registration.paymentReference}</span></div>
                              ) : null}
                            </div>
                            {!isWaiting ? (
                              <div className="flex flex-wrap gap-2 text-xs">
                                <span className={`rounded-full px-3 py-1 font-medium ${registration.playerPaid ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                                  {registration.playerPaid ? "Paid" : "Not paid"}
                                </span>
                                <span className={`rounded-full px-3 py-1 font-medium ${registration.organiserPaid ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
                                  {registration.organiserPaid ? "Confirmed" : "Not confirmed"}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </main>
  );
}

export default function SessionViewPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900"><div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading event history...</div></main>}>
      <SessionViewPageInner />
    </Suspense>
  );
}
