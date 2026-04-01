"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { SKILL_LEVEL_OPTIONS, type SkillLevel } from "@/lib/skill-levels";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
};

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserProfile["role"] | "">("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/");
        return;
      }

      const [userSnapshot, playerSnapshot] = await Promise.all([
        getDoc(doc(db, "users", user.uid)),
        getDoc(doc(db, "players", user.uid)),
      ]);

      if (!userSnapshot.exists()) {
        router.push("/");
        return;
      }

      const userData = userSnapshot.data() as UserProfile;
      setName(userData.displayName || "");
      setEmail(userData.email || "");
      setRole(userData.role);
      setSkillLevel((playerSnapshot.data()?.skillLevel as SkillLevel | undefined) || "");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function handleSave() {
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    setMessage("");

    try {
      await setDoc(doc(db, "users", user.uid), {
        displayName: name,
        email,
        role,
      }, { merge: true });

      if (role === "player") {
        await setDoc(doc(db, "players", user.uid), {
          ownerOrganiserId: null,
          userId: user.uid,
          displayName: name,
          email,
          source: "self-registered",
          skillLevel: skillLevel || null,
        }, { merge: true });
      }

      setMessage("Profile saved.");
    } catch (error) {
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
          <button type="button" onClick={() => router.push('/dashboard')} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100">Back</button>
        </div>

        <div className="mt-8 grid gap-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500" />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Email</span>
            <input value={email} disabled className="w-full rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-zinc-600" />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Role</span>
            <input value={role} disabled className="w-full rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-zinc-600" />
          </label>

          {role === "player" ? (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-700">Skill level</span>
              <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillLevel | "")} className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500">
                <option value="">Not set</option>
                {SKILL_LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
          ) : null}

          {message ? <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700">{message}</div> : null}

          <button type="button" onClick={handleSave} disabled={saving} className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
    </main>
  );
}
