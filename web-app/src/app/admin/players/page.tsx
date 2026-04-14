"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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
import { getManagedUserByEmail, getManagedUsersByRole, normalizeEmail, upsertManagedUser, type ManagedUserRecord } from "@/lib/managed-users";
import { deletePaymentRecord } from "@/lib/payments";
import { shouldRemoveRegistrationForInactivatedPlayer } from "@/lib/admin-player-flows";
import { rebalanceEventRegistrations, type SessionEvent } from "@/lib/session-series";
import { SKILL_LEVEL_OPTIONS, type SkillLevel } from "@/lib/skill-levels";
import { getUsersByRole } from "@/lib/users";
import type { PlayerDirectoryEntry } from "@/lib/players";

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

type DirectoryUserRecord = {
  id: string;
  displayName?: string;
  email?: string;
  role?: "player" | "organiser" | "admin";
  status?: "active" | "inactive";
  isPending?: boolean;
  userId?: string | null;
};

type AdminDirectoryPlayerRecord = {
  key: string;
  playerId: string;
  displayName: string;
  email: string;
  skillLevel: SkillLevel | null;
  status: "active" | "inactive";
  userId: string | null;
  managedUserId: string | null;
  ownerOrganiserId: string | null;
  ownerOrganiserName: string | null;
  kind: "self-registered" | "organiser-private";
};

type OrganiserPrivatePlayerSection = {
  organiserId: string;
  organiserName: string;
  players: AdminDirectoryPlayerRecord[];
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
  const [pendingPlayers, setPendingPlayers] = useState<ManagedUserRecord[]>([]);
  const [selfRegisteredPlayers, setSelfRegisteredPlayers] = useState<AdminDirectoryPlayerRecord[]>([]);
  const [organiserPrivateSections, setOrganiserPrivateSections] = useState<OrganiserPrivatePlayerSection[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [directoryEditingKey, setDirectoryEditingKey] = useState<string | null>(null);
  const [directoryEditDisplayName, setDirectoryEditDisplayName] = useState("");
  const [directoryEditEmail, setDirectoryEditEmail] = useState("");
  const [directoryEditSkillLevel, setDirectoryEditSkillLevel] = useState<SkillLevel | "">("");

  function splitByStatus<T extends { status?: "active" | "inactive" }>(items: T[]) {
    return {
      active: items.filter((item) => item.status !== "inactive"),
      inactive: items.filter((item) => item.status === "inactive"),
    };
  }

  function sortPlayersByName(a: { displayName: string; email: string }, b: { displayName: string; email: string }) {
    const nameCompare = a.displayName.localeCompare(b.displayName);
    if (nameCompare !== 0) return nameCompare;
    return a.email.localeCompare(b.email);
  }

  const loadPlayers = useCallback(async () => {
    const [managedItems, playerSnapshots, organiserUsers, userSnapshots] = await Promise.all([
      getManagedUsersByRole(db, "player"),
      getDocs(collection(db, "players")),
      getUsersByRole(db, "organiser"),
      getDocs(collection(db, "users")),
    ]);

    const directoryPlayers = playerSnapshots.docs.map((playerDoc) => ({
      id: playerDoc.id,
      ...(playerDoc.data() as Omit<PlayerDirectoryEntry, "id">),
    }));
    const directoryPlayerEmails = new Set(directoryPlayers.map((player) => normalizeEmail(player.email)).filter(Boolean));

    setPendingPlayers(
      managedItems
        .filter((item) => !item.userId && !directoryPlayerEmails.has(normalizeEmail(item.email)))
        .sort((a, b) => a.email.localeCompare(b.email)),
    );

    const organiserNames = new Map(
      organiserUsers.map((organiser) => [
        organiser.id,
        organiser.displayName || organiser.email || "Organiser",
      ]),
    );
    const userDocs = userSnapshots.docs.map((userDoc) => ({
      id: userDoc.id,
      ...(userDoc.data() as Omit<DirectoryUserRecord, "id">),
    }));
    const usersById = new Map(userDocs.map((user) => [user.id, user]));
    const pendingUsersByEmail = new Map(
      userDocs
        .filter((user) => user.isPending && user.email)
        .map((user) => [normalizeEmail(user.email || ""), user]),
    );

    const nextSelfRegisteredPlayers: AdminDirectoryPlayerRecord[] = [];
    const nextOrganiserPrivateSections = new Map<string, OrganiserPrivatePlayerSection>();

    for (const player of directoryPlayers) {
      const emailKey = normalizeEmail(player.email);
      const linkedUser = player.userId ? usersById.get(player.userId) : null;
      if (linkedUser?.role && linkedUser.role !== "player") {
        continue;
      }

      const pendingUser = pendingUsersByEmail.get(emailKey);
      const status = linkedUser?.status || pendingUser?.status || "active";
      const directoryRecord: AdminDirectoryPlayerRecord = {
        key: player.id,
        playerId: player.id,
        displayName: player.displayName || linkedUser?.displayName || pendingUser?.displayName || player.email || "Player",
        email: player.email,
        skillLevel: player.skillLevel || null,
        status,
        userId: player.userId || linkedUser?.userId || null,
        managedUserId: pendingUser?.id || null,
        ownerOrganiserId: player.ownerOrganiserId,
        ownerOrganiserName: player.ownerOrganiserId ? organiserNames.get(player.ownerOrganiserId) || "Organiser" : null,
        kind: player.ownerOrganiserId ? "organiser-private" : "self-registered",
      };

      if (!player.ownerOrganiserId && directoryRecord.userId) {
        nextSelfRegisteredPlayers.push(directoryRecord);
        continue;
      }

      if (!player.ownerOrganiserId) {
        continue;
      }

      const existingSection = nextOrganiserPrivateSections.get(player.ownerOrganiserId);
      if (existingSection) {
        existingSection.players.push(directoryRecord);
        continue;
      }

      nextOrganiserPrivateSections.set(player.ownerOrganiserId, {
        organiserId: player.ownerOrganiserId,
        organiserName: directoryRecord.ownerOrganiserName || "Organiser",
        players: [directoryRecord],
      });
    }

    setSelfRegisteredPlayers(nextSelfRegisteredPlayers.sort(sortPlayersByName));
    setOrganiserPrivateSections(
      Array.from(nextOrganiserPrivateSections.values())
        .map((section) => ({
          ...section,
          players: section.players.sort(sortPlayersByName),
        }))
        .sort((a, b) => a.organiserName.localeCompare(b.organiserName)),
    );
  }, []);

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
  }, [loadPlayers, router]);

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

  function startEdit(player: ManagedUserRecord) {
    setEditingId(player.id);
    setEditDisplayName(player.displayName);
    setEditEmail(player.email);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDisplayName("");
    setEditEmail("");
  }

  function startDirectoryEdit(player: AdminDirectoryPlayerRecord) {
    setDirectoryEditingKey(player.key);
    setDirectoryEditDisplayName(player.displayName);
    setDirectoryEditEmail(player.email);
    setDirectoryEditSkillLevel(player.skillLevel || "");
    setError("");
  }

  function cancelDirectoryEdit() {
    setDirectoryEditingKey(null);
    setDirectoryEditDisplayName("");
    setDirectoryEditEmail("");
    setDirectoryEditSkillLevel("");
  }

  async function handleUpdate(player: ManagedUserRecord) {
    setBusyKey(`edit-${player.id}`);
    setError("");

    try {
      const trimmedDisplayName = editDisplayName.trim();
      const normalizedNextEmail = normalizeEmail(editEmail);
      const normalizedCurrentEmail = normalizeEmail(player.email);

      if (!trimmedDisplayName) {
        throw new Error("Display name is required.");
      }

      if (!normalizedNextEmail) {
        throw new Error("Email is required.");
      }


      if (!player.userId && normalizedNextEmail !== normalizedCurrentEmail) {
        const existing = await getManagedUserByEmail(db, normalizedNextEmail);
        if (existing && existing.id !== player.id) {
          throw new Error("Another managed user already uses that email.");
        }
      }

      await upsertManagedUser(db, {
        id: player.id,
        email: normalizedNextEmail,
        displayName: trimmedDisplayName,
        role: player.role,
        status: player.status,
        userId: player.userId ?? null,
      });

      if (player.userId) {
        await setDoc(doc(db, "users", player.userId), {
          displayName: trimmedDisplayName,
          email: normalizedNextEmail,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        await setDoc(doc(db, "players", player.userId), {
          displayName: trimmedDisplayName,
          email: normalizedNextEmail,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      cancelEdit();
      await loadPlayers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update player.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleInactivate(player: ManagedUserRecord) {
    setBusyKey(player.id);
    setError("");

    try {
      await updateDoc(doc(db, "users", player.id), {
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

  async function handleDirectoryUpdate(player: AdminDirectoryPlayerRecord) {
    setBusyKey(`directory-edit-${player.key}`);
    setError("");

    try {
      const trimmedDisplayName = directoryEditDisplayName.trim();
      const canEditEmail = player.kind === "organiser-private" && !player.userId;
      const normalizedNextEmail = normalizeEmail(canEditEmail ? directoryEditEmail : player.email);
      if (!trimmedDisplayName) {
        throw new Error("Display name is required.");
      }

      if (!normalizedNextEmail) {
        throw new Error("Email is required.");
      }

      if (canEditEmail && normalizedNextEmail !== normalizeEmail(player.email)) {
        const existingManaged = await getManagedUserByEmail(db, normalizedNextEmail);
        if (existingManaged && existingManaged.id !== player.managedUserId) {
          throw new Error("Another managed user already uses that email.");
        }
      }

      await setDoc(doc(db, "players", player.playerId), {
        displayName: trimmedDisplayName,
        email: normalizedNextEmail,
        skillLevel: directoryEditSkillLevel || null,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (player.managedUserId) {
        if (canEditEmail && player.managedUserId !== normalizedNextEmail) {
          await deleteDoc(doc(db, "users", player.managedUserId));
        }

        await upsertManagedUser(db, {
          id: canEditEmail ? undefined : player.managedUserId,
          email: normalizedNextEmail,
          displayName: trimmedDisplayName,
          role: "player",
          status: player.status,
          userId: player.userId,
        });
      }

      if (player.userId) {
        await setDoc(doc(db, "users", player.userId), {
          displayName: trimmedDisplayName,
          email: normalizedNextEmail,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      cancelDirectoryEdit();
      await loadPlayers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update player.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDirectoryInactivate(player: AdminDirectoryPlayerRecord) {
    setBusyKey(`directory-remove-${player.key}`);
    setError("");

    try {
      if (player.managedUserId) {
        await setDoc(doc(db, "users", player.managedUserId), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      if (player.userId) {
        await setDoc(doc(db, "users", player.userId), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      const registrationsSnapshot = await getDocs(
        query(collection(db, "registrations"), where("userId", "==", player.playerId)),
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

      if (player.kind === "organiser-private" && !player.userId) {
        await deleteDoc(doc(db, "players", player.playerId));
      } else {
        await setDoc(doc(db, "players", player.playerId), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      if (directoryEditingKey === player.key) {
        cancelDirectoryEdit();
      }

      await loadPlayers();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove player.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePendingReactivate(player: ManagedUserRecord) {
    setBusyKey(`reactivate-${player.id}`);
    setError("");

    try {
      await setDoc(doc(db, "users", player.id), {
        status: "active",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await loadPlayers();
    } catch (reactivateError) {
      setError(reactivateError instanceof Error ? reactivateError.message : "Failed to reactivate player.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDirectoryReactivate(player: AdminDirectoryPlayerRecord) {
    setBusyKey(`reactivate-directory-${player.key}`);
    setError("");

    try {
      if (player.managedUserId) {
        await setDoc(doc(db, "users", player.managedUserId), {
          status: "active",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      if (player.userId) {
        await setDoc(doc(db, "users", player.userId), {
          status: "active",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      await setDoc(doc(db, "players", player.playerId), {
        status: "active",
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await loadPlayers();
    } catch (reactivateError) {
      setError(reactivateError instanceof Error ? reactivateError.message : "Failed to reactivate player.");
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

  const pendingPlayerGroups = splitByStatus(pendingPlayers);
  const selfRegisteredGroups = splitByStatus(selfRegisteredPlayers);
  const organiserPrivateSectionGroups = organiserPrivateSections.map((section) => ({
    ...section,
    activePlayers: section.players.filter((player) => player.status !== "inactive"),
    inactivePlayers: section.players.filter((player) => player.status === "inactive"),
  }));

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
              <input type="email" value={email} onChange={(event) => setEmail(normalizeEmail(event.target.value))} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" required />
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
          <h2 className="text-xl font-semibold">Admin-created pending players</h2>
          <div className="mt-6 space-y-3">
            {pendingPlayerGroups.active.length ? pendingPlayerGroups.active.map((player) => {
              const isEditing = editingId === player.id;
              const isSaving = busyKey === `edit-${player.id}`;
              const canEditEmail = true;

              return (
                <div key={player.id} className="rounded-2xl border border-zinc-200 p-4">
                  {isEditing ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleUpdate(player);
                      }}
                    >
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Display name</span>
                        <input
                          value={editDisplayName}
                          onChange={(event) => setEditDisplayName(event.target.value)}
                          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          required
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Email</span>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(event) => setEditEmail(event.target.value)}
                          disabled={!canEditEmail}
                          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                          required
                        />
                      </label>


                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSaving ? "Saving..." : "Save changes"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInactivate(player)}
                          disabled={busyKey === player.id || player.status === "inactive" || isSaving}
                          className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remove player
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-zinc-900">{player.displayName}</div>
                        <div className="text-sm text-zinc-500">{player.email}</div>
                        <div className="mt-1 text-xs text-zinc-500">Status: {player.status}{player.userId ? ` • linked: ${player.userId}` : " • not registered yet"}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(player)}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInactivate(player)}
                          disabled={busyKey === player.id || player.status === "inactive"}
                          className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remove player
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }) : <div className="text-sm text-zinc-500">No active admin-created pending players.</div>}
          </div>

          <div className="mt-8">
            <h3 className="text-lg font-semibold text-zinc-900">Inactive admin-created pending players</h3>
            <div className="mt-4 space-y-3">
              {pendingPlayerGroups.inactive.length ? pendingPlayerGroups.inactive.map((player) => {
                const isReactivating = busyKey === `reactivate-${player.id}`;

                return (
                  <div key={player.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-zinc-900">{player.displayName}</div>
                        <div className="text-sm text-zinc-500">{player.email}</div>
                        <div className="mt-1 text-xs text-zinc-500">Status: inactive</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handlePendingReactivate(player)}
                        disabled={isReactivating}
                        className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isReactivating ? "Reactivating..." : "Reactivate player"}
                      </button>
                    </div>
                  </div>
                );
              }) : <div className="text-sm text-zinc-500">No inactive admin-created pending players.</div>}
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Self-registered players</h2>
          <p className="mt-2 text-sm text-zinc-500">Admin can review and edit shared player-directory details here. Email is readonly.</p>
          <div className="mt-6 space-y-3">
            {selfRegisteredGroups.active.length ? selfRegisteredGroups.active.map((player) => {
              const isEditing = directoryEditingKey === player.key;
              const isSaving = busyKey === `directory-edit-${player.key}`;
              const isRemoving = busyKey === `directory-remove-${player.key}`;

              return (
                <div key={player.key} className="rounded-2xl border border-zinc-200 p-4">
                  {isEditing ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleDirectoryUpdate(player);
                      }}
                    >
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Display name</span>
                        <input
                          value={directoryEditDisplayName}
                          onChange={(event) => setDirectoryEditDisplayName(event.target.value)}
                          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          required
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Email</span>
                        <input
                          type="email"
                          value={directoryEditEmail}
                          onChange={(event) => setDirectoryEditEmail(event.target.value)}
                          disabled
                          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Skill level</span>
                        <select
                          value={directoryEditSkillLevel}
                          onChange={(event) => setDirectoryEditSkillLevel(event.target.value as SkillLevel | "")}
                          className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                        >
                          <option value="">Not set</option>
                          {SKILL_LEVEL_OPTIONS.map((level) => (
                            <option key={level} value={level}>{level}</option>
                          ))}
                        </select>
                      </label>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSaving ? "Saving..." : "Save changes"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelDirectoryEdit}
                          disabled={isSaving || isRemoving}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDirectoryInactivate(player)}
                          disabled={isSaving || isRemoving}
                          className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRemoving ? "Removing..." : "Remove player"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-zinc-900">{player.displayName}</div>
                        <div className="text-sm text-zinc-500">{player.email}</div>
                        <div className="mt-1 text-xs text-zinc-500">Skill level: {player.skillLevel || "Not set"}</div>
                        <div className="mt-1 text-xs text-zinc-500">Status: {player.status}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startDirectoryEdit(player)}
                          disabled={isRemoving}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDirectoryInactivate(player)}
                          disabled={isRemoving}
                          className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRemoving ? "Removing..." : "Remove player"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }) : <div className="text-sm text-zinc-500">No active self-registered players.</div>}
          </div>

          <div className="mt-8">
            <h3 className="text-lg font-semibold text-zinc-900">Inactive self-registered players</h3>
            <div className="mt-4 space-y-3">
              {selfRegisteredGroups.inactive.length ? selfRegisteredGroups.inactive.map((player) => {
                const isReactivating = busyKey === `reactivate-directory-${player.key}`;

                return (
                  <div key={player.key} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-zinc-900">{player.displayName}</div>
                        <div className="text-sm text-zinc-500">{player.email}</div>
                        <div className="mt-1 text-xs text-zinc-500">Skill level: {player.skillLevel || "Not set"}</div>
                        <div className="mt-1 text-xs text-zinc-500">Status: inactive</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDirectoryReactivate(player)}
                        disabled={isReactivating}
                        className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isReactivating ? "Reactivating..." : "Reactivate player"}
                      </button>
                    </div>
                  </div>
                );
              }) : <div className="text-sm text-zinc-500">No inactive self-registered players.</div>}
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Organiser private players</h2>
          <p className="mt-2 text-sm text-zinc-500">Each organiser&apos;s private player list is grouped separately for admin review. Active organiser-private emails can be edited here until the player has a linked auth account.</p>
          <div className="mt-6 space-y-6">
            {organiserPrivateSectionGroups.length ? organiserPrivateSectionGroups.map((section) => (
              <section key={section.organiserId} className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">{section.organiserName}</h3>
                  <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">Organiser private players</p>
                </div>

                {section.activePlayers.length ? section.activePlayers.map((player) => {
                  const isEditing = directoryEditingKey === player.key;
                  const isSaving = busyKey === `directory-edit-${player.key}`;
                  const isRemoving = busyKey === `directory-remove-${player.key}`;

                  return (
                    <div key={player.key} className="rounded-2xl border border-zinc-200 p-4">
                      {isEditing ? (
                        <form
                          className="space-y-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleDirectoryUpdate(player);
                          }}
                        >
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Display name</span>
                            <input
                              value={directoryEditDisplayName}
                              onChange={(event) => setDirectoryEditDisplayName(event.target.value)}
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                              required
                            />
                          </label>

                          <label className="block">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Email</span>
                            <input
                              type="email"
                              value={directoryEditEmail}
                              onChange={(event) => setDirectoryEditEmail(event.target.value)}
                              disabled={!!player.userId}
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                            />
                          </label>

                          <label className="block">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-600">Skill level</span>
                            <select
                              value={directoryEditSkillLevel}
                              onChange={(event) => setDirectoryEditSkillLevel(event.target.value as SkillLevel | "")}
                              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                            >
                              <option value="">Not set</option>
                              {SKILL_LEVEL_OPTIONS.map((level) => (
                                <option key={level} value={level}>{level}</option>
                              ))}
                            </select>
                          </label>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={isSaving}
                              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSaving ? "Saving..." : "Save changes"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelDirectoryEdit}
                              disabled={isSaving || isRemoving}
                              className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDirectoryInactivate(player)}
                              disabled={isSaving || isRemoving}
                              className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isRemoving ? "Removing..." : "Remove player"}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-medium text-zinc-900">{player.displayName}</div>
                            <div className="text-sm text-zinc-500">{player.email}</div>
                            <div className="mt-1 text-xs text-zinc-500">Skill level: {player.skillLevel || "Not set"}</div>
                            <div className="mt-1 text-xs text-zinc-500">Status: {player.status}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startDirectoryEdit(player)}
                              disabled={isRemoving}
                              className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDirectoryInactivate(player)}
                              disabled={isRemoving}
                              className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isRemoving ? "Removing..." : "Remove player"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }) : <div className="text-sm text-zinc-500">No active organiser private players.</div>}

                <div className="pt-2">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Inactive</h4>
                  <div className="mt-3 space-y-3">
                    {section.inactivePlayers.length ? section.inactivePlayers.map((player) => {
                      const isReactivating = busyKey === `reactivate-directory-${player.key}`;

                      return (
                        <div key={player.key} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="font-medium text-zinc-900">{player.displayName}</div>
                              <div className="text-sm text-zinc-500">{player.email}</div>
                              <div className="mt-1 text-xs text-zinc-500">Skill level: {player.skillLevel || "Not set"}</div>
                              <div className="mt-1 text-xs text-zinc-500">Status: inactive</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDirectoryReactivate(player)}
                              disabled={isReactivating}
                              className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isReactivating ? "Reactivating..." : "Reactivate player"}
                            </button>
                          </div>
                        </div>
                      );
                    }) : <div className="text-sm text-zinc-500">No inactive organiser private players.</div>}
                  </div>
                </div>
              </section>
            )) : <div className="text-sm text-zinc-500">No organiser private players yet.</div>}
          </div>
        </div>
      </div>
    </main>
  );
}
