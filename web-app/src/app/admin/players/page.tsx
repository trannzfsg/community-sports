"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getManagedUsersByRole, upsertManagedUser, type ManagedUserRecord } from "@/lib/managed-users";
import { deletePaymentRecord } from "@/lib/payments";
import { shouldRemoveRegistrationForInactivatedPlayer } from "@/lib/admin-player-flows";
import { rebalanceEventRegistrations, type SessionEvent } from "@/lib/session-series";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  status?: "active" | "inactive";
};

type RegistrationRecord = {
  id: string;
  sessionEventId: string;
  userId: string;
};

function getTodayInBrisbane() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function AdminPlayersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [players, setPlayers] = useState<ManagedUserRecord[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  async function loadPlayers() {
    const items = await getManagedUsersByRole(db, "player");
    setPlayers(items.sort((a, b) => a.email.localeCompare(b.email)));
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      const snapshot = await getDoc(doc(db, "users", user.uid));
      const profile = snapshot.data() as UserProfile | undefined;
      if (!profile || profile.role !== "admin") {
        router.push("/dashboard");
        return;
      }

      await loadPlayers();
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("create");
    setError("");

    try {
      await upsertManagedUser(db, {
        email,
        displayName,
        role: "player",
        status: "active",
      });
      setEmail("");
      setDisplayName("");
      await loadPlayers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create player.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleInactivate(player: ManagedUserRecord) {
    setBusyKey(player.id);
    setError("");

    try {
      await updateDoc(doc(db, "managedUsers", player.id), {
        status: "inactive",
        updatedAt: serverTimestamp(),
      });

      if (player.userId) {
        await setDoc(doc(db, "users", player.userId), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, { merge: true });

        const registrationsSnapshot = await getDocs(
          query(collection(db, "registrations"), where("userId", "==", player.userId)),
        );

        const today = getTodayInBrisbane();
        const affectedEventCapacities = new Map<string, number>();

        for (const registrationDoc of registrationsSnapshot.docs) {
          const registration = {
            id: registrationDoc.id,
            ...(registrationDoc.data() as Omit<RegistrationRecord, "id">),
          };

          const eventSnapshot = await getDoc(doc(db, "sessionEvents", registration.sessionEventId));
          if (!eventSnapshot.exists()) {
            continue;
          }

          const event = eventSnapshot.data() as SessionEvent;
          if (!shouldRemoveRegistrationForInactivatedPlayer({ eventDate: event.eventDate, today })) {
            continue;
          }

          await deletePaymentRecord(db, registration.id);
          await deleteDoc(registrationDoc.ref);
          affectedEventCapacities.set(registration.sessionEventId, event.capacity);
        }

        for (const [sessionEventId, capacity] of affectedEventCapacities) {
          await rebalanceEventRegistrations(db, sessionEventId, capacity);
        }
      }

      await loadPlayers();
    } catch (inactivateError) {
      setError(inactivateError instanceof Error ? inactivateError.message : "Failed to inactivate player.");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading players...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Admin</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Players</h1>
              <p className="mt-3 text-zinc-600">Manage player records. Inactivating a player removes them from current/future event registrations and keeps historical events unchanged.</p>
            </div>
            <Link href="/dashboard" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Back</Link>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Create player</h2>
          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleCreate}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-700">Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-700">Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
            </label>
            <div className="md:col-span-2">
              <button type="submit" disabled={busyKey === "create"} className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
                {busyKey === "create" ? "Creating..." : "Create player"}
              </button>
            </div>
          </form>
          {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Existing players</h2>
          <div className="mt-6 space-y-3">
            {players.length ? players.map((player) => (
              <div key={player.id} className="rounded-2xl border border-zinc-200 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-zinc-900">{player.displayName}</div>
                    <div className="text-sm text-zinc-500">{player.email}</div>
                    <div className="mt-1 text-xs text-zinc-500">Status: {player.status}{player.userId ? ` • linked: ${player.userId}` : " • not registered yet"}</div>
                  </div>
                  <button type="button" onClick={() => handleInactivate(player)} disabled={busyKey === player.id || player.status === "inactive"} className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
                    {player.status === "inactive" ? "Inactive" : "Inactivate player"}
                  </button>
                </div>
              </div>
            )) : <div className="text-sm text-zinc-500">No managed players yet.</div>}
          </div>
        </div>
      </div>
    </main>
  );
}
