"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import SearchablePlayerSelect from "@/components/searchable-player-select";
import { auth, db } from "@/lib/firebase";
import { deletePaymentRecord, syncPaymentRecordForRegistration } from "@/lib/payments";
import { getManagedUserByEmail, upsertManagedUser } from "@/lib/managed-users";
import { resolveAuthProfile } from "@/lib/auth-profile";
import {
  createManualPlayer,
  ensureSelfRegisteredPlayers,
  getVisiblePlayersForOrganiser,
  updateManualPlayerSkillLevel,
  type PlayerDirectoryEntry,
} from "@/lib/players";
import type { AppRole } from "@/lib/roles";
import { getEffectiveNextGameOn } from "@/lib/session-options";
import { getDashboardEventPresentation } from "@/lib/dashboard-event-state";
import { SKILL_LEVEL_OPTIONS, type SkillLevel } from "@/lib/skill-levels";
import {
  buildRegistrationId,
  createSessionEventForSeries,
  getRegistrationCapacityState,
  rebalanceEventRegistrations,
  type RegistrationItem,
  type SessionEvent,
  type SessionSeries,
} from "@/lib/session-series";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
};

function sortRegistrations(
  registrations: RegistrationItem[],
  currentUserId?: string,
) {
  const copy = [...registrations];
  copy.sort((a, b) => {
    const aIsSelf = currentUserId && a.userId === currentUserId ? 1 : 0;
    const bIsSelf = currentUserId && b.userId === currentUserId ? 1 : 0;
    if (aIsSelf !== bIsSelf) {
      return bIsSelf - aIsSelf;
    }

    const aCreated = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
    const bCreated = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
    return aCreated - bCreated;
  });
  return copy;
}

function withDerivedEventCounts(
  event: SessionEvent,
  registrations: RegistrationItem[],
): SessionEvent {
  const bookedCount = registrations.filter((registration) => registration.status !== "waiting").length;
  const waitingCount = registrations.filter((registration) => registration.status === "waiting").length;

  return {
    ...event,
    bookedCount,
    waitingCount,
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [seriesList, setSeriesList] = useState<SessionSeries[]>([]);
  const [eventsBySeries, setEventsBySeries] = useState<Record<string, SessionEvent[]>>({});
  const [registrationsByEvent, setRegistrationsByEvent] = useState<Record<string, RegistrationItem[]>>({});
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        setLoadError("");
        if (!currentUser) {
          router.push("/");
          return;
        }

        setUser(currentUser);

        const userRef = doc(db, "users", currentUser.uid);
        const profileSnapshot = await getDoc(userRef);

        let profileData: UserProfile;
        if (!profileSnapshot.exists()) {
          const managedUser = currentUser.email ? await getManagedUserByEmail(db, currentUser.email) : null;
          const resolved = resolveAuthProfile({
            authDisplayName: currentUser.displayName,
            authEmail: currentUser.email,
            existing: undefined,
            managedUser,
          });

          await setDoc(userRef, {
            displayName: resolved.displayName,
            email: resolved.email,
            role: resolved.role,
            status: resolved.status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          if (managedUser) {
            await upsertManagedUser(db, {
              email: resolved.email,
              displayName: resolved.displayName,
              role: managedUser.role,
              status: managedUser.status,
              userId: currentUser.uid,
            });
          }

          profileData = {
            displayName: resolved.displayName,
            email: resolved.email,
            role: resolved.role,
          };
        } else {
          profileData = profileSnapshot.data() as UserProfile;
        }

        setProfile(profileData);

        const seriesQuery =
          profileData.role === "organiser"
            ? query(
                collection(db, "sessions"),
                where("organiserId", "==", currentUser.uid),
                orderBy("dayOfWeek"),
              )
            : query(collection(db, "sessions"), orderBy("dayOfWeek"));

        const seriesSnapshots = await getDocs(seriesQuery);
        const seriesItems = seriesSnapshots.docs.map((sessionDoc) => ({
          id: sessionDoc.id,
          ...(sessionDoc.data() as Omit<SessionSeries, "id">),
        }));

        const eventMap: Record<string, SessionEvent[]> = {};
        const registrationMap: Record<string, RegistrationItem[]> = {};

        await Promise.all(
          seriesItems.map(async (series) => {
            const eventSnapshots = await getDocs(
              query(
                collection(db, "sessionEvents"),
                where("sessionSeriesId", "==", series.id),
              ),
            );

            const rawEventItems = eventSnapshots.docs
              .map((eventDoc) => ({
                id: eventDoc.id,
                ...(eventDoc.data() as Omit<SessionEvent, "id">),
              }))
              .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

            await Promise.all(
              rawEventItems.map(async (event) => {
                const registrationsSnapshot = await getDocs(
                  query(
                    collection(db, "registrations"),
                    where("sessionEventId", "==", event.id),
                  ),
                );
                registrationMap[event.id] = sortRegistrations(
                  registrationsSnapshot.docs.map((registrationDoc) => ({
                    id: registrationDoc.id,
                    ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
                  })),
                  currentUser.uid,
                );
              }),
            );

            eventMap[series.id] = rawEventItems.map((event) => withDerivedEventCounts(event, registrationMap[event.id] ?? []));
          }),
        );

        if (profileData.role === "admin") {
          await ensureSelfRegisteredPlayers(db);
        }

        if (profileData.role === "admin" || profileData.role === "organiser") {
          const organiserIds = profileData.role === "organiser"
            ? [currentUser.uid]
            : Array.from(new Set(seriesItems.map((series) => series.organiserId)));

          const visiblePlayers = new Map<string, PlayerDirectoryEntry>();
          for (const organiserId of organiserIds) {
            const entries = await getVisiblePlayersForOrganiser(db, organiserId);
            for (const entry of entries) {
              visiblePlayers.set(entry.id, entry);
            }
          }
          setPlayerDirectory(Array.from(visiblePlayers.values()).sort((a, b) => {
            const nameCompare = a.displayName.localeCompare(b.displayName);
            if (nameCompare !== 0) return nameCompare;
            return a.email.localeCompare(b.email);
          }));
        } else {
          setPlayerDirectory([]);
        }

        setSeriesList(seriesItems);
        setEventsBySeries(eventMap);
        setRegistrationsByEvent(registrationMap);
      } catch (error) {
        console.error("Dashboard load failed", error);
        setLoadError(error instanceof Error ? error.message : "Unknown dashboard error");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  const canManageSessions = useMemo(() => {
    return profile?.role === "admin" || profile?.role === "organiser";
  }, [profile?.role]);

  async function refreshSeriesData(seriesId: string) {
    const eventSnapshots = await getDocs(
      query(collection(db, "sessionEvents"), where("sessionSeriesId", "==", seriesId)),
    );

    const rawEventItems = eventSnapshots.docs
      .map((eventDoc) => ({
        id: eventDoc.id,
        ...(eventDoc.data() as Omit<SessionEvent, "id">),
      }))
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

    const registrationMap: Record<string, RegistrationItem[]> = {};
    await Promise.all(
      rawEventItems.map(async (event) => {
        const registrationsSnapshot = await getDocs(
          query(collection(db, "registrations"), where("sessionEventId", "==", event.id)),
        );
        registrationMap[event.id] = sortRegistrations(
          registrationsSnapshot.docs.map((registrationDoc) => ({
            id: registrationDoc.id,
            ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
          })),
          user?.uid,
        );
      }),
    );

    const eventItems = rawEventItems.map((event) => withDerivedEventCounts(event, registrationMap[event.id] ?? []));

    setEventsBySeries((current) => ({ ...current, [seriesId]: eventItems }));
    setRegistrationsByEvent((current) => ({ ...current, ...registrationMap }));
  }

  async function handleCreateNextEvent(series: SessionSeries) {
    setBusyKey(series.id);
    try {
      await createSessionEventForSeries(db, series, series.nextGameOn);
      await updateDoc(doc(db, "sessions", series.id), {
        nextGameOn: getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn),
      });
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSetEventStatus(series: SessionSeries, eventItem: SessionEvent, status: "completed" | "cancelled") {
    setBusyKey(eventItem.id);
    try {
      await updateDoc(doc(db, "sessionEvents", eventItem.id), { status });
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteSeries(series: SessionSeries) {
    const message = `WARNING: Inactivating this series will hide it from normal use and preserve its history, events, registrations, and payment records. Continue?`;
    if (!confirm(message)) {
      return;
    }

    setBusyKey(series.id);
    try {
      await updateDoc(doc(db, "sessions", series.id), {
        status: "inactive",
      });
      setSeriesList((current) =>
        current.map((item) => (item.id === series.id ? { ...item, status: "inactive" } : item)),
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRegister(series: SessionSeries, eventItem: SessionEvent) {
    if (!user) return;
    setBusyKey(eventItem.id);

    try {
      const registrationId = buildRegistrationId(eventItem.id, user.uid);
      const existing = await getDoc(doc(db, "registrations", registrationId));
      if (existing.exists()) {
        return;
      }

      const capacityState = getRegistrationCapacityState({
        capacity: eventItem.capacity,
        waitingListCapacity: eventItem.waitingListCapacity || series.waitingListCapacity || 0,
        bookedCount: eventItem.bookedCount,
        waitingCount: eventItem.waitingCount,
      });

      if (!capacityState.canAddMore || !capacityState.nextRegistrationStatus) {
        return;
      }

      const registration: RegistrationItem = {
        id: registrationId,
        sessionEventId: eventItem.id,
        sessionSeriesId: series.id,
        userId: user.uid,
        playerName: profile?.displayName || user.email || "Player",
        playerEmail: user.email || "",
        playerPaid: false,
        organiserPaid: false,
        status: capacityState.nextRegistrationStatus,
      };

      await setDoc(doc(db, "registrations", registrationId), {
        ...registration,
        createdAt: serverTimestamp(),
      });

      await syncPaymentRecordForRegistration(db, series, eventItem, registration);
      if (canManageSessions) {
        await rebalanceEventRegistrations(db, eventItem.id, eventItem.capacity);
        await updateDoc(doc(db, "sessions", series.id), {
          nextGameOn: getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn),
        });
      }
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemoveRegistration(
    registration: RegistrationItem,
    series: SessionSeries,
    eventItem: SessionEvent,
  ) {
    setBusyKey(registration.id);
    try {
      await deletePaymentRecord(db, registration.id);
      await deleteDoc(doc(db, "registrations", registration.id));
      if (canManageSessions) {
        await rebalanceEventRegistrations(db, eventItem.id, eventItem.capacity);
      }
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePlayerPaidToggle(
    registration: RegistrationItem,
    nextValue: boolean,
    series: SessionSeries,
    eventItem: SessionEvent,
  ) {
    setBusyKey(registration.sessionEventId);
    try {
      const updatedRegistration = {
        ...registration,
        playerPaid: nextValue,
      };
      await updateDoc(doc(db, "registrations", registration.id), {
        playerPaid: nextValue,
      });
      await syncPaymentRecordForRegistration(db, series, eventItem, updatedRegistration);
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleOrganiserPaidToggle(
    registration: RegistrationItem,
    nextValue: boolean,
    series: SessionSeries,
    eventItem: SessionEvent,
  ) {
    setBusyKey(registration.sessionEventId);
    try {
      const updatedRegistration = {
        ...registration,
        organiserPaid: nextValue,
      };
      await updateDoc(doc(db, "registrations", registration.id), {
        organiserPaid: nextValue,
      });
      await syncPaymentRecordForRegistration(db, series, eventItem, updatedRegistration);
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function addPlayerToEvent(series: SessionSeries, eventItem: SessionEvent, player: PlayerDirectoryEntry) {
    const playerKey = player.userId || player.id;
    const existing = (registrationsByEvent[eventItem.id] ?? []).find(
      (registration) => registration.userId === playerKey,
    );
    if (existing) return;

    const capacityState = getRegistrationCapacityState({
      capacity: eventItem.capacity,
      waitingListCapacity: eventItem.waitingListCapacity || series.waitingListCapacity || 0,
      bookedCount: eventItem.bookedCount,
      waitingCount: eventItem.waitingCount,
    });

    if (!capacityState.canAddMore || !capacityState.nextRegistrationStatus) {
      return;
    }

    const registration: RegistrationItem = {
      id: buildRegistrationId(eventItem.id, playerKey),
      sessionEventId: eventItem.id,
      sessionSeriesId: series.id,
      userId: playerKey,
      playerName: player.displayName,
      playerEmail: player.email,
      playerPaid: false,
      organiserPaid: false,
      status: capacityState.nextRegistrationStatus,
    };

    await setDoc(doc(db, "registrations", registration.id), {
      ...registration,
      createdAt: serverTimestamp(),
    });

    await syncPaymentRecordForRegistration(db, series, eventItem, registration);
    await rebalanceEventRegistrations(db, eventItem.id, eventItem.capacity);
  }

  async function handleSelectOrCreatePlayer(
    series: SessionSeries,
    eventItem: SessionEvent,
    selection: { type: "existing"; player: PlayerDirectoryEntry } | { type: "create"; name: string },
  ) {
    setBusyKey(eventItem.id);
    try {
      let player: PlayerDirectoryEntry | null = null;

      if (selection.type === "existing") {
        player = selection.player;
      } else {
        const ownerOrganiserId = series.organiserId;
        const createdId = await createManualPlayer(db, ownerOrganiserId, selection.name);
        const refreshed = await getVisiblePlayersForOrganiser(db, ownerOrganiserId);
        setPlayerDirectory((current) => {
          const merged = new Map<string, PlayerDirectoryEntry>();
          for (const item of current) merged.set(item.id, item);
          for (const item of refreshed) merged.set(item.id, item);
          return Array.from(merged.values()).sort((a, b) => {
            const nameCompare = a.displayName.localeCompare(b.displayName);
            if (nameCompare !== 0) return nameCompare;
            return a.email.localeCompare(b.email);
          });
        });
        player = refreshed.find((item) => item.id === createdId) ?? null;
      }

      if (!player) return;

      await addPlayerToEvent(series, eventItem, player);
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleManualPlayerSkillChange(playerId: string, skillLevel: SkillLevel | "") {
    setBusyKey(playerId);
    try {
      await updateManualPlayerSkillLevel(db, playerId, skillLevel || null);
      setPlayerDirectory((current) => current.map((player) => player.id === playerId ? { ...player, skillLevel: skillLevel || null } : player));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-5xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading dashboard...
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.15em] text-red-600">Dashboard error</div>
          <div className="mt-3 text-lg font-medium text-red-800">{loadError}</div>
          <div className="mt-4 text-sm text-red-700">Open the browser console for the exact failing call if needed.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Dashboard</p>
              <h1 className="text-3xl font-semibold tracking-tight">Welcome {profile?.displayName || user?.email}</h1>
              <p className="mt-3 text-zinc-600">Role: <strong>{profile?.role ?? "player"}</strong></p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/profile" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Profile</Link>
              {profile?.role === "admin" ? <Link href="/admin/organisers" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Organisers</Link> : null}
              {profile?.role === "admin" ? <Link href="/admin/players" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Players</Link> : null}
              {canManageSessions ? <Link href="/sessions/new" className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700">Create session series</Link> : null}
              <Link href="/logout" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Sign out</Link>
            </div>
          </div>
        </div>

        <section className="grid gap-4">
          {seriesList.filter((series) => series.status !== "inactive").length ? (
            seriesList.filter((series) => series.status !== "inactive").map((series) => {
              const events = eventsBySeries[series.id] ?? [];
              const nextEvent = events.find((event) => event.eventDate === series.nextGameOn) ?? events.at(-1);
              const registrations = nextEvent ? registrationsByEvent[nextEvent.id] ?? [] : [];
              const currentRegistration = nextEvent ? registrations.find((registration) => registration.userId === user?.uid) : undefined;
              const showStartsFrom = profile?.role !== "player";
              const visiblePlayersForSeries = playerDirectory.filter(
                (player) => player.ownerOrganiserId === null || player.ownerOrganiserId === series.organiserId,
              );
              const capacityState = getRegistrationCapacityState({
                capacity: nextEvent?.capacity || series.capacity,
                waitingListCapacity: nextEvent?.waitingListCapacity || series.waitingListCapacity || 0,
                bookedCount: nextEvent?.bookedCount || 0,
                waitingCount: nextEvent?.waitingCount || 0,
              });
              const waitingListCapacity = capacityState.waitingListCapacity;
              const bookedCount = capacityState.bookedCount;
              const waitingCount = capacityState.waitingCount;
              const eventIsFull = !!nextEvent && capacityState.eventIsFull;
              const waitingListIsFull = !!nextEvent && capacityState.waitingListIsFull;
              const playerIsGoing = currentRegistration?.status === "registered";
              const playerIsWaiting = currentRegistration?.status === "waiting";
              const playerCanJoin = !!nextEvent && capacityState.canAddMore;
              const nextEventIsOpen = !!nextEvent && (nextEvent.status || "active") === "active" && capacityState.canAddMore;

              const eventPresentation = getDashboardEventPresentation({
                role: profile?.role,
                playerIsGoing,
                playerIsWaiting,
                playerCanJoin,
                eventIsFull,
                waitingListIsFull,
              });

              const eventCardClass = eventPresentation.className;
              const eventStateText = eventPresentation.stateText;

              return (
                <article key={series.id} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">{series.typeOfSport}</span>
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">{series.status}</span>
                      </div>
                      <h2 className="text-xl font-semibold">{series.title}</h2>
                      <p className="mt-2 text-sm text-zinc-600">{series.location}</p>
                      <p className="mt-1 text-sm text-zinc-500">Organiser: {series.organiserName || "Organiser"}</p>
                    </div>
                    {canManageSessions ? (
                      <div className="flex gap-2">
                        <Link href={`/sessions/edit?id=${series.id}`} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100">Edit series</Link>
                        <button type="button" onClick={() => handleDeleteSeries(series)} disabled={busyKey === series.id} className="rounded-full border border-red-400 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60">Delete series</button>
                      </div>
                    ) : null}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-zinc-700">
                    <div><dt className="text-zinc-500">Day</dt><dd>{series.dayOfWeek}</dd></div>
                    <div><dt className="text-zinc-500">Next game on</dt><dd>{getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn)}</dd></div>
                    <div><dt className="text-zinc-500">Time</dt><dd>{series.startAt} - {series.endAt}</dd></div>
                    {showStartsFrom ? <div><dt className="text-zinc-500">Starts from</dt><dd>{series.firstSessionOn}</dd></div> : null}
                    <div><dt className="text-zinc-500">Casual price</dt><dd>${series.defaultPriceCasual}</dd></div>
                    <div><dt className="text-zinc-500">Series capacity</dt><dd>{series.capacity}</dd></div>
                    <div><dt className="text-zinc-500">Waiting list</dt><dd>{waitingListCapacity}</dd></div>
                  </dl>

                  <div className={`mt-4 rounded-2xl p-4 ring-1 ${eventCardClass}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Next event</h3>
                        <p className="mt-1 text-sm text-zinc-700">{nextEvent ? `${nextEvent.eventDate} • ${bookedCount}/${nextEvent.capacity} registered • ${waitingCount}/${waitingListCapacity} waiting` : "No event created yet"}</p>
                        {nextEvent ? <p className="mt-1 text-xs text-zinc-500">Status: {nextEvent.status || "active"}</p> : null}
                        {nextEvent ? <p className="mt-1 text-sm text-zinc-500">Organiser: {nextEvent.organiserName || series.organiserName || "Organiser"}</p> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700">{eventStateText}</span>
                        {canManageSessions && nextEvent && nextEvent.status !== "completed" && nextEvent.status !== "cancelled" ? (
                          <>
                            <button type="button" onClick={() => handleSetEventStatus(series, nextEvent, "completed")} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Mark completed</button>
                            <button type="button" onClick={() => handleSetEventStatus(series, nextEvent, "cancelled")} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Mark cancelled</button>
                          </>
                        ) : null}
                        {canManageSessions && !nextEventIsOpen ? <button type="button" onClick={() => handleCreateNextEvent(series)} disabled={busyKey === series.id} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Create next event</button> : null}
                      </div>
                    </div>

                    {nextEvent ? (
                      <>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Registrations for {nextEvent.eventDate}</h4>
                          {!canManageSessions ? (
                            currentRegistration ? (
                              <button type="button" onClick={() => handleRemoveRegistration(currentRegistration, series, nextEvent)} disabled={busyKey === currentRegistration.id} className="rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">Leave event</button>
                            ) : (
                              <button type="button" onClick={() => handleRegister(series, nextEvent)} disabled={busyKey === nextEvent.id || !playerCanJoin} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">{eventIsFull ? "Join waiting list" : "Register"}</button>
                            )
                          ) : null}
                        </div>

                        {canManageSessions ? (
                          <div className="mt-4 space-y-2">
                            <SearchablePlayerSelect
                              players={visiblePlayersForSeries}
                              disabled={busyKey === nextEvent.id || !playerCanJoin}
                              onSelectOrCreate={(selection) => handleSelectOrCreatePlayer(series, nextEvent, selection)}
                            />
                          </div>
                        ) : null}

                        <div className="mt-4 space-y-2">
                          {registrations.length ? (
                            registrations.map((registration) => {
                              const isOwnRegistration = registration.userId === user?.uid;
                              const playerRecord = visiblePlayersForSeries.find((player) => (player.userId || player.id) === registration.userId);
                              const isWaiting = registration.status === "waiting";
                              return (
                                <div key={registration.id} className={`rounded-xl bg-white p-3 ring-1 ${isOwnRegistration ? "ring-blue-300 bg-blue-50/30" : "ring-zinc-200"}`}>
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <div className="font-medium text-zinc-900">{registration.playerName}{isOwnRegistration ? " (you)" : ""}</div>
                                      <div className="text-xs text-zinc-500">{registration.playerEmail || "Manually added player"}</div>
                                      <div className="mt-1 text-xs text-zinc-500">Status: {isWaiting ? "Waiting list" : "Registered"}</div>
                                      {canManageSessions ? <div className="mt-1 text-xs text-zinc-500">Skill level: {playerRecord?.skillLevel || "Not set"}</div> : null}
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      <span className={`rounded-full px-3 py-1 font-medium ${registration.playerPaid ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{registration.playerPaid ? "Paid" : "Not paid"}</span>
                                      <span className={`rounded-full px-3 py-1 font-medium ${registration.organiserPaid ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>{registration.organiserPaid ? "Confirmed" : "Not confirmed"}</span>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {isOwnRegistration && !isWaiting ? <button type="button" onClick={() => handlePlayerPaidToggle(registration, !registration.playerPaid, series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">{registration.playerPaid ? "Not paid" : "Paid"}</button> : null}
                                    {canManageSessions && !isWaiting ? <button type="button" onClick={() => handleOrganiserPaidToggle(registration, !registration.organiserPaid, series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">{registration.organiserPaid ? "Not confirmed" : "Confirmed"}</button> : null}
                                    {(isOwnRegistration || canManageSessions) ? <button type="button" onClick={() => handleRemoveRegistration(registration, series, nextEvent)} disabled={busyKey === registration.id} className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">{isOwnRegistration && !canManageSessions ? "Leave event" : "Remove"}</button> : null}
                                    {canManageSessions && playerRecord?.ownerOrganiserId === series.organiserId ? (
                                      <select value={playerRecord?.skillLevel || ""} onChange={(e) => handleManualPlayerSkillChange(playerRecord.id, e.target.value as SkillLevel | "")} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium bg-white">
                                        <option value="">Skill level</option>
                                        {SKILL_LEVEL_OPTIONS.map((level) => <option key={level} value={level}>{level}</option>)}
                                      </select>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })
                          ) : <div className="text-sm text-zinc-500">No players registered yet.</div>}
                        </div>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">No session series yet. Use <strong>Create session series</strong> to add the first one.</div>
          )}
        </section>
      </div>
    </main>
  );
}
