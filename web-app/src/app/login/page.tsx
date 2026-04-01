"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getRoleForEmail } from "@/lib/roles";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const rolePreview = useMemo(() => getRoleForEmail(email), [email]);

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

        const role = getRoleForEmail(credentials.user.email);
        const name = displayName.trim() || credentials.user.email || "Player";

        await setDoc(doc(db, "users", credentials.user.uid), {
          displayName: name,
          email: credentials.user.email,
          role,
          createdAt: serverTimestamp(),
        });

        if (role === "player") {
          await upsertPlayerDirectoryEntry(
            credentials.user.uid,
            name,
            credentials.user.email || "",
          );
        }
      } else {
        const credentials = await signInWithEmailAndPassword(auth, email, password);
        const snapshot = await getDoc(doc(db, "users", credentials.user.uid));

        if (!snapshot.exists()) {
          const role = getRoleForEmail(credentials.user.email);
          const name = credentials.user.email || "Player";
          await setDoc(doc(db, "users", credentials.user.uid), {
            displayName: name,
            email: credentials.user.email,
            role,
            createdAt: serverTimestamp(),
          });
        }

        const userSnapshot = await getDoc(doc(db, "users", credentials.user.uid));
        const userData = userSnapshot.data() as { displayName?: string; email?: string; role?: "player" | "organiser" | "admin" } | undefined;
        if (userData?.role === "player") {
          await upsertPlayerDirectoryEntry(
            credentials.user.uid,
            userData?.displayName || credentials.user.email || "Player",
            userData?.email || credentials.user.email || "",
          );
        }
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

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          {mode === "login" ? "Login" : "Register"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-4 text-zinc-600">
          Email/password only for MVP. Roles are assigned automatically by email:
          player, organiser, or admin.
        </p>

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

          <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700">
            Role preview for this email: <strong>{rolePreview}</strong>
          </div>

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
