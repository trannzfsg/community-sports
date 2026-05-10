"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  signInWithPopup,
  reload,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import { getDataPartitionForEmail, shouldBypassEmailVerification } from "@/lib/data-partition";
import { getManagedUserByEmail } from "@/lib/managed-users";
import { SUCCESS_ALERT_CLASS_NAME } from "@/lib/alert-styles";
import { linkRegisteredUserData } from "@/lib/account-link";
import { resolveAuthProfile } from "@/lib/auth-profile";
import { clearLoginNotice, readLoginNotice } from "@/lib/login-notices";
import { shouldSyncSelfRegisteredPlayerDirectoryEntry } from "@/lib/player-directory-sync";
import { lookupPendingUserProfile } from "@/lib/pending-user-lookup";
import { lookupPasswordResetEligibility } from "@/lib/password-reset";
import { syncProfileEmailChange } from "@/lib/profile-email-change";
import {
  migrateManualPlayersToSelfRegistered,
  promoteManualPlayerToSelfRegistered,
  removeSelfRegisteredPlayerDirectoryEntry,
  upsertSelfRegisteredPlayerDirectoryEntry,
} from "@/lib/players";

type AppUserRole = "player" | "organiser" | "admin";

type UserProfile = {
  displayName?: string;
  email?: string;
  role?: AppUserRole;
};

function requiresVerifiedEmail(user: User) {
  return user.providerData.some((provider) => provider.providerId === "password")
    && !shouldBypassEmailVerification(user.email || "");
}

function buildVerificationSendKey(email: string) {
  return `verification-email-sent:${email.trim().toLowerCase()}`;
}

const REGISTER_NOTICE_KEY = "post-register-verification-notice";
const REGISTER_NOTICE_MESSAGE = "Registration successful. We sent a verification email. Open the link in your inbox or junk/spam folder, then sign in to finish setup.";

function rememberVerificationEmailSent(email: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(buildVerificationSendKey(email), String(Date.now()));
}

function sentVerificationRecently(email: string) {
  if (typeof window === "undefined") return false;
  const value = window.localStorage.getItem(buildVerificationSendKey(email));
  if (!value) return false;
  const lastSent = Number(value);
  return Number.isFinite(lastSent) && Date.now() - lastSent < 60_000;
}

function rememberRegisterNotice(message: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REGISTER_NOTICE_KEY, message);
}

function readRegisterNotice() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(REGISTER_NOTICE_KEY) || "";
}

function clearRegisterNotice() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REGISTER_NOTICE_KEY);
}

async function ensureUserProfileForAuthUser(user: User, fallbackDisplayName?: string) {
  console.log("[auth] ensureUserProfileForAuthUser start", { uid: user.uid, email: user.email });

  let linkedRegisteredData = false;
  try {
    const idToken = await user.getIdToken(true);
    const linked = await linkRegisteredUserData(idToken);
    linkedRegisteredData = true;
    console.log("[auth] linkRegisteredUserData result", {
      uid: linked.uid,
      email: linked.email,
      role: linked.role,
      status: linked.status,
    });
    await user.reload();
  } catch (linkError) {
    console.warn("[auth] linkRegisteredUserData failed", linkError);
  }

  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  const existing = snapshot.data() as UserProfile | undefined;
  console.log("[auth] existing users/{uid} doc", { exists: snapshot.exists(), role: existing?.role });

  const normalizedAuthEmail = (user.email || "").trim().toLowerCase();
  const normalizedExistingEmail = (existing?.email || "").trim().toLowerCase();
  if (snapshot.exists() && normalizedAuthEmail && normalizedExistingEmail && normalizedAuthEmail !== normalizedExistingEmail) {
    try {
      const idToken = await user.getIdToken(true);
      await syncProfileEmailChange({
        idToken,
        previousEmail: normalizedExistingEmail,
        nextEmail: normalizedAuthEmail,
      });
      console.log("[auth] synced changed auth email back into Firestore profile");
    } catch (syncError) {
      console.error("[auth] profile email sync before ensureUserProfileForAuthUser failed", syncError);
    }
  }

  const shouldLookupManagedUser = !snapshot.exists();
  let managedUser = shouldLookupManagedUser && user.email ? await getManagedUserByEmail(db, user.email) : null;
  if (shouldLookupManagedUser && !managedUser) {
    try {
      const pendingUser = await lookupPendingUserProfile(await user.getIdToken());
      if (pendingUser.email && pendingUser.role) {
        managedUser = {
          id: pendingUser.email,
          email: pendingUser.email,
          displayName: pendingUser.displayName || pendingUser.email,
          role: pendingUser.role,
          status: pendingUser.status || "active",
          userId: user.uid,
          isPending: true,
        };
      }
    } catch (lookupError) {
      console.warn("[auth] pending user lookup fallback failed", lookupError);
    }
  }
  console.log("[auth] managed user (email-keyed pending doc)", { found: !!managedUser, role: managedUser?.role });

  const resolved = resolveAuthProfile({
    fallbackDisplayName,
    authDisplayName: user.displayName,
    authEmail: user.email,
    existing,
    managedUser,
  });
  console.log("[auth] resolved profile", { role: resolved.role, status: resolved.status });

  await setDoc(userRef, {
    displayName: resolved.displayName,
    email: resolved.email,
    role: resolved.role,
    status: resolved.status,
    dataPartition: getDataPartitionForEmail(resolved.email),
    createdAt: snapshot.exists() ? snapshot.data()?.createdAt || serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  console.log("[auth] users/{uid} written with role:", resolved.role);

  if (shouldSyncSelfRegisteredPlayerDirectoryEntry(resolved.role)) {
    if (!linkedRegisteredData) {
      await migrateManualPlayersToSelfRegistered(db, user.uid, resolved.email, resolved.displayName);
      await promoteManualPlayerToSelfRegistered(db, user.uid, resolved.email, resolved.displayName);
    }
    await upsertSelfRegisteredPlayerDirectoryEntry(db, user.uid, resolved.email, resolved.displayName);
    console.log("[auth] player directory updated");
  } else if (resolved.role === "admin") {
    const removed = await removeSelfRegisteredPlayerDirectoryEntry(db, user.uid);
    console.log("[auth] admin player directory cleanup", { removed });
  }

  console.log("[auth] ensureUserProfileForAuthUser complete", { role: resolved.role });
  return { displayName: resolved.displayName, email: resolved.email, role: resolved.role };
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("registered") === "1") {
        rememberRegisterNotice(REGISTER_NOTICE_MESSAGE);
        setNotice(REGISTER_NOTICE_MESSAGE);
        return;
      }

      if (params.get("emailChanged") === "1") {
        setNotice(readLoginNotice() || "Email changed. Sign in again with your new email address.");
        return;
      }
    }

    const rememberedNotice = readRegisterNotice() || readLoginNotice();
    if (rememberedNotice) {
      setNotice(rememberedNotice);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (mode === "register") {
        const credentials = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );

        if (shouldBypassEmailVerification(credentials.user.email || email)) {
          await ensureUserProfileForAuthUser(credentials.user, displayName);
          router.push("/dashboard");
          return;
        }

        await sendEmailVerification(credentials.user);
        rememberVerificationEmailSent(credentials.user.email || email);
        await signOut(auth);
        setMode("login");
        setDisplayName("");
        setEmail("");
        setPassword("");
        const nextNotice = REGISTER_NOTICE_MESSAGE;
        rememberRegisterNotice(nextNotice);
        setNotice(nextNotice);
        router.replace("/login?registered=1");
      } else {
        const credentials = await signInWithEmailAndPassword(auth, email, password);
        await reload(credentials.user);
        const existingProfileSnapshot = await getDoc(doc(db, "users", credentials.user.uid));
        if (requiresVerifiedEmail(credentials.user) && !credentials.user.emailVerified && !existingProfileSnapshot.exists()) {
          if (!sentVerificationRecently(credentials.user.email || email)) {
            await sendEmailVerification(credentials.user);
            rememberVerificationEmailSent(credentials.user.email || email);
          }
          await signOut(auth);
          rememberRegisterNotice(REGISTER_NOTICE_MESSAGE);
          setNotice("Please verify your email before signing in. Check your inbox or junk/spam folder for the verification link we already sent.");
          router.replace("/login?registered=1");
          return;
        }
        await ensureUserProfileForAuthUser(credentials.user);
        clearRegisterNotice();
        clearLoginNotice();
        setNotice("");
        router.push("/dashboard");
        return;
      }
    } catch (submitError) {
      const invalidCredentials =
        typeof submitError === "object"
        && submitError !== null
        && "code" in submitError
        && (submitError as { code?: string }).code === "auth/invalid-credential";

      if (invalidCredentials) {
        setError("Invalid email or password");
      } else if (submitError instanceof Error) {
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
    setNotice("");

    try {
      const credentials = await signInWithPopup(auth, googleProvider);
      await ensureUserProfileForAuthUser(credentials.user);
      clearRegisterNotice();
      clearLoginNotice();
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

  async function handleForgotPassword() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Enter your email address first so we can send the reset link.");
      setNotice("");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const eligibility = await lookupPasswordResetEligibility(normalizedEmail);

      if (!eligibility.canReset) {
        setError(eligibility.blockMessage || "Password reset is not available for this account.");
        return;
      }

      await sendPasswordResetEmail(auth, normalizedEmail);
      setNotice("If this email uses password sign-in, a password reset link has been sent.");
    } catch (resetError) {
      if (resetError instanceof Error) {
        setError(resetError.message);
      } else {
        setError("We couldn't start password reset. Please try again.");
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
        {mode === "register" ? (
          <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            All self-registrations will be created as <strong>player</strong>. If an admin pre-created you as an organiser, you must register with that exact email address or the account will still be created as a player.
          </div>
        ) : null}

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

          {mode === "login" ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleForgotPassword()}
                disabled={busy}
                className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                Forgot password?
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className={SUCCESS_ALERT_CLASS_NAME}>
              {notice}
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
