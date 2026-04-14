"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { resolveDataPartition, type DataPartition } from "@/lib/data-partition";
import { getManagedUserByEmail, getManagedUsersByRole, normalizeEmail, upsertManagedUser, type ManagedUserRecord } from "@/lib/managed-users";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  status?: "active" | "inactive";
  dataPartition?: DataPartition;
};

export default function AdminOrganisersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [organisers, setOrganisers] = useState<ManagedUserRecord[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [dataPartition, setDataPartition] = useState<DataPartition>("live");

  const loadOrganisers = useCallback(async (partition = dataPartition) => {
    const [items, registeredOrganiserUsers] = await Promise.all([
      getManagedUsersByRole(db, "organiser", partition),
      getDocs(query(collection(db, "users"), where("role", "==", "organiser"), where("dataPartition", "==", partition))),
    ]);
    const groupedByEmail = new Map<string, ManagedUserRecord[]>();
    const registeredByEmail = new Map(
      registeredOrganiserUsers.docs
        .map((userDoc) => ({
          id: userDoc.id,
          ...(userDoc.data() as { email?: string; displayName?: string; status?: "active" | "inactive" }),
        }))
        .filter((user) => user.email)
        .map((user) => [normalizeEmail(user.email || ""), user]),
    );

    for (const item of items) {
      const emailKey = normalizeEmail(item.email);
      const existing = groupedByEmail.get(emailKey);
      if (existing) {
        existing.push(item);
      } else {
        groupedByEmail.set(emailKey, [item]);
      }
    }

    const dedupedOrganisers = Array.from(groupedByEmail.values()).map((records) => {
      const primaryManagedRecord =
        records.find((record) => record.id === normalizeEmail(record.email))
        || records.find((record) => record.isPending)
        || records[0];
      const linkedRecord = records.find((record) => record.userId) || null;
      const registeredRecord = registeredByEmail.get(normalizeEmail(primaryManagedRecord.email || linkedRecord?.email || "")) || null;
      const mergedStatus = records.some((record) => record.status === "inactive") ? "inactive" : "active";

      return {
        ...primaryManagedRecord,
        email: primaryManagedRecord.email || linkedRecord?.email || registeredRecord?.email || "",
        displayName: primaryManagedRecord.displayName || linkedRecord?.displayName || registeredRecord?.displayName || primaryManagedRecord.email,
        userId: primaryManagedRecord.userId || linkedRecord?.userId || registeredRecord?.id || null,
        status: registeredRecord?.status || mergedStatus,
      } satisfies ManagedUserRecord;
    });

    setOrganisers(
      dedupedOrganisers
        .sort((a, b) => a.email.localeCompare(b.email)),
    );
  }, [dataPartition]);

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

      const nextPartition = resolveDataPartition(profile.email || user.email || "", profile.dataPartition || "live");
      setDataPartition(nextPartition);
      await loadOrganisers(nextPartition);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [loadOrganisers, router]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("create");
    setError("");

    try {
      await upsertManagedUser(db, {
        email,
        displayName,
        role: "organiser",
        status: "active",
      });
      setEmail("");
      setDisplayName("");
      await loadOrganisers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create organiser.");
    } finally {
      setBusyKey(null);
    }
  }

  function startEdit(organiser: ManagedUserRecord) {
    setEditingId(organiser.id);
    setEditDisplayName(organiser.displayName);
    setEditEmail(organiser.email);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDisplayName("");
    setEditEmail("");
  }

  async function handleUpdate(organiser: ManagedUserRecord) {
    setBusyKey(`edit-${organiser.id}`);
    setError("");

    try {
      const trimmedDisplayName = editDisplayName.trim();
      const canEditEmail = !organiser.userId;
      const normalizedNextEmail = normalizeEmail(canEditEmail ? editEmail : organiser.email);
      const normalizedCurrentEmail = normalizeEmail(organiser.email);

      if (!trimmedDisplayName) {
        throw new Error("Display name is required.");
      }

      if (!normalizedNextEmail) {
        throw new Error("Email is required.");
      }

      if (canEditEmail && normalizedNextEmail !== normalizedCurrentEmail) {
        const existing = await getManagedUserByEmail(db, normalizedNextEmail);
        if (existing && existing.id !== organiser.id) {
          throw new Error("Another organiser already uses that email.");
        }
      }

      await upsertManagedUser(db, {
        id: organiser.id,
        email: normalizedNextEmail,
        displayName: trimmedDisplayName,
        role: "organiser",
        status: organiser.status,
        userId: organiser.userId ?? null,
      });

      if (organiser.userId) {
        await setDoc(doc(db, "users", organiser.userId), {
          displayName: trimmedDisplayName,
          email: normalizedNextEmail,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      cancelEdit();
      await loadOrganisers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update organiser.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleInactivate(organiser: ManagedUserRecord) {
    setBusyKey(organiser.id);
    setError("");

    try {
      await updateDoc(doc(db, "managedUsers", organiser.id), {
        status: "inactive",
        updatedAt: serverTimestamp(),
      });

      if (organiser.userId) {
        await setDoc(doc(db, "users", organiser.userId), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, { merge: true });

        const seriesSnapshot = await getDocs(
          query(collection(db, "sessions"), where("organiserId", "==", organiser.userId), where("dataPartition", "==", dataPartition)),
        );

        await Promise.all(
          seriesSnapshot.docs.map((seriesDoc) => updateDoc(seriesDoc.ref, { status: "inactive" })),
        );
      }

      await loadOrganisers();
    } catch (inactivateError) {
      setError(inactivateError instanceof Error ? inactivateError.message : "Failed to inactivate organiser.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReactivate(organiser: ManagedUserRecord) {
    setBusyKey(`reactivate-${organiser.id}`);
    setError("");

    try {
      await setDoc(doc(db, "managedUsers", organiser.id), {
        status: "active",
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (organiser.userId) {
        await setDoc(doc(db, "users", organiser.userId), {
          status: "active",
          updatedAt: serverTimestamp(),
        }, { merge: true });

        const seriesSnapshot = await getDocs(
          query(collection(db, "sessions"), where("organiserId", "==", organiser.userId), where("dataPartition", "==", dataPartition)),
        );

        await Promise.all(
          seriesSnapshot.docs.map((seriesDoc) => updateDoc(seriesDoc.ref, { status: "active" })),
        );
      }

      await loadOrganisers();
    } catch (reactivateError) {
      setError(reactivateError instanceof Error ? reactivateError.message : "Failed to reactivate organiser.");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading organisers...</div>
      </main>
    );
  }

  const registeredOrganisers = organisers.filter((organiser) => organiser.userId);
  const pendingOrganisers = organisers.filter((organiser) => !organiser.userId);
  const activeRegisteredOrganisers = registeredOrganisers.filter((organiser) => organiser.status !== "inactive");
  const inactiveRegisteredOrganisers = registeredOrganisers.filter((organiser) => organiser.status === "inactive");
  const activePendingOrganisers = pendingOrganisers.filter((organiser) => organiser.status !== "inactive");
  const inactivePendingOrganisers = pendingOrganisers.filter((organiser) => organiser.status === "inactive");

  function renderOrganiserCard(organiser: ManagedUserRecord) {
    const isEditing = editingId === organiser.id;
    const isSaving = busyKey === `edit-${organiser.id}`;
    const canEditEmail = !organiser.userId;

    return (
      <div key={organiser.id} className="rounded-2xl border border-zinc-200 p-4">
        {isEditing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleUpdate(organiser);
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
                onClick={() => handleInactivate(organiser)}
                disabled={busyKey === organiser.id || organiser.status === "inactive" || isSaving}
                className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove organiser
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-zinc-900">{organiser.displayName}</div>
              <div className="text-sm text-zinc-500">{organiser.email}</div>
              <div className="mt-1 text-xs text-zinc-500">Status: {organiser.status}{organiser.userId ? ` • linked: ${organiser.userId}` : " • not registered yet"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startEdit(organiser)}
                className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleInactivate(organiser)}
                disabled={busyKey === organiser.id || organiser.status === "inactive"}
                className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove organiser
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderInactiveOrganiserCard(organiser: ManagedUserRecord) {
    const isReactivating = busyKey === `reactivate-${organiser.id}`;

    return (
      <div key={organiser.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium text-zinc-900">{organiser.displayName}</div>
            <div className="text-sm text-zinc-500">{organiser.email}</div>
            <div className="mt-1 text-xs text-zinc-500">Status: inactive{organiser.userId ? ` • linked: ${organiser.userId}` : " • not registered yet"}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleReactivate(organiser)}
            disabled={isReactivating}
            className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReactivating ? "Reactivating..." : "Reactivate organiser"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Admin</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Organisers</h1>
              <p className="mt-3 text-zinc-600">Admins create organisers first. Organisers can then self-register to set their password.</p>
              <p className="mt-2 text-sm text-zinc-500">The organiser must register with this exact email address, otherwise the account will be treated as a normal player sign-up.</p>
            </div>
            <Link href="/dashboard" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100">Back</Link>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Create organiser</h2>
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
                {busyKey === "create" ? "Creating..." : "Create organiser"}
              </button>
            </div>
          </form>
          {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-xl font-semibold">Existing organisers</h2>
          <div className="mt-6 grid gap-6">
            <section className="rounded-2xl border border-zinc-200 p-6">
              <h3 className="text-lg font-semibold text-zinc-900">Registered organisers</h3>
              <p className="mt-2 text-sm text-zinc-600">These organisers have already linked an auth account, so their email stays readonly in edit mode.</p>
              <div className="mt-4 space-y-3">
                {activeRegisteredOrganisers.length ? activeRegisteredOrganisers.map((organiser) => renderOrganiserCard(organiser)) : <div className="text-sm text-zinc-500">No registered organisers yet.</div>}
              </div>

              <div className="mt-8">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Inactive</h4>
                <div className="mt-3 space-y-3">
                  {inactiveRegisteredOrganisers.length ? inactiveRegisteredOrganisers.map((organiser) => renderInactiveOrganiserCard(organiser)) : <div className="text-sm text-zinc-500">No inactive registered organisers.</div>}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 p-6">
              <h3 className="text-lg font-semibold text-zinc-900">Not registered yet</h3>
              <p className="mt-2 text-sm text-zinc-600">These organiser records are still pending, so admins can correct the email before the user signs in.</p>
              <div className="mt-4 space-y-3">
                {activePendingOrganisers.length ? activePendingOrganisers.map((organiser) => renderOrganiserCard(organiser)) : <div className="text-sm text-zinc-500">No pending organisers.</div>}
              </div>

              <div className="mt-8">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Inactive</h4>
                <div className="mt-3 space-y-3">
                  {inactivePendingOrganisers.length ? inactivePendingOrganisers.map((organiser) => renderInactiveOrganiserCard(organiser)) : <div className="text-sm text-zinc-500">No inactive pending organisers.</div>}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
