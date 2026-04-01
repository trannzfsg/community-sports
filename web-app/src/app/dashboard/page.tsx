"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { AppRole } from "@/lib/roles";

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

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

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

      setSessions(sessionItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  const canManageSessions = useMemo(() => {
    return profile?.role === "admin" || profile?.role === "organiser";
  }, [profile?.role]);

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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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

        <section className="grid gap-4 md:grid-cols-2">
          {sessions.length ? (
            sessions.map((session) => (
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
                      href={`/sessions/${session.id}/edit`}
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
                    <dd>{session.nextGameOn ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Time</dt>
                    <dd>
                      {session.startAt} - {session.endAt}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Starts from</dt>
                    <dd>{session.firstSessionOn}</dd>
                  </div>
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
              </article>
            ))
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
