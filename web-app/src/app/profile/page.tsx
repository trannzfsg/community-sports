"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateEmail, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getManagedUserByEmail, normalizeEmail, upsertManagedUser } from "@/lib/managed-users";
import { SKILL_LEVEL_OPTIONS, type SkillLevel } from "@/lib/skill-levels";
import { getGamesPlayedByOrganiserForPlayer, type OrganiserGameCount } from "@/lib/player-stats";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
};

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserProfile["role"]>("player");
  const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
  const [gamesPlayedByOrganiser, setGamesPlayedByOrganiser] = useState<OrganiserGameCount[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      console.log("[profile] load start", {
        route: typeof window !== "undefined" ? window.location.pathname : "server",
        currentUserAtStart: auth.currentUser?.uid || null,
      });

      setLoading(true);
      setMessage("");

      try {
        await auth.authStateReady();
        if (cancelled) return;

        const user = auth.currentUser;
        console.log("[profile] auth ready", {
          uid: user?.uid || null,
          email: user?.email || null,
        });

        if (!user) {
          console.warn("[profile] no auth user after authStateReady, redirecting to /");
          router.replace("/");
          return;
        }

        setCurrentUser(user);

        const [userSnapshot, playerSnapshot] = await Promise.all([
          getDoc(doc(db, "users", user.uid)),
          getDoc(doc(db, "players", user.uid)),
        ]);

        console.log("[profile] firestore snapshots", {
          uid: user.uid,
          userExists: userSnapshot.exists(),
          playerExists: playerSnapshot.exists(),
        });

        let userData: UserProfile;
        if (!userSnapshot.exists()) {
          const managedUser = user.email ? await getManagedUserByEmail(db, user.email) : null;
          console.warn("[profile] users/{uid} missing, rebuilding from managed/auth data", {
            uid: user.uid,
            managedRole: managedUser?.role || null,
            managedEmail: managedUser?.email || null,
          });

          userData = {
            displayName: managedUser?.displayName || user.displayName || user.email || "",
            email: managedUser?.email || user.email || "",
            role: managedUser?.role || "player",
          };

          await setDoc(doc(db, "users", user.uid), {
            displayName: userData.displayName,
            email: userData.email,
            role: userData.role,
            status: "active",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
        } else {
          userData = userSnapshot.data() as UserProfile;
        }

        if (cancelled) return;

        setName(userData.displayName || "");
        setEmail(userData.email || user.email || "");
        setRole(userData.role);
        setSkillLevel((playerSnapshot.data()?.skillLevel as SkillLevel | undefined) || "");
        setGamesPlayedByOrganiser(
          userData.role === "player"
            ? await getGamesPlayedByOrganiserForPlayer(db, user.uid)
            : [],
        );

        console.log("[profile] load success", {
          uid: user.uid,
          role: userData.role,
          email: userData.email || user.email || "",
          skillLevel: (playerSnapshot.data()?.skillLevel as SkillLevel | undefined) || "",
        });
      } catch (error) {
        if (cancelled) return;
        console.error("[profile] load failed", error);
        setMessage(error instanceof Error ? error.message : "Failed to load profile.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          console.log("[profile] load end");
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
      console.log("[profile] effect cleanup");
    };
  }, [router]);

  async function handleSave() {
    const user = currentUser || auth.currentUser;
    if (!user) {
      setMessage("You are no longer signed in.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const trimmedName = name.trim();
      const normalizedNextEmail = normalizeEmail(email);
      const normalizedCurrentAuthEmail = normalizeEmail(user.email || "");

      console.log("[profile] save start", {
        uid: user.uid,
        currentEmail: normalizedCurrentAuthEmail,
        nextEmail: normalizedNextEmail,
        role,
        skillLevel,
      });

      if (!trimmedName) {
        throw new Error("Display name is required.");
      }

      if (!normalizedNextEmail) {
        throw new Error("Email is required.");
      }

      const existingManaged = await getManagedUserByEmail(db, normalizedNextEmail);
      if (existingManaged && existingManaged.userId && existingManaged.userId !== user.uid) {
        throw new Error("Another user already uses this email.");
      }

      if (normalizedNextEmail !== normalizedCurrentAuthEmail) {
        console.log("[profile] updating auth email");
        await updateEmail(user, normalizedNextEmail);
      }

      await setDoc(doc(db, "users", user.uid), {
        displayName: trimmedName,
        email: normalizedNextEmail,
        role,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (role === "player") {
        await setDoc(doc(db, "players", user.uid), {
          ownerOrganiserId: null,
          userId: user.uid,
          displayName: trimmedName,
          email: normalizedNextEmail,
          source: "self-registered",
          skillLevel: skillLevel || null,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      if (role === "player" || role === "organiser") {
        await upsertManagedUser(db, {
          email: normalizedNextEmail,
          displayName: trimmedName,
          role,
          status: "active",
          userId: user.uid,
        });
      }

      setCurrentUser(auth.currentUser);
      setName(trimmedName);
      setEmail(normalizedNextEmail);
      setMessage("Profile saved.");
      console.log("[profile] save success");
    } catch (error) {
      console.error("[profile] save failed", error);
      setMessage(error instanceof Error ? error.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">Loading profile...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Profile</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your details</h1>
          </div>
          <button type="button" onClick={() => router.push("/dashboard")} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100">Back</button>
        </div>

        <div className="mt-8 grid gap-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Display name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Role</span>
            <input value={role} disabled className="w-full rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-zinc-600" />
          </label>

          {role === "player" ? (
            <>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-zinc-700">Skill level</span>
                <select value={skillLevel} onChange={(event) => setSkillLevel(event.target.value as SkillLevel | "")} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
                  <option value="">Not set</option>
                  {SKILL_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-zinc-200 p-4">
                <h2 className="text-base font-semibold text-zinc-900">Games played by organiser</h2>
                <p className="mt-1 text-sm text-zinc-500">Counts include confirmed, non-waiting registrations only.</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">Organiser</th>
                        <th className="pb-2 font-medium">Games played</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamesPlayedByOrganiser.length ? gamesPlayedByOrganiser.map((entry) => (
                        <tr key={entry.organiserId} className="border-t border-zinc-100">
                          <td className="py-2 pr-4 text-zinc-900">{entry.organiserName}</td>
                          <td className="py-2 text-zinc-700">{entry.gamesPlayed}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={2} className="py-2 text-zinc-500">No confirmed games yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {message ? <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700">{message}</div> : null}

          <button type="button" onClick={handleSave} disabled={saving} className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </div>
    </main>
  );
}
