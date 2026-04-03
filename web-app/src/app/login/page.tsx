"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import { getManagedUserByEmail, upsertManagedUser } from "@/lib/managed-users";
import { resolveAuthProfile } from "@/lib/auth-profile";
import { promoteManualPlayerToSelfRegistered } from "@/lib/players";

type AppUserRole = "player" | "organiser" | "admin";

type UserProfile = {
  displayName?: string;
  email?: string;
  role?: AppUserRole;
};

async function upsertPlayerDirectoryEntry(userId: string, name: string, userEmail: string) {
  await setDoc(doc(db, "players", userId), {
    ownerOrganiserId: null,
    userId,
    displayName: name,
    email: userEmail,
    source: "self-registered",
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function ensureUserProfileForAuthUser(user: User, fallbackDisplayName?: string) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  const existing = snapshot.data() as UserProfile | undefined;
  const managedUser = user.email ? await getManagedUserByEmail(db, user.email) : null;
  const resolved = resolveAuthProfile({
    fallbackDisplayName,
    authDisplayName: user.displayName,
    authEmail: user.email,
    existing,
    managedUser,
  });

  await setDoc(userRef, {
    displayName: resolved.displayName,
    email: resolved.email,
    role: resolved.role,
    status: resolved.status,
    createdAt: snapshot.exists() ? snapshot.data()?.createdAt || serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  if (managedUser?.id) {
    await setDoc(doc(db, "managedUsers", managedUser.id), {
      userId: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  if (resolved.role === "player" || resolved.role === "organiser") {
    await upsertManagedUser(db, {
      id: managedUser?.id,
      email: resolved.email,
      displayName: resolved.displayName,
      role: resolved.role,
      status: resolved.status,
      userId: user.uid,
    });
  }

  if (resolved.role === "player") {
    await promoteManualPlayerToSelfRegistered(db, user.uid, resolved.email, resolved.displayName);
    await upsertPlayerDirectoryEntry(user.uid, resolved.displayName, resolved.email);
  }

  return { displayName: resolved.displayName, email: resolved.email, role: resolved.role };
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (mode === "register") {
        const credentials = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );

        const name = displayName.trim() || credentials.user.email || "Player";
        await ensureUserProfileForAuthUser(credentials.user, name);
      } else {
        const credentials = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserProfileForAuthUser(credentials.user);
      }

      router.push("/dashboard");
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError("");

    try {
      const credentials = await signInWithPopup(auth, googleProvider);
      await ensureUserProfileForAuthUser(credentials.user);
      router.push("/dashboard");
    } catch (signInError) {
      if (signInError instanceof Error) {
        setError(signInError.message);
      } else {
        setError("Google sign-in failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          {mode === "login" ? "Login" : "Register"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-700">
                Display name
              </span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
                placeholder="Your name"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
          </label>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-4">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="w-full rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Google
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
          className="mt-6 text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
