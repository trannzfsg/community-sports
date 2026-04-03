"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  createManualPlayer,
  getVisiblePlayersForOrganiser,
  normalizePlayerEmail,
  updateManualPlayerSkillLevel,
  type PlayerDirectoryEntry,
} from "@/lib/players";
import { getManagedUserByEmail, upsertManagedUser } from "@/lib/managed-users";
import { SKILL_LEVEL_OPTIONS, type SkillLevel } from "@/lib/skill-levels";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  status?: "active" | "inactive";
};

export default function OrganiserPlayersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [players, setPlayers] = useState<PlayerDirectoryEntry[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organiserId, setOrganiserId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  async function loadPlayers(ownerOrganiserId: string) {
    const items = await getVisiblePlayersForOrganiser(db, ownerOrganiserId);
    setPlayers(items.filter((item) => item.ownerOrganiserId === ownerOrganiserId));
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      const snapshot = await getDoc(doc(db, "users", user.uid));
      const profile = snapshot.data() as UserProfile | undefined;
      if (!profile || profile.role !== "organiser") {
        router.push("/dashboard");
        return;
      }

      setOrganiserId(user.uid);
      await loadPlayers(user.uid);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organiserId) return;

    setBusyKey("create");
    setError("");

    try {
      const trimmedName = displayName.trim();
      const normalizedEmail = normalizePlayerEmail(email);
      if (!trimmedName || !normalizedEmail) {
        throw new Error("Display name and email are required.");
      }

      await createManualPlayer(db, organiserId, trimmedName, normalizedEmail);
      await upsertManagedUser(db, {
        email: normalizedEmail,
        displayName: trimmedName,
        role: "player",
        status: "active",
      });
      setEmail("");
      setDisplayName("");
      await loadPlayers(organiserId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create player.");
    } finally {
      setBusyKey(null);
    }
  }

  function startEdit(player: PlayerDirectoryEntry) {
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

  async function handleUpdate(player: PlayerDirectoryEntry) {
    setBusyKey(`edit-${player.id}`);
    setError("");

    try {
      const trimmedName = editDisplayName.trim();
      const normalizedEmail = normalizePlayerEmail(editEmail);
      if (!trimmedName || !normalizedEmail) {
        throw new Error("Display name and email are required.");
      }

      await setDoc(doc(db, "players", player.id), {
        displayName: trimmedName,
        email: normalizedEmail,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      const existingManaged = await getManagedUserByEmail(db, normalizedEmail);
      await upsertManagedUser(db, {
        id: existingManaged?.id,
        email: normalizedEmail,
        displayName: trimmedName,
        role: "player",
        status: "active",
        userId: existingManaged?.userId ?? null,
      });

      if (player.userId) {
        await setDoc(doc(db, "users", player.userId), {
          displayName: trimmedName,
          email: normalizedEmail,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      cancelEdit();
      await loadPlayers(organiserId);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update player.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSkillLevelChange(playerId: string, skillLevel: SkillLevel | "") {
    setBusyKey(playerId);
    try {
      await updateManualPlayerSkillLevel(db, playerId, skillLevel || null);
      setPlayers((current) => current.map((player) => player.id === playerId ? { ...player, skillLevel: skillLevel || null } : player));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading organiser players...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Organiser</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Players</h1>
              <p className="mt-3 text-zinc-600">Manage your organiser-private manual players. Self-registered players are shared globally and not edited here.</p>
            </div>
            <Link href="/dashboard" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Back</Link>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Create private player</h2>
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
          <h2 className="text-xl font-semibold">Your private players</h2>
          <div className="mt-6 space-y-3">
            {players.length ? players.map((player) => {
              const isEditing = editingId === player.id;
              const isSaving = busyKey === `edit-${player.id}`;

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
                          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
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
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-zinc-900">{player.displayName}</div>
                        <div className="text-sm text-zinc-500">{player.email}</div>
                        <div className="mt-1 text-xs text-zinc-500">Skill level: {player.skillLevel || "Not set"}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(player)}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Edit
                        </button>
                        <select
                          value={player.skillLevel || ""}
                          onChange={(event) => handleSkillLevelChange(player.id, event.target.value as SkillLevel | "")}
                          disabled={busyKey === player.id}
                          className="rounded-full border border-zinc-300 px-3 py-2 text-xs font-medium bg-white"
                        >
                          <option value="">Skill level</option>
                          {SKILL_LEVEL_OPTIONS.map((level) => (
                            <option key={level} value={level}>{level}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            }) : <div className="text-sm text-zinc-500">No private players yet.</div>}
          </div>
        </div>
      </div>
    </main>
  );
}
