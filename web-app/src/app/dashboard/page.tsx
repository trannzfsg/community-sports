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
import { auth, db } from "@/lib/firebase";
import type { AppRole } from "@/lib/roles";
import { getEffectiveNextGameOn } from "@/lib/session-options";

type SessionItem = {
  id: string;
  title: string;
  typeOfSport: "Badminton" | "Basketball";
  location: string;
  dayOfWeek: string;
  nextGameOn?: string;
  startAt: string;
  endAt: string;
  firstSessionOn: string;
  defaultPriceCasual: number;
  bookedCount: number;
  capacity: number;
  organiserId: string;
  status: string;
};

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
};

type RegistrationItem = {
  id: string;
  sessionId: string;
  userId: string;
  playerName: string;
  playerEmail: string;
  playerPaid: boolean;
  organiserPaid: boolean;
  createdAt?: unknown;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [registrationsBySession, setRegistrationsBySession] = useState<Record<string, RegistrationItem[]>>({});
  const [manualPlayerNames, setManualPlayerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

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

      const sessionsQuery =
        profileData.role === "organiser"
          ? query(
              collection(db, "sessions"),
              where("organiserId", "==", currentUser.uid),
              orderBy("dayOfWeek"),
            )
          : query(collection(db, "sessions"), orderBy("dayOfWeek"));

      const sessionSnapshots = await getDocs(sessionsQuery);
      const sessionItems = sessionSnapshots.docs.map((sessionDoc) => ({
        id: sessionDoc.id,
        ...(sessionDoc.data() as Omit<SessionItem, "id">),
      }));

      const registrationMap: Record<string, RegistrationItem[]> = {};
      await Promise.all(
        sessionItems.map(async (session) => {
          const registrationsQuery = query(
            collection(db, "registrations"),
            where("sessionId", "==", session.id),
            orderBy("createdAt"),
          );
          const registrationSnapshots = await getDocs(registrationsQuery);
          registrationMap[session.id] = registrationSnapshots.docs.map((registrationDoc) => ({
            id: registrationDoc.id,
            ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
          }));
        }),
      );

      setSessions(sessionItems);
      setRegistrationsBySession(registrationMap);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  const canManageSessions = useMemo(() => {
    return profile?.role === "admin" || profile?.role === "organiser";
  }, [profile?.role]);

  async function refreshRegistrations(sessionId: string) {
    const registrationsQuery = query(
      collection(db, "registrations"),
      where("sessionId", "==", sessionId),
      orderBy("createdAt"),
    );
    const registrationSnapshots = await getDocs(registrationsQuery);
    const items = registrationSnapshots.docs.map((registrationDoc) => ({
      id: registrationDoc.id,
      ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
    }));
    setRegistrationsBySession((current) => ({ ...current, [sessionId]: items }));
  }

  async function handleRegister(session: SessionItem) {
    if (!user) return;
    setBusySessionId(session.id);

    try {
      const existing = (registrationsBySession[session.id] ?? []).find(
        (registration) => registration.userId === user.uid,
      );

      if (existing) {
        return;
      }

      await addDoc(collection(db, "registrations"), {
        sessionId: session.id,
        userId: user.uid,
        playerName: profile?.displayName || user.email || "Player",
        playerEmail: user.email || "",
        playerPaid: false,
        organiserPaid: false,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "sessions", session.id), {
        bookedCount: (session.bookedCount || 0) + 1,
      });

      await refreshRegistrations(session.id);
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? { ...item, bookedCount: item.bookedCount + 1 }
            : item,
        ),
      );
    } finally {
      setBusySessionId(null);
    }
  }

  async function handlePlayerPaidToggle(registration: RegistrationItem, nextValue: boolean) {
    setBusySessionId(registration.sessionId);
    try {
      await updateDoc(doc(db, "registrations", registration.id), {
        playerPaid: nextValue,
      });
      await refreshRegistrations(registration.sessionId);
    } finally {
      setBusySessionId(null);
    }
  }

  async function handleOrganiserPaidToggle(registration: RegistrationItem, nextValue: boolean) {
    setBusySessionId(registration.sessionId);
    try {
      await updateDoc(doc(db, "registrations", registration.id), {
        organiserPaid: nextValue,
        playerPaid: nextValue ? true : registration.playerPaid,
      });
      await refreshRegistrations(registration.sessionId);
    } finally {
      setBusySessionId(null);
    }
  }

  async function handleOrganiserAddPlayer(session: SessionItem) {
    if (!user) return;
    const playerName = (manualPlayerNames[session.id] ?? "").trim();
    if (!playerName) return;

    setBusySessionId(session.id);
    try {
      await addDoc(collection(db, "registrations"), {
        sessionId: session.id,
        userId: `manual:${session.id}:${playerName}`,
        playerName,
        playerEmail: "",
        playerPaid: false,
        organiserPaid: false,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "sessions", session.id), {
        bookedCount: (session.bookedCount || 0) + 1,
      });

      await refreshRegistrations(session.id);
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? { ...item, bookedCount: item.bookedCount + 1 }
            : item,
        ),
      );
      setManualPlayerNames((current) => ({ ...current, [session.id]: "" }));
    } finally {
      setBusySessionId(null);
    }
  }

  async function handleCopyLastRoster(session: SessionItem) {
    const previousSessions = sessions
      .filter((candidate) => candidate.title === session.title && candidate.id !== session.id)
      .sort((a, b) => (a.nextGameOn ?? "").localeCompare(b.nextGameOn ?? ""));
    const previousSession = previousSessions.at(-1);
    if (!previousSession) return;

    const previousRegistrations = registrationsBySession[previousSession.id] ?? [];
    if (!previousRegistrations.length) return;

    const existingUserIds = new Set(
      (registrationsBySession[session.id] ?? []).map((registration) => registration.userId),
    );

    setBusySessionId(session.id);
    try {
      for (const registration of previousRegistrations) {
        if (existingUserIds.has(registration.userId)) {
          continue;
        }

        await addDoc(collection(db, "registrations"), {
          sessionId: session.id,
          userId: registration.userId,
          playerName: registration.playerName,
          playerEmail: registration.playerEmail,
          playerPaid: false,
          organiserPaid: false,
          createdAt: serverTimestamp(),
        });
        existingUserIds.add(registration.userId);
      }

      await updateDoc(doc(db, "sessions", session.id), {
        bookedCount: existingUserIds.size,
      });

      await refreshRegistrations(session.id);
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? { ...item, bookedCount: existingUserIds.size }
            : item,
        ),
      );
    } finally {
      setBusySessionId(null);
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
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Dashboard
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                Welcome {profile?.displayName || user?.email}
              </h1>
              <p className="mt-3 text-zinc-600">
                Role: <strong>{profile?.role ?? "player"}</strong>
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canManageSessions ? (
                <Link
                  href="/sessions/new"
                  className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  Create session
                </Link>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  await signOut(auth);
                  router.push("/login");
                }}
                className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-2">
          {sessions.length ? (
            sessions.map((session) => {
              const registrations = registrationsBySession[session.id] ?? [];
              const currentRegistration = registrations.find(
                (registration) => registration.userId === user?.uid,
              );
              const showStartsFrom = profile?.role !== "player";

              return (
                <article
                  key={session.id}
                  className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                          {session.typeOfSport}
                        </span>
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                          {session.status}
                        </span>
                      </div>
                      <h2 className="text-xl font-semibold">{session.title}</h2>
                      <p className="mt-2 text-sm text-zinc-600">{session.location}</p>
                    </div>
                    {canManageSessions ? (
                      <Link
                        href={`/sessions/edit?id=${session.id}`}
                        className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100"
                      >
                        Edit
                      </Link>
                    ) : null}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-zinc-700">
                    <div>
                      <dt className="text-zinc-500">Day</dt>
                      <dd>{session.dayOfWeek}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Next game on</dt>
                      <dd>
                        {getEffectiveNextGameOn(
                          session.dayOfWeek as "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun",
                          session.startAt,
                          session.nextGameOn,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Time</dt>
                      <dd>
                        {session.startAt} - {session.endAt}
                      </dd>
                    </div>
                    {showStartsFrom ? (
                      <div>
                        <dt className="text-zinc-500">Starts from</dt>
                        <dd>{session.firstSessionOn}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-zinc-500">Casual price</dt>
                      <dd>${session.defaultPriceCasual}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Capacity</dt>
                      <dd>
                        {session.bookedCount} / {session.capacity}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-6 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">
                        Registrations
                      </h3>
                      {!canManageSessions ? (
                        currentRegistration ? (
                          <span className="text-sm font-medium text-green-700">Registered</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRegister(session)}
                            disabled={busySessionId === session.id || session.bookedCount >= session.capacity}
                            className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Register
                          </button>
                        )
                      ) : null}
                    </div>

                    {canManageSessions ? (
                      <div className="mt-4 space-y-3">
                        <div className="flex gap-2">
                          <input
                            value={manualPlayerNames[session.id] ?? ""}
                            onChange={(event) =>
                              setManualPlayerNames((current) => ({
                                ...current,
                                [session.id]: event.target.value,
                              }))
                            }
                            placeholder="Add player name"
                            className="flex-1 rounded-xl border border-zinc-300 px-4 py-2 text-sm outline-none transition focus:border-zinc-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleOrganiserAddPlayer(session)}
                            disabled={busySessionId === session.id}
                            className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Add player
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyLastRoster(session)}
                          disabled={busySessionId === session.id}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Copy last occurrence roster
                        </button>
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-2">
                      {registrations.length ? (
                        registrations.map((registration) => {
                          const effectivePaid = registration.organiserPaid || registration.playerPaid;
                          const isOwnRegistration = registration.userId === user?.uid;
                          return (
                            <div
                              key={registration.id}
                              className="rounded-xl bg-white p-3 ring-1 ring-zinc-200"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <div className="font-medium text-zinc-900">
                                    {registration.playerName}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {registration.playerEmail || "Manually added player"}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  <span className={`rounded-full px-3 py-1 font-medium ${registration.playerPaid ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                                    player: {registration.playerPaid ? "paid" : "not paid"}
                                  </span>
                                  <span className={`rounded-full px-3 py-1 font-medium ${registration.organiserPaid ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
                                    organiser: {registration.organiserPaid ? "confirmed" : "unconfirmed"}
                                  </span>
                                  <span className={`rounded-full px-3 py-1 font-medium ${effectivePaid ? "bg-violet-100 text-violet-700" : "bg-zinc-100 text-zinc-600"}`}>
                                    effective: {effectivePaid ? "paid" : "pending"}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                {(isOwnRegistration || canManageSessions) && (
                                  <button
                                    type="button"
                                    onClick={() => handlePlayerPaidToggle(registration, !registration.playerPaid)}
                                    disabled={busySessionId === session.id}
                                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Toggle player paid
                                  </button>
                                )}
                                {canManageSessions ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOrganiserPaidToggle(registration, !registration.organiserPaid)}
                                    disabled={busySessionId === session.id}
                                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Toggle organiser confirm
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-zinc-500">No players registered yet.</div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 md:col-span-2">
              No sessions yet. Use <strong>Create session</strong> to add the first one.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
