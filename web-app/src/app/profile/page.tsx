"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithPopup,
  reload,
  type User,
  verifyBeforeUpdateEmail,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import { getManagedUserByEmail, normalizeEmail, upsertManagedUser } from "@/lib/managed-users";
import {
  clearPendingEmailChange,
  readPendingEmailChange,
  rememberPendingEmailChange,
  syncProfileEmailChange,
} from "@/lib/profile-email-change";
import { getDataPartitionForEmail, resolveDataPartition, type DataPartition } from "@/lib/data-partition";
import { SKILL_LEVEL_OPTIONS, type SkillLevel } from "@/lib/skill-levels";
import { getGamesPlayedByOrganiserForPlayer, type OrganiserGameCount } from "@/lib/player-stats";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  dataPartition?: DataPartition;
};

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [role, setRole] = useState<UserProfile["role"]>("player");
  const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
  const [gamesPlayedByOrganiser, setGamesPlayedByOrganiser] = useState<OrganiserGameCount[]>([]);
  const [message, setMessage] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [refreshingProfile, setRefreshingProfile] = useState(false);

  function hasPasswordProvider(user: User) {
    return user.providerData.some((provider) => provider.providerId === "password");
  }

  function hasGoogleProvider(user: User) {
    return user.providerData.some((provider) => provider.providerId === "google.com");
  }

  function buildTemporaryPassword() {
    return `Temp-${crypto.randomUUID()}-Aa1!`;
  }

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

        await reload(user);
        const refreshedUser = auth.currentUser || user;
        setCurrentUser(user);

        const userSnapshot = await getDoc(doc(db, "users", refreshedUser.uid));

        console.log("[profile] firestore snapshots", {
          uid: refreshedUser.uid,
          userExists: userSnapshot.exists(),
        });

        let userData: UserProfile;
        if (!userSnapshot.exists()) {
          const managedUser = refreshedUser.email ? await getManagedUserByEmail(db, refreshedUser.email) : null;
          console.warn("[profile] users/{uid} missing, rebuilding from managed/auth data", {
            uid: refreshedUser.uid,
            managedRole: managedUser?.role || null,
            managedEmail: managedUser?.email || null,
          });

          userData = {
            displayName: managedUser?.displayName || refreshedUser.displayName || refreshedUser.email || "",
            email: managedUser?.email || refreshedUser.email || "",
            role: managedUser?.role || "player",
            dataPartition: getDataPartitionForEmail(managedUser?.email || refreshedUser.email || ""),
          };

          await setDoc(doc(db, "users", refreshedUser.uid), {
            displayName: userData.displayName,
            email: userData.email,
            role: userData.role,
            status: "active",
            dataPartition: userData.dataPartition,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
        } else {
          userData = userSnapshot.data() as UserProfile;
        }

        const normalizedAuthEmail = normalizeEmail(refreshedUser.email || "");
        const normalizedStoredEmail = normalizeEmail(userData.email || "");
        const pendingChange = readPendingEmailChange();

        if (normalizedAuthEmail && normalizedAuthEmail !== normalizedStoredEmail) {
          const idToken = await refreshedUser.getIdToken(true);
          const synced = await syncProfileEmailChange({
            idToken,
            previousEmail: pendingChange?.previousEmail || normalizedStoredEmail,
            nextEmail: normalizedAuthEmail,
          });
          userData.email = synced.email;
          clearPendingEmailChange();
          setMessage("Email change verified and synced.");
        }

        if (cancelled) return;

        const playerSnapshot = userData.role === "player"
          ? await getDoc(doc(db, "players", refreshedUser.uid))
          : null;
        const nextSkillLevel = userData.role === "player"
          ? (playerSnapshot?.data()?.skillLevel as SkillLevel | undefined) || ""
          : "";

        setName(userData.displayName || "");
        setEmail(userData.email || refreshedUser.email || "");
        setRole(userData.role);
        setSkillLevel(nextSkillLevel);
        setGamesPlayedByOrganiser(
          userData.role === "player"
            ? await getGamesPlayedByOrganiserForPlayer(
              db,
              user.uid,
              resolveDataPartition(userData.email || refreshedUser.email || "", userData.dataPartition || "live"),
            )
            : [],
        );

        console.log("[profile] load success", {
          uid: refreshedUser.uid,
          role: userData.role,
          email: userData.email || refreshedUser.email || "",
          skillLevel: nextSkillLevel,
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

  async function refreshProfileState() {
    setRefreshingProfile(true);
    try {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) {
        setMessage("You are no longer signed in.");
        return;
      }
      await reload(user);
      router.refresh();
    } finally {
      setRefreshingProfile(false);
    }
  }

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
      const normalizedCurrentEmail = normalizeEmail(email);

      console.log("[profile] save start", {
        uid: user.uid,
        currentEmail: normalizedCurrentEmail,
        role,
        skillLevel,
      });

      if (!trimmedName) {
        throw new Error("Display name is required.");
      }

      if (!normalizedCurrentEmail) {
        throw new Error("Email is required.");
      }

      await setDoc(doc(db, "users", user.uid), {
        displayName: trimmedName,
        email: normalizedCurrentEmail,
        role,
        dataPartition: getDataPartitionForEmail(normalizedCurrentEmail),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (role === "player") {
        await setDoc(doc(db, "players", user.uid), {
          ownerOrganiserId: null,
          userId: user.uid,
          displayName: trimmedName,
          email: normalizedCurrentEmail,
          dataPartition: getDataPartitionForEmail(normalizedCurrentEmail),
          source: "self-registered",
          skillLevel: skillLevel || null,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      const existingManaged = await getManagedUserByEmail(db, normalizedCurrentEmail);
      if (role === "player" || role === "organiser") {
        await upsertManagedUser(db, {
          id: existingManaged?.id,
          email: normalizedCurrentEmail,
          displayName: trimmedName,
          role,
          status: "active",
          userId: user.uid,
        });
      }

      setCurrentUser(auth.currentUser);
      setName(trimmedName);
      setEmail(normalizedCurrentEmail);
      setMessage("Profile saved.");
      console.log("[profile] save success");
    } catch (error) {
      console.error("[profile] save failed", error);
      setMessage(error instanceof Error ? error.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEmailChange() {
    const user = currentUser || auth.currentUser;
    if (!user) {
      setMessage("You are no longer signed in.");
      return;
    }

    const normalizedCurrentEmail = normalizeEmail(email);
    const normalizedNextEmail = normalizeEmail(pendingEmail);
    if (!normalizedNextEmail) {
      setMessage("Enter the new email address first.");
      return;
    }

    if (normalizedCurrentEmail === normalizedNextEmail) {
      setMessage("Enter a different email address to start the change.");
      return;
    }

    setChangingEmail(true);
    setMessage("");

    try {
      if (!hasPasswordProvider(user) && hasGoogleProvider(user)) {
        await reauthenticateWithPopup(user, googleProvider);
        await linkWithCredential(
          user,
          EmailAuthProvider.credential(normalizedNextEmail, buildTemporaryPassword()),
        );
      }

      await verifyBeforeUpdateEmail(user, normalizedNextEmail);
      rememberPendingEmailChange({
        previousEmail: normalizedCurrentEmail,
        nextEmail: normalizedNextEmail,
      });
      setPendingEmail("");
      setMessage(
        hasPasswordProvider(user)
          ? "Verification link sent to the new email address. After opening it, come back here and refresh your profile."
          : "Verification link sent to the new email address. After confirming it, this account will use email/password sign-in. Then use Forgot password on login to set your password.",
      );
    } catch (error) {
      console.error("[profile] email change failed", error);
      setMessage(error instanceof Error ? error.message : "Failed to start email change.");
    } finally {
      setChangingEmail(false);
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
            <input type="email" value={email} disabled className="w-full rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-zinc-600" />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Role</span>
            <input value={role} disabled className="w-full rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-zinc-600" />
          </label>

          <div className="rounded-2xl border border-zinc-200 p-4">
            <h2 className="text-base font-semibold text-zinc-900">Change email address</h2>
            <p className="mt-1 text-sm text-zinc-500">We will send a verification link to the new email address before the change is applied.</p>
            {!currentUser || hasPasswordProvider(currentUser) ? null : (
              <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                This account currently uses SSO. After you verify the new email, the account will switch to email/password sign-in. Then use Forgot password on the login page to set your password.
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="email"
                value={pendingEmail}
                onChange={(event) => setPendingEmail(event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
                placeholder="new-email@example.com"
              />
              <button
                type="button"
                onClick={handleEmailChange}
                disabled={changingEmail}
                className="rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {changingEmail ? "Sending..." : "Change email"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void refreshProfileState()}
              disabled={refreshingProfile}
              className="mt-3 text-sm font-medium text-zinc-600 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshingProfile ? "Refreshing..." : "Refresh email status after verifying"}
            </button>
          </div>

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
