"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import SearchablePlayerSelect from "@/components/searchable-player-select";
import { auth, db } from "@/lib/firebase";
import { upsertPaymentRecord } from "@/lib/payments";
import {
  createManualPlayer,
  ensureSelfRegisteredPlayers,
  getVisiblePlayersForOrganiser,
  type PlayerDirectoryEntry,
} from "@/lib/players";
import type { AppRole } from "@/lib/roles";
import { getEffectiveNextGameOn } from "@/lib/session-options";
import {
  buildRegistrationId,
  createSessionEventForSeries,
  type RegistrationItem,
  type SessionEvent,
  type SessionSeries,
} from "@/lib/session-series";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [seriesList, setSeriesList] = useState<SessionSeries[]>([]);
  const [eventsBySeries, setEventsBySeries] = useState<Record<string, SessionEvent[]>>({});
  const [registrationsByEvent, setRegistrationsByEvent] = useState<Record<string, RegistrationItem[]>>({});
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [selectedPlayerValues, setSelectedPlayerValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
        return;
      }

      setUser(currentUser);

      const profileSnapshot = await getDoc(doc(db, "users", currentUser.uid));
      if (!profileSnapshot.exists()) {
        router.push("/login");
        return;
      }

      const profileData = profileSnapshot.data() as UserProfile;
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

          const eventItems = eventSnapshots.docs
            .map((eventDoc) => ({
              id: eventDoc.id,
              ...(eventDoc.data() as Omit<SessionEvent, "id">),
            }))
            .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

          eventMap[series.id] = eventItems;

          await Promise.all(
            eventItems.map(async (event) => {
              const registrationsSnapshot = await getDocs(
                query(
                  collection(db, "registrations"),
                  where("sessionEventId", "==", event.id),
                ),
              );
              registrationMap[event.id] = registrationsSnapshot.docs
                .map((registrationDoc) => ({
                  id: registrationDoc.id,
                  ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
                }))
                .sort((a, b) => (a.playerName || "").localeCompare(b.playerName || ""));
            }),
          );
        }),
      );

      if (profileData.role === "organiser") {
        await ensureSelfRegisteredPlayers(db);
        setPlayerDirectory(await getVisiblePlayersForOrganiser(db, currentUser.uid));
      }

      setSeriesList(seriesItems);
      setEventsBySeries(eventMap);
      setRegistrationsByEvent(registrationMap);
      setLoading(false);
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

    const eventItems = eventSnapshots.docs
      .map((eventDoc) => ({
        id: eventDoc.id,
        ...(eventDoc.data() as Omit<SessionEvent, "id">),
      }))
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

    const registrationMap: Record<string, RegistrationItem[]> = {};
    await Promise.all(
      eventItems.map(async (event) => {
        const registrationsSnapshot = await getDocs(
          query(collection(db, "registrations"), where("sessionEventId", "==", event.id)),
        );
        registrationMap[event.id] = registrationsSnapshot.docs
          .map((registrationDoc) => ({
            id: registrationDoc.id,
            ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
          }))
          .sort((a, b) => (a.playerName || "").localeCompare(b.playerName || ""));
      }),
    );

    setEventsBySeries((current) => ({ ...current, [seriesId]: eventItems }));
    setRegistrationsByEvent((current) => ({ ...current, ...registrationMap }));
  }

  async function syncPaymentForRegistration(
    series: SessionSeries,
    eventItem: SessionEvent,
    registrationId: string,
    registration: {
      userId: string;
      playerName: string;
      playerEmail: string;
      playerPaid: boolean;
      organiserPaid: boolean;
    },
  ) {
    const effectivePaid = registration.organiserPaid || registration.playerPaid;
    await upsertPaymentRecord(db, {
      sessionSeriesId: series.id,
      sessionEventId: eventItem.id,
      registrationId,
      organiserId: series.organiserId,
      userId: registration.userId,
      playerName: registration.playerName,
      playerEmail: registration.playerEmail,
      amount: eventItem.defaultPriceCasual,
      playerPaid: registration.playerPaid,
      organiserPaid: registration.organiserPaid,
      effectivePaid,
      status: effectivePaid ? "paid" : "pending",
    });
  }

  async function handleCreateNextEvent(series: SessionSeries) {
    setBusyKey(series.id);
    try {
      await createSessionEventForSeries(db, series, series.nextGameOn);
      await refreshSeriesData(series.id);
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

      await updateDoc(doc(db, "sessionEvents", eventItem.id), {
        bookedCount: (eventItem.bookedCount || 0) + 1,
      });

      await updateDoc(doc(db, "sessions", series.id), {
        nextGameOn: getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn),
      });

      const registrationRef = await addDoc(collection(db, "registrations"), {
        sessionEventId: eventItem.id,
        sessionSeriesId: series.id,
        userId: user.uid,
        playerName: profile?.displayName || user.email || "Player",
        playerEmail: user.email || "",
        playerPaid: false,
        organiserPaid: false,
        createdAt: serverTimestamp(),
      });

      await syncPaymentForRegistration(series, eventItem, registrationRef.id, {
        userId: user.uid,
        playerName: profile?.displayName || user.email || "Player",
        playerEmail: user.email || "",
        playerPaid: false,
        organiserPaid: false,
      });

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
      await updateDoc(doc(db, "registrations", registration.id), {
        playerPaid: nextValue,
      });
      await syncPaymentForRegistration(series, eventItem, registration.id, {
        userId: registration.userId,
        playerName: registration.playerName,
        playerEmail: registration.playerEmail,
        playerPaid: nextValue,
        organiserPaid: registration.organiserPaid,
      });
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
      const playerPaid = nextValue ? true : registration.playerPaid;
      await updateDoc(doc(db, "registrations", registration.id), {
        organiserPaid: nextValue,
        playerPaid,
      });
      await syncPaymentForRegistration(series, eventItem, registration.id, {
        userId: registration.userId,
        playerName: registration.playerName,
        playerEmail: registration.playerEmail,
        playerPaid,
        organiserPaid: nextValue,
      });
      await refreshSeriesData(series.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleOrganiserCreateManualPlayer(name: string) {
    if (!user) return;
    await createManualPlayer(db, user.uid, name);
    const refreshed = await getVisiblePlayersForOrganiser(db, user.uid);
    setPlayerDirectory(refreshed);
    const newPlayer = refreshed.find((player) => player.displayName === name && player.ownerOrganiserId === user.uid);
    if (newPlayer) {
      return newPlayer.id;
    }
    return null;
  }

  async function handleOrganiserAddPlayer(series: SessionSeries, eventItem: SessionEvent) {
    if (!user) return;

    const selectedValue = selectedPlayerValues[eventItem.id] ?? "";
    let selectedPlayer = playerDirectory.find((player) => player.id === selectedValue) ?? null;

    if (!selectedPlayer && selectedValue.startsWith("create:")) {
      const createdId = await handleOrganiserCreateManualPlayer(selectedValue.slice(7).trim());
      if (createdId) {
        selectedPlayer = (await getVisiblePlayersForOrganiser(db, user.uid)).find((player) => player.id === createdId) ?? null;
      }
    }

    if (!selectedPlayer) return;

    setBusyKey(eventItem.id);
    try {
      const registrationRef = await addDoc(collection(db, "registrations"), {
        sessionEventId: eventItem.id,
        sessionSeriesId: series.id,
        userId: selectedPlayer.userId || selectedPlayer.id,
        playerName: selectedPlayer.displayName,
        playerEmail: selectedPlayer.email,
        playerPaid: false,
        organiserPaid: false,
        createdAt: serverTimestamp(),
      });

      await syncPaymentForRegistration(series, eventItem, registrationRef.id, {
        userId: selectedPlayer.userId || selectedPlayer.id,
        playerName: selectedPlayer.displayName,
        playerEmail: selectedPlayer.email,
        playerPaid: false,
        organiserPaid: false,
      });

      await updateDoc(doc(db, "sessionEvents", eventItem.id), {
        bookedCount: (eventItem.bookedCount || 0) + 1,
      });

      await refreshSeriesData(series.id);
      setSelectedPlayerValues((current) => ({ ...current, [eventItem.id]: "" }));
      setPlayerDirectory(await getVisiblePlayersForOrganiser(db, user.uid));
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
              {canManageSessions ? <Link href="/sessions/new" className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700">Create session series</Link> : null}
              <button type="button" onClick={async () => { await signOut(auth); router.push("/login"); }} className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Sign out</button>
            </div>
          </div>
        </div>

        <section className="grid gap-4">
          {seriesList.length ? (
            seriesList.map((series) => {
              const events = eventsBySeries[series.id] ?? [];
              const nextEvent = events.find((event) => event.eventDate === series.nextGameOn) ?? events.at(-1);
              const registrations = nextEvent ? registrationsByEvent[nextEvent.id] ?? [] : [];
              const currentRegistration = nextEvent ? registrations.find((registration) => registration.userId === user?.uid) : undefined;
              const showStartsFrom = profile?.role !== "player";

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
                    </div>
                    {canManageSessions ? <Link href={`/sessions/edit?id=${series.id}`} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100">Edit series</Link> : null}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-zinc-700">
                    <div><dt className="text-zinc-500">Day</dt><dd>{series.dayOfWeek}</dd></div>
                    <div><dt className="text-zinc-500">Next game on</dt><dd>{getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn)}</dd></div>
                    <div><dt className="text-zinc-500">Time</dt><dd>{series.startAt} - {series.endAt}</dd></div>
                    {showStartsFrom ? <div><dt className="text-zinc-500">Starts from</dt><dd>{series.firstSessionOn}</dd></div> : null}
                    <div><dt className="text-zinc-500">Casual price</dt><dd>${series.defaultPriceCasual}</dd></div>
                    <div><dt className="text-zinc-500">Series capacity</dt><dd>{series.capacity}</dd></div>
                  </dl>

                  <div className="mt-4 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Next event</h3>
                        <p className="mt-1 text-sm text-zinc-700">{nextEvent ? `${nextEvent.eventDate} • ${nextEvent.bookedCount}/${nextEvent.capacity} registered` : "No event created yet"}</p>
                      </div>
                      {canManageSessions ? <button type="button" onClick={() => handleCreateNextEvent(series)} disabled={busyKey === series.id} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Create next event</button> : null}
                    </div>

                    {nextEvent ? (
                      <>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Registrations for {nextEvent.eventDate}</h4>
                          {!canManageSessions ? (
                            currentRegistration ? <span className="text-sm font-medium text-green-700">Registered</span> : <button type="button" onClick={() => handleRegister(series, nextEvent)} disabled={busyKey === nextEvent.id || nextEvent.bookedCount >= nextEvent.capacity} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">Register</button>
                          ) : null}
                        </div>

                        {canManageSessions ? (
                          <div className="mt-4 space-y-2">
                            <SearchablePlayerSelect
                              players={playerDirectory}
                              value={selectedPlayerValues[nextEvent.id] ?? ""}
                              onValueChange={(value) =>
                                setSelectedPlayerValues((current) => ({
                                  ...current,
                                  [nextEvent.id]: value,
                                }))
                              }
                              onCreate={async (name) => {
                                const createdId = await handleOrganiserCreateManualPlayer(name);
                                if (createdId) {
                                  setSelectedPlayerValues((current) => ({
                                    ...current,
                                    [nextEvent.id]: createdId,
                                  }));
                                }
                              }}
                              disabled={busyKey === nextEvent.id}
                            />
                            <button type="button" onClick={() => handleOrganiserAddPlayer(series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Add selected player</button>
                          </div>
                        ) : null}

                        <div className="mt-4 space-y-2">
                          {registrations.length ? (
                            registrations.map((registration) => {
                              const effectivePaid = registration.organiserPaid || registration.playerPaid;
                              const isOwnRegistration = registration.userId === user?.uid;
                              return (
                                <div key={registration.id} className="rounded-xl bg-white p-3 ring-1 ring-zinc-200">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <div className="font-medium text-zinc-900">{registration.playerName}</div>
                                      <div className="text-xs text-zinc-500">{registration.playerEmail || "Manually added player"}</div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      <span className={`rounded-full px-3 py-1 font-medium ${registration.playerPaid ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>player: {registration.playerPaid ? "paid" : "not paid"}</span>
                                      <span className={`rounded-full px-3 py-1 font-medium ${registration.organiserPaid ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>organiser: {registration.organiserPaid ? "confirmed" : "unconfirmed"}</span>
                                      <span className={`rounded-full px-3 py-1 font-medium ${effectivePaid ? "bg-violet-100 text-violet-700" : "bg-zinc-100 text-zinc-600"}`}>effective: {effectivePaid ? "paid" : "pending"}</span>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {(isOwnRegistration || canManageSessions) ? <button type="button" onClick={() => handlePlayerPaidToggle(registration, !registration.playerPaid, series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Toggle player paid</button> : null}
                                    {canManageSessions ? <button type="button" onClick={() => handleOrganiserPaidToggle(registration, !registration.organiserPaid, series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Toggle organiser confirm</button> : null}
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
