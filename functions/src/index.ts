import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import type {Request, Response} from "express";
import {createHmac, timingSafeEqual} from "node:crypto";
import {EMAIL_NOTIFICATIONS_ENABLED} from "./feature-flags.js";

setGlobalOptions({maxInstances: 10});

const adminApp = getApps().length ? getApps()[0] : initializeApp();
const firestore = getFirestore(adminApp);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3100",
  "http://localhost:3102",
  "https://community-sports-6584e.firebaseapp.com",
  "https://community-sports-6584e.web.app",
  "https://sports.tranzha.com",
]);
const STRIPE_API_VERSION = "2026-02-25.clover";
const DEFAULT_PLATFORM_FEE_BPS = 200;
const DEFAULT_STRIPE_PROCESSING_FEE_BPS = 170;
const DEFAULT_STRIPE_PROCESSING_FEE_FIXED_CENTS = 30;

/**
 * Applies CORS headers for the supported frontend origins.
 * @param {Request} request
 * @param {Response} response
 */
function applyCors(request: Request, response: Response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
  }
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Normalizes an email address for consistent storage and partition checks.
 * @param {string} email
 * @return {string}
 */
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Builds the canonical registration document id for event/user.
 * Must stay in sync with web-app/src/lib/session-series.ts.
 * @param {string} eventId
 * @param {string} userId
 * @return {string}
 */
function buildRegistrationId(eventId: string, userId: string) {
  const encodedUserId = encodeURIComponent(userId).replace(/%/g, "_");
  return `${eventId}__${encodedUserId}`;
}

/**
 * Returns role priority for canonical role resolution.
 * @param {unknown} role
 * @return {number}
 */
function roleRank(role: unknown) {
  if (role === "admin") return 3;
  if (role === "organiser") return 2;
  if (role === "player") return 1;
  return 0;
}

/**
 * Resolves the logical data partition for the supplied email address.
 * @param {string} email
 * @return {"test"|"live"}
 */
function getDataPartitionForEmail(email: string) {
  return normalizeEmail(email).endsWith("@example.com") ? "test" : "live";
}

/**
 * Checks whether a Stripe return URL points back to a known frontend origin.
 * @param {string} returnUrl
 * @return {boolean}
 */
function returnUrlIsAllowed(returnUrl: string) {
  try {
    const parsed = new URL(returnUrl);
    return allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * Reads a required Stripe environment variable.
 * @param {string} name
 * @return {string}
 */
function requireStripeSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

/**
 * Calls the Stripe REST API with form-encoded data.
 * @param {string} path
 * @param {URLSearchParams} body
 */
async function stripeRequest<T>(
  path: string,
  body: URLSearchParams,
): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${requireStripeSecret("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
    body,
  });
  const payload = await response.json().catch(() => null) as
    | (T & {error?: {message?: string}})
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Stripe request failed.");
  }
  if (!payload) {
    throw new Error("Stripe returned an empty response.");
  }
  return payload;
}

/**
 * Reads the raw request body used by Stripe webhook signature checks.
 * @param {Request} request
 * @return {Buffer}
 */
function getRawBody(request: Request) {
  const candidate = (request as Request & {rawBody?: Buffer}).rawBody;
  if (Buffer.isBuffer(candidate)) {
    return candidate;
  }
  return Buffer.from(JSON.stringify(request.body || {}));
}

/**
 * Verifies and parses a Stripe webhook event.
 * @param {Request} request
 * @return {StripeEvent}
 */
function verifyStripeSignature(request: Request) {
  const webhookSecret = requireStripeSecret("STRIPE_BILLING_WEBHOOK_SECRET");
  const signatureHeader = request.headers["stripe-signature"];
  if (typeof signatureHeader !== "string") {
    throw new Error("Missing Stripe signature.");
  }

  const timestamp = signatureHeader.match(/(?:^|,)t=([^,]+)/)?.[1];
  const signatures = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe signature.");
  }

  const payload = getRawBody(request);
  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`),
    payload,
  ]);
  const expected = createHmac("sha256", webhookSecret)
    .update(signedPayload)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  const matches = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer);
  });
  if (!matches) {
    throw new Error("Stripe signature verification failed.");
  }

  return JSON.parse(payload.toString("utf8")) as StripeEvent;
}

type StripeCheckoutSession = {
  id?: string;
  url?: string;
  payment_status?: string;
  payment_intent?: string;
  metadata?: Record<string, string | undefined>;
};

type StripePortalSession = {
  url?: string;
};

type StripeCustomer = {
  id: string;
};

type StripeConnectAccount = {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    currently_due?: string[];
    disabled_reason?: string | null;
  };
};

type StripeConnectAccountLink = {
  url?: string;
};

type StripeSubscription = {
  id: string;
  customer?: string;
  status?: string;
  current_period_end?: number;
};

type StripeEvent = {
  type?: string;
  data?: {
    object?: StripeSubscription | StripeCheckoutSession;
  };
};

/**
 * Reads an integer environment value with a safe default.
 * @param {string} name
 * @param {number} fallback
 * @return {number}
 */
function readIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Converts a dollar amount to currency minor units.
 * @param {number} amount
 * @return {number}
 */
function dollarsToCents(amount: number) {
  return Math.round(amount * 100);
}

/**
 * Calculates player-paid fee recovery for online checkout.
 * @param {number} organiserAmountCents
 * @return {{
 *   organiserAmountCents: number,
 *   platformFeeCents: number,
 *   stripeFeeRecoveryCents: number,
 *   playerTotalCents: number,
 * }}
 */
function calculateOnlinePaymentFeeBreakdown(organiserAmountCents: number) {
  const platformFeeBps = readIntegerEnv(
    "STRIPE_PLATFORM_FEE_BPS",
    DEFAULT_PLATFORM_FEE_BPS,
  );
  const stripeFeeBps = readIntegerEnv(
    "STRIPE_PROCESSING_FEE_BPS",
    DEFAULT_STRIPE_PROCESSING_FEE_BPS,
  );
  const stripeFixedFeeCents = readIntegerEnv(
    "STRIPE_PROCESSING_FEE_FIXED_CENTS",
    DEFAULT_STRIPE_PROCESSING_FEE_FIXED_CENTS,
  );
  const platformFeeCents = Math.ceil(
    (organiserAmountCents * platformFeeBps) / 10000,
  );
  const subtotalCents = organiserAmountCents + platformFeeCents;
  const playerTotalCents = Math.ceil(
    (subtotalCents + stripeFixedFeeCents) / (1 - stripeFeeBps / 10000),
  );
  const stripeFeeRecoveryCents = Math.max(0, playerTotalCents - subtotalCents);

  return {
    organiserAmountCents,
    platformFeeCents,
    stripeFeeRecoveryCents,
    playerTotalCents,
  };
}

/**
 * Calls a Stripe GET endpoint.
 * @param {string} path
 */
async function stripeGetRequest<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${requireStripeSecret("STRIPE_SECRET_KEY")}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
  });
  const payload = await response.json().catch(() => null) as
    | (T & {error?: {message?: string}})
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Stripe request failed.");
  }
  if (!payload) {
    throw new Error("Stripe returned an empty response.");
  }
  return payload;
}

/**
 * Maps a Stripe connected account to the stored user status shape.
 * @param {StripeConnectAccount} account
 * @return {Record<string, unknown>}
 */
function buildStripeConnectStatus(account: StripeConnectAccount) {
  return {
    accountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    disabledReason: account.requirements?.disabled_reason ?? null,
    currentlyDue: account.requirements?.currently_due ?? [],
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Writes the latest Stripe connected account status to a user profile.
 * @param {string} uid
 * @param {StripeConnectAccount} account
 */
async function updateUserStripeConnectStatus(
  uid: string,
  account: StripeConnectAccount,
) {
  const stripeConnect = buildStripeConnectStatus(account);
  await firestore.doc(`users/${uid}`).set({
    stripeConnect,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return stripeConnect;
}

/**
 * Verifies the Bearer token and returns the decoded user identity.
 * @param {Request} request
 */
async function authenticateRequest(request: Request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer (.+)$/);
  if (!match) {
    throw new Error("Missing authorization token.");
  }

  return getAuth(adminApp).verifyIdToken(match[1]);
}

export const health = onRequest((request, response) => {
  logger.info("Health check hit", {method: request.method, path: request.path});
  response.status(200).json({
    ok: true,
    service: "community-sports-functions",
    timestamp: new Date().toISOString(),
  });
});

export const rolesInfo = onRequest((request, response) => {
  response.status(200).json({
    roles: ["player", "organiser", "admin"],
    organiserVisibility:
      "organisers can only manage and view their own sessions/payments",
    adminVisibility: "admins can view everything",
  });
});

export const passwordResetLookup = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  const email =
    typeof request.body?.email === "string" ?
      request.body.email.trim().toLowerCase() :
      "";
  if (!email) {
    response.status(400).json({error: "Email is required."});
    return;
  }

  try {
    const user = await getAuth(adminApp).getUserByEmail(email);
    const providerIds = new Set(
      user.providerData.map((provider) => provider.providerId),
    );

    if (providerIds.has("password")) {
      response.status(200).json({canReset: true});
      return;
    }

    if (providerIds.has("google.com")) {
      response.status(200).json({
        canReset: false,
        blockMessage:
          "This account uses Google sign-in. " +
          "Use Continue with Google instead of password reset.",
      });
      return;
    }

    response.status(200).json({
      canReset: false,
      blockMessage:
        "This account does not use email/password sign-in, " +
        "so password reset is not available.",
    });
  } catch (error) {
    logger.warn("Password reset lookup fallback", {
      email,
      error:
        error instanceof Error ? error.message : String(error),
    });
    response.status(200).json({canReset: true});
  }
});

export const syncUserEmailChange = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const nextEmail = typeof decodedToken.email === "string" ?
      decodedToken.email.trim().toLowerCase() :
      "";
    if (!nextEmail) {
      response.status(400).json({
        error: "Authenticated user email is required.",
      });
      return;
    }

    const userSnapshot = await firestore.doc(`users/${uid}`).get();
    if (!userSnapshot.exists) {
      response.status(404).json({error: "User profile not found."});
      return;
    }

    const userData = userSnapshot.data() || {};
    const role = userData.role;
    const storedEmail = typeof userData.email === "string" ?
      userData.email.trim().toLowerCase() :
      "";
    const previousEmail = typeof request.body?.previousEmail === "string" ?
      request.body.previousEmail.trim().toLowerCase() :
      storedEmail;
    const nextPartition = getDataPartitionForEmail(nextEmail);

    const batch = firestore.batch();
    batch.set(firestore.doc(`users/${uid}`), {
      email: nextEmail,
      dataPartition: nextPartition,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    if (role === "player") {
      batch.set(firestore.doc(`players/${uid}`), {
        email: nextEmail,
        dataPartition: nextPartition,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const [
      registrationSnapshot,
      paymentSnapshot,
      stalePendingSnapshot,
    ] = await Promise.all([
      firestore.collection("registrations").where("userId", "==", uid).get(),
      firestore.collection("payments").where("userId", "==", uid).get(),
      firestore.collection("managedUsers")
        .where("userId", "==", uid)
        .get(),
    ]);

    registrationSnapshot.docs.forEach((registrationDoc) => {
      batch.set(registrationDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: nextPartition,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    paymentSnapshot.docs.forEach((paymentDoc) => {
      batch.set(paymentDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: nextPartition,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    stalePendingSnapshot.docs.forEach((pendingDoc) => {
      if (pendingDoc.id !== nextEmail) {
        batch.delete(pendingDoc.ref);
      }
    });

    if (previousEmail && previousEmail !== nextEmail) {
      const previousPendingRef = firestore.doc(`managedUsers/${previousEmail}`);
      const previousPendingSnapshot = await previousPendingRef.get();
      const previousPendingData = previousPendingSnapshot.data();
      const canDeletePreviousPending =
        previousPendingData?.userId === uid ||
        previousPendingData?.isPending === true;
      if (
        previousPendingSnapshot.exists &&
        previousPendingRef.id !== nextEmail &&
        canDeletePreviousPending
      ) {
        batch.delete(previousPendingRef);
      }
    }

    await batch.commit();

    response.status(200).json({email: nextEmail});
  } catch (error) {
    logger.error("Email sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to sync email change."});
  }
});

export const changeExampleUserEmail = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const currentEmail = typeof decodedToken.email === "string" ?
      normalizeEmail(decodedToken.email) :
      "";
    const nextEmail = typeof request.body?.nextEmail === "string" ?
      normalizeEmail(request.body.nextEmail) :
      "";

    if (!currentEmail || !nextEmail) {
      response.status(400).json({
        error: "Current and next email are required.",
      });
      return;
    }

    if (getDataPartitionForEmail(currentEmail) !== "test" ||
      getDataPartitionForEmail(nextEmail) !== "test") {
      response.status(403).json({
        error: "Direct email change is only allowed for @example.com users.",
      });
      return;
    }

    const userSnapshot = await firestore.doc(`users/${uid}`).get();
    if (!userSnapshot.exists) {
      response.status(404).json({error: "User profile not found."});
      return;
    }

    const userData = userSnapshot.data() || {};
    const role = userData.role;
    await getAuth(adminApp).updateUser(uid, {email: nextEmail});

    const batch = firestore.batch();
    batch.set(firestore.doc(`users/${uid}`), {
      email: nextEmail,
      dataPartition: "test",
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    if (role === "player") {
      batch.set(firestore.doc(`players/${uid}`), {
        email: nextEmail,
        dataPartition: "test",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const [registrationSnapshot, paymentSnapshot, stalePendingSnapshot] =
      await Promise.all([
        firestore.collection("registrations").where("userId", "==", uid).get(),
        firestore.collection("payments").where("userId", "==", uid).get(),
        firestore.collection("managedUsers")
          .where("userId", "==", uid)
          .get(),
      ]);

    registrationSnapshot.docs.forEach((registrationDoc) => {
      batch.set(registrationDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: "test",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    paymentSnapshot.docs.forEach((paymentDoc) => {
      batch.set(paymentDoc.ref, {
        playerEmail: nextEmail,
        dataPartition: "test",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    stalePendingSnapshot.docs.forEach((pendingDoc) => {
      if (pendingDoc.id !== nextEmail) {
        batch.delete(pendingDoc.ref);
      }
    });

    if (currentEmail !== nextEmail) {
      const previousPendingRef = firestore.doc(`managedUsers/${currentEmail}`);
      const previousPendingSnapshot = await previousPendingRef.get();
      if (
        previousPendingSnapshot.exists &&
        previousPendingRef.id !== nextEmail
      ) {
        batch.delete(previousPendingRef);
      }
    }

    await batch.commit();

    response.status(200).json({email: nextEmail});
  } catch (error) {
    logger.error("Direct example email change failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to change example user email."});
  }
});

export const linkRegisteredUserData = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const signedInEmail = typeof decodedToken.email === "string" ?
      normalizeEmail(decodedToken.email) :
      "";
    if (!signedInEmail) {
      response.status(400).json({error: "Authenticated email is required."});
      return;
    }

    const partition = getDataPartitionForEmail(signedInEmail);
    const userRef = firestore.doc(`users/${uid}`);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      response.status(404).json({error: "Registered user profile not found."});
      return;
    }

    const userData = userSnapshot.data() || {};
    const displayName = typeof userData.displayName === "string" &&
      userData.displayName.trim() ?
      userData.displayName.trim() :
      signedInEmail;

    const roleCandidates = [userData.role];
    const statusCandidates = [userData.status];

    const legacyUserIds = new Set<string>();
    legacyUserIds.add(signedInEmail);

    const sameEmailUsersSnapshot = await firestore.collection("users")
      .where("email", "==", signedInEmail)
      .where("dataPartition", "==", partition)
      .get();

    sameEmailUsersSnapshot.docs.forEach((legacyDoc) => {
      if (legacyDoc.id === uid) return;
      const legacyData = legacyDoc.data();
      roleCandidates.push(legacyData.role);
      statusCandidates.push(legacyData.status);
      legacyUserIds.add(legacyDoc.id);
    });

    const managedRef = firestore.doc(`managedUsers/${signedInEmail}`);
    const managedSnapshot = await managedRef.get();
    if (managedSnapshot.exists) {
      const managedData = managedSnapshot.data() || {};
      roleCandidates.push(managedData.role);
      statusCandidates.push(managedData.status);
      if (typeof managedData.userId === "string" &&
        managedData.userId &&
        managedData.userId !== uid) {
        legacyUserIds.add(managedData.userId);
      }
    }

    const preferredRole = roleCandidates
      .filter((value): value is string => typeof value === "string")
      .sort((a, b) => roleRank(b) - roleRank(a))[0] || "player";

    const mergedStatus = statusCandidates.includes("inactive") ?
      "inactive" :
      "active";

    await userRef.set({
      displayName,
      email: signedInEmail,
      role: preferredRole,
      status: mergedStatus,
      dataPartition: partition,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    const legacyIds = Array.from(legacyUserIds)
      .filter((value) => value !== uid);
    const movedStats = {
      sessions: 0,
      events: 0,
      registrations: 0,
      payments: 0,
      players: 0,
      deletedUsers: 0,
      deletedManagedUsers: 0,
    };

    for (const legacyId of legacyIds) {
      const seriesSnapshot = await firestore.collection("sessions")
        .where("organiserId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const seriesDoc of seriesSnapshot.docs) {
        await seriesDoc.ref.set({
          organiserId: uid,
          organiserName: displayName,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        movedStats.sessions += 1;
      }

      const eventSnapshot = await firestore.collection("sessionEvents")
        .where("organiserId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const eventDoc of eventSnapshot.docs) {
        await eventDoc.ref.set({
          organiserId: uid,
          organiserName: displayName,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        movedStats.events += 1;
      }

      const registrationSnapshot = await firestore.collection("registrations")
        .where("userId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const registrationDoc of registrationSnapshot.docs) {
        const registration = registrationDoc.data() || {};
        const eventId = typeof registration.sessionEventId === "string" ?
          registration.sessionEventId :
          "";
        if (!eventId) continue;

        const canonicalId = buildRegistrationId(eventId, uid);
        const canonicalRef = firestore.doc(`registrations/${canonicalId}`);
        if (canonicalId !== registrationDoc.id) {
          const canonicalSnapshot = await canonicalRef.get();
          if (canonicalSnapshot.exists) {
            const canonical = canonicalSnapshot.data() || {};
            await canonicalRef.set({
              playerName: canonical.playerName || displayName,
              playerEmail: signedInEmail,
              userId: uid,
              playerPaid: !!canonical.playerPaid || !!registration.playerPaid,
              organiserPaid:
                !!canonical.organiserPaid || !!registration.organiserPaid,
              status: canonical.status || registration.status || "registered",
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
            await registrationDoc.ref.delete();
          } else {
            await canonicalRef.set({
              ...registration,
              userId: uid,
              playerName: displayName,
              playerEmail: signedInEmail,
              dataPartition: partition,
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
            await registrationDoc.ref.delete();
          }
        } else {
          await registrationDoc.ref.set({
            userId: uid,
            playerName: displayName,
            playerEmail: signedInEmail,
            dataPartition: partition,
            updatedAt: FieldValue.serverTimestamp(),
          }, {merge: true});
        }
        movedStats.registrations += 1;
      }

      const paymentsSnapshot = await firestore.collection("payments")
        .where("userId", "==", legacyId)
        .where("dataPartition", "==", partition)
        .get();
      for (const paymentDoc of paymentsSnapshot.docs) {
        await paymentDoc.ref.set({
          userId: uid,
          playerName: displayName,
          playerEmail: signedInEmail,
          dataPartition: partition,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        movedStats.payments += 1;
      }
    }

    const sameEmailPlayersSnapshot = await firestore.collection("players")
      .where("email", "==", signedInEmail)
      .where("dataPartition", "==", partition)
      .get();

    let inheritedSkillLevel: string | null = null;
    let inheritedStatus = "active";
    let canonicalPlayerHandled = false;
    for (const playerDoc of sameEmailPlayersSnapshot.docs) {
      const player = playerDoc.data() || {};
      if (!inheritedSkillLevel && typeof player.skillLevel === "string") {
        inheritedSkillLevel = player.skillLevel;
      }
      if (player.status === "inactive") {
        inheritedStatus = "inactive";
      }

      if (playerDoc.id === uid) {
        canonicalPlayerHandled = true;
        if (preferredRole === "player") {
          await playerDoc.ref.set({
            ownerOrganiserId: null,
            userId: uid,
            displayName,
            email: signedInEmail,
            dataPartition: partition,
            source: "self-registered",
            status: inheritedStatus,
            skillLevel: inheritedSkillLevel,
            updatedAt: FieldValue.serverTimestamp(),
          }, {merge: true});
        } else {
          await playerDoc.ref.delete();
          movedStats.players += 1;
        }
        continue;
      }

      const legacyPlayerId = playerDoc.id;
      const registrationsSnapshot = await firestore.collection("registrations")
        .where("userId", "==", legacyPlayerId)
        .where("dataPartition", "==", partition)
        .get();
      for (const registrationDoc of registrationsSnapshot.docs) {
        await registrationDoc.ref.set({
          userId: uid,
          playerName: displayName,
          playerEmail: signedInEmail,
          dataPartition: partition,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }

      const legacyPaymentsSnapshot = await firestore.collection("payments")
        .where("userId", "==", legacyPlayerId)
        .where("dataPartition", "==", partition)
        .get();
      for (const paymentDoc of legacyPaymentsSnapshot.docs) {
        await paymentDoc.ref.set({
          userId: uid,
          playerName: displayName,
          playerEmail: signedInEmail,
          dataPartition: partition,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }

      await playerDoc.ref.delete();
      movedStats.players += 1;
    }

    const canonicalPlayerRef = firestore.doc(`players/${uid}`);
    if (preferredRole === "player") {
      await canonicalPlayerRef.set({
        ownerOrganiserId: null,
        userId: uid,
        displayName,
        email: signedInEmail,
        dataPartition: partition,
        source: "self-registered",
        status: inheritedStatus,
        skillLevel: inheritedSkillLevel,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } else if (!canonicalPlayerHandled) {
      const canonicalPlayerSnapshot = await canonicalPlayerRef.get();
      if (canonicalPlayerSnapshot.exists) {
        await canonicalPlayerRef.delete();
        movedStats.players += 1;
      }
    }

    for (const legacyId of legacyIds) {
      const legacyUserRef = firestore.doc(`users/${legacyId}`);
      const legacyUserSnapshot = await legacyUserRef.get();
      if (legacyUserSnapshot.exists) {
        await legacyUserRef.delete();
        movedStats.deletedUsers += 1;
      }

      const legacyManagedRef = firestore.doc(`managedUsers/${legacyId}`);
      const legacyManagedSnapshot = await legacyManagedRef.get();
      if (legacyManagedSnapshot.exists) {
        await legacyManagedRef.delete();
        movedStats.deletedManagedUsers += 1;
      }
    }

    const managedByUidSnapshot = await firestore.collection("managedUsers")
      .where("userId", "==", uid)
      .get();
    for (const managedDoc of managedByUidSnapshot.docs) {
      await managedDoc.ref.delete();
      movedStats.deletedManagedUsers += 1;
    }

    response.status(200).json({
      uid,
      email: signedInEmail,
      role: preferredRole,
      status: mergedStatus,
      movedStats,
    });
  } catch (error) {
    logger.error("Registered user linking failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to link registered user data."});
  }
});

export const lookupPendingUserProfile = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const signedInEmail = typeof decodedToken.email === "string" ?
      decodedToken.email.trim().toLowerCase() :
      "";

    if (!signedInEmail) {
      response.status(400).json({
        error: "Authenticated user email is required.",
      });
      return;
    }

    const pendingSnapshot = await firestore
      .doc(`managedUsers/${signedInEmail}`)
      .get();
    if (!pendingSnapshot.exists) {
      response.status(200).json({});
      return;
    }

    const pendingData = pendingSnapshot.data();
    if (!pendingData?.isPending) {
      response.status(200).json({});
      return;
    }

    response.status(200).json({
      displayName: pendingData.displayName || "",
      email: pendingData.email || signedInEmail,
      role: pendingData.role || "player",
      status: pendingData.status || "active",
    });
  } catch (error) {
    logger.error("Pending user lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({error: "Failed to resolve pending user role."});
  }
});

export const sendNotificationTest = onRequest(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const channel = request.body?.channel === "email" ? "email" : "telegram";
    const [userSnapshot, preferencesSnapshot] = await Promise.all([
      firestore.doc(`users/${uid}`).get(),
      firestore.doc(`notificationPreferences/${uid}`).get(),
    ]);

    if (!userSnapshot.exists) {
      response.status(404).json({error: "User profile not found."});
      return;
    }

    if (!preferencesSnapshot.exists) {
      response.status(400).json({
        error: "Save your notification preferences before sending a test.",
      });
      return;
    }

    const userData = userSnapshot.data() || {};
    const preferences = preferencesSnapshot.data() || {};
    const recipientEmail = typeof userData.email === "string" ?
      userData.email.trim().toLowerCase() :
      "";
    const recipientDisplayName = typeof userData.displayName === "string" &&
      userData.displayName.trim() ?
      userData.displayName.trim() :
      recipientEmail || uid;
    const dataPartition = typeof userData.dataPartition === "string" &&
      userData.dataPartition === "test" ?
      "test" :
      "live";

    if (channel === "telegram") {
      const telegramEnabled = preferences?.telegram?.enabled === true;
      const telegramChatId = typeof preferences?.telegram?.chatId === "string" ?
        preferences.telegram.chatId.trim() :
        "";

      if (!telegramEnabled) {
        response.status(400).json({
          error: "Enable Telegram notifications in Profile first.",
        });
        return;
      }

      if (!telegramChatId) {
        response.status(400).json({
          error: "Telegram chat ID is required before sending a test.",
        });
        return;
      }
    }

    if (channel === "email") {
      if (!EMAIL_NOTIFICATIONS_ENABLED) {
        response.status(403).json({
          error: "Email notifications are currently disabled.",
        });
        return;
      }

      const emailEnabled = preferences?.email?.enabled === true;
      if (!emailEnabled) {
        response.status(400).json({
          error: "Enable email notifications in Profile first.",
        });
        return;
      }

      if (!recipientEmail) {
        response.status(400).json({
          error: "A profile email is required before sending an email test.",
        });
        return;
      }
    }

    const eventId = `manual_test_${channel}_${Date.now()}`;
    await firestore.doc(`notificationEvents/${eventId}`).set({
      title:
        channel === "telegram" ?
          "Community Sports Telegram test" :
          "Community Sports email test",
      body:
        `Hi ${recipientDisplayName}, this is a test ${channel} notification ` +
        "from your Community Sports profile settings.",
      recipientUserId: uid,
      recipientEmail,
      dataPartition,
      sourceCollection: "manual",
      sourceId: eventId,
      idempotencyKey: eventId,
      channels: {
        email: channel === "email",
        telegram: channel === "telegram",
      },
      telegramChatId:
        channel === "telegram" &&
        typeof preferences?.telegram?.chatId === "string" ?
          preferences.telegram.chatId.trim() :
          null,
      telegramChatType: channel === "telegram" ? "private" : null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    response.status(200).json({
      queued: true,
      eventId,
      channel,
    });
  } catch (error) {
    logger.error("Notification test queueing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({
      error: "Failed to queue the test notification.",
    });
  }
});

export const createConnectAccountLink = onRequest(async (
  request,
  response,
) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const returnUrl = typeof request.body?.returnUrl === "string" ?
      request.body.returnUrl :
      "";
    if (!returnUrl) {
      response.status(400).json({error: "Return URL is required."});
      return;
    }
    if (!returnUrlIsAllowed(returnUrl)) {
      response.status(400).json({error: "Return URL is not allowed."});
      return;
    }

    const userRef = firestore.doc(`users/${uid}`);
    const userSnapshot = await userRef.get();
    const userData = userSnapshot.data() || {};
    if (!userSnapshot.exists || userData.role !== "organiser") {
      response.status(403).json({
        error: "Only organisers can set up Stripe Connect.",
      });
      return;
    }

    let accountId = typeof userData.stripeConnect?.accountId === "string" ?
      userData.stripeConnect.accountId :
      "";
    if (!accountId) {
      const email = typeof userData.email === "string" ?
        normalizeEmail(userData.email) :
        typeof decodedToken.email === "string" ?
          normalizeEmail(decodedToken.email) :
          "";
      const accountBody = new URLSearchParams({
        type: "express",
        country: "AU",
      });
      if (email) {
        accountBody.set("email", email);
      }
      accountBody.set("capabilities[card_payments][requested]", "true");
      accountBody.set("capabilities[transfers][requested]", "true");
      accountBody.set("metadata[communitySportsUserId]", uid);
      accountBody.set(
        "metadata[dataPartition]",
        String(userData.dataPartition || getDataPartitionForEmail(email)),
      );

      const account = await stripeRequest<StripeConnectAccount>(
        "accounts",
        accountBody,
      );
      accountId = account.id;
      await updateUserStripeConnectStatus(uid, account);
    }

    const refreshUrl = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}` +
      "stripeConnect=refresh";
    const linkBody = new URLSearchParams({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    const accountLink = await stripeRequest<StripeConnectAccountLink>(
      "account_links",
      linkBody,
    );

    if (!accountLink.url) {
      response.status(502).json({
        error: "Stripe did not return an onboarding URL.",
      });
      return;
    }

    response.status(200).json({url: accountLink.url});
  } catch (error) {
    logger.error("Failed to create Stripe Connect account link", error);
    response.status(500).json({
      error: error instanceof Error ?
        error.message :
        "Failed to start Stripe Connect setup.",
    });
  }
});

export const refreshConnectAccountStatus = onRequest(async (
  request,
  response,
) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const returnUrl = typeof request.body?.returnUrl === "string" ?
      request.body.returnUrl :
      "";
    if (returnUrl && !returnUrlIsAllowed(returnUrl)) {
      response.status(400).json({error: "Return URL is not allowed."});
      return;
    }

    const userRef = firestore.doc(`users/${uid}`);
    const userSnapshot = await userRef.get();
    const userData = userSnapshot.data() || {};
    if (!userSnapshot.exists || userData.role !== "organiser") {
      response.status(403).json({
        error: "Only organisers can refresh Stripe Connect status.",
      });
      return;
    }

    const accountId = typeof userData.stripeConnect?.accountId === "string" ?
      userData.stripeConnect.accountId :
      "";
    if (!accountId) {
      response.status(400).json({error: "Stripe Connect is not set up yet."});
      return;
    }

    const account = await stripeGetRequest<StripeConnectAccount>(
      `accounts/${accountId}`,
    );
    const stripeConnect = await updateUserStripeConnectStatus(uid, account);

    response.status(200).json({stripeConnect});
  } catch (error) {
    logger.error("Failed to refresh Stripe Connect account status", error);
    response.status(500).json({
      error: error instanceof Error ?
        error.message :
        "Failed to refresh Stripe Connect status.",
    });
  }
});

export const createPlayerCheckoutSession = onRequest(async (
  request,
  response,
) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const registrationId = typeof request.body?.registrationId === "string" ?
      request.body.registrationId :
      "";
    const returnUrl = typeof request.body?.returnUrl === "string" ?
      request.body.returnUrl :
      "";
    if (!registrationId || !returnUrl) {
      response.status(400).json({
        error: "Registration and return URL are required.",
      });
      return;
    }
    if (!returnUrlIsAllowed(returnUrl)) {
      response.status(400).json({error: "Return URL is not allowed."});
      return;
    }

    const registrationRef = firestore.doc(`registrations/${registrationId}`);
    const registrationSnapshot = await registrationRef.get();
    const registration = registrationSnapshot.data() || {};
    if (!registrationSnapshot.exists || registration.userId !== uid) {
      response.status(403).json({
        error: "You can only pay for your own registration.",
      });
      return;
    }
    if (registration.status === "waiting") {
      response.status(400).json({
        error: "Waiting-list registrations cannot be paid online yet.",
      });
      return;
    }
    if (registration.playerPaid || registration.organiserPaid) {
      response.status(400).json({error: "This registration is already paid."});
      return;
    }

    const [eventSnapshot, seriesSnapshot] = await Promise.all([
      firestore.doc(`sessionEvents/${registration.sessionEventId}`).get(),
      firestore.doc(`sessions/${registration.sessionSeriesId}`).get(),
    ]);
    const eventData = eventSnapshot.data() || {};
    const seriesData = seriesSnapshot.data() || {};
    if (!eventSnapshot.exists || !seriesSnapshot.exists) {
      response.status(404).json({error: "Event or series was not found."});
      return;
    }
    if (seriesData.onlinePaymentEnabled !== true) {
      response.status(400).json({
        error: "Online payment is not enabled for this series.",
      });
      return;
    }

    const organiserSnapshot = await firestore
      .doc(`users/${seriesData.organiserId}`)
      .get();
    const organiserData = organiserSnapshot.data() || {};
    const connect = organiserData.stripeConnect || {};
    const connectedAccountId = typeof connect.accountId === "string" ?
      connect.accountId :
      "";
    if (
      !connectedAccountId ||
      connect.chargesEnabled !== true ||
      connect.payoutsEnabled !== true
    ) {
      response.status(400).json({
        error: "The organiser has not finished Stripe Connect setup.",
      });
      return;
    }

    const eventAmount = Number(
      eventData.onlinePaymentAmount ??
        eventData.defaultPriceCasual ??
        seriesData.defaultPriceCasual,
    );
    if (!Number.isFinite(eventAmount) || eventAmount <= 0) {
      response.status(400).json({
        error: "This event does not have a payable online amount.",
      });
      return;
    }

    const feeBreakdown = calculateOnlinePaymentFeeBreakdown(
      dollarsToCents(eventAmount),
    );
    const applicationFeeAmount =
      feeBreakdown.platformFeeCents + feeBreakdown.stripeFeeRecoveryCents;
    const successUrl = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}` +
      "checkout=success&session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}` +
      "checkout=cancelled";
    const title = typeof seriesData.title === "string" ?
      seriesData.title :
      "Community Sports event";
    const eventDate = typeof eventData.eventDate === "string" ?
      eventData.eventDate :
      "";

    const session = await stripeRequest<StripeCheckoutSession>(
      "checkout/sessions",
      new URLSearchParams({
        "mode": "payment",
        "line_items[0][price_data][currency]": "aud",
        "line_items[0][price_data][unit_amount]":
          String(feeBreakdown.playerTotalCents),
        "line_items[0][price_data][product_data][name]":
          `${title}${eventDate ? ` - ${eventDate}` : ""}`,
        "line_items[0][quantity]": "1",
        "payment_intent_data[application_fee_amount]":
          String(applicationFeeAmount),
        "payment_intent_data[transfer_data][destination]": connectedAccountId,
        "success_url": successUrl,
        "cancel_url": cancelUrl,
        "metadata[type]": "event_registration",
        "metadata[registrationId]": registrationId,
        "metadata[sessionEventId]": String(registration.sessionEventId),
        "metadata[sessionSeriesId]": String(registration.sessionSeriesId),
        "metadata[userId]": uid,
        "metadata[organiserId]": String(seriesData.organiserId),
        "metadata[organiserAmountCents]":
          String(feeBreakdown.organiserAmountCents),
        "metadata[platformFeeCents]": String(feeBreakdown.platformFeeCents),
        "metadata[stripeFeeRecoveryCents]":
          String(feeBreakdown.stripeFeeRecoveryCents),
        "metadata[playerTotalCents]": String(feeBreakdown.playerTotalCents),
      }),
    );

    if (!session.url || !session.id) {
      response.status(502).json({error: "Stripe did not return checkout."});
      return;
    }

    const paymentId = `payment__${registrationId}`;
    await Promise.all([
      registrationRef.set({
        stripeCheckoutSessionId: session.id,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true}),
      firestore.doc(`payments/${paymentId}`).set({
        sessionSeriesId: registration.sessionSeriesId,
        sessionEventId: registration.sessionEventId,
        registrationId,
        organiserId: seriesData.organiserId,
        userId: uid,
        playerName: registration.playerName,
        playerEmail: registration.playerEmail,
        dataPartition: registration.dataPartition || seriesData.dataPartition,
        amount: eventAmount,
        amountCents: feeBreakdown.organiserAmountCents,
        platformFeeCents: feeBreakdown.platformFeeCents,
        stripeFeeRecoveryCents: feeBreakdown.stripeFeeRecoveryCents,
        playerTotalCents: feeBreakdown.playerTotalCents,
        paymentMethod: "stripe",
        stripeCheckoutSessionId: session.id,
        playerPaid: false,
        organiserPaid: false,
        effectivePaid: false,
        status: "checkout_pending",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true}),
    ]);

    response.status(200).json({url: session.url});
  } catch (error) {
    logger.error("Failed to create player checkout session", error);
    response.status(500).json({
      error: error instanceof Error ?
        error.message :
        "Failed to start online payment.",
    });
  }
});

export const createBillingCheckoutSession = onRequest(async (
  request,
  response,
) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const email = typeof decodedToken.email === "string" ?
      normalizeEmail(decodedToken.email) :
      "";
    const returnUrl = typeof request.body?.returnUrl === "string" ?
      request.body.returnUrl :
      "";
    if (!returnUrl) {
      response.status(400).json({error: "Return URL is required."});
      return;
    }
    if (!returnUrlIsAllowed(returnUrl)) {
      response.status(400).json({error: "Return URL is not allowed."});
      return;
    }

    const userRef = firestore.doc(`users/${uid}`);
    const userSnapshot = await userRef.get();
    const userData = userSnapshot.data() || {};
    if (!userSnapshot.exists || userData.role !== "organiser") {
      response.status(403).json({
        error: "Only organisers can start a Pro subscription.",
      });
      return;
    }

    const existingCustomerId =
      typeof userData.subscription?.stripeCustomerId === "string" ?
        userData.subscription.stripeCustomerId :
        "";
    const createdCustomer = existingCustomerId ?
      null :
      await stripeRequest<StripeCustomer>(
        "customers",
        new URLSearchParams({
          email,
          "name": typeof userData.displayName === "string" ?
            userData.displayName :
            email,
          "metadata[firebaseUid]": uid,
          "metadata[dataPartition]": getDataPartitionForEmail(email),
        }),
      );
    const customerId = existingCustomerId || createdCustomer?.id || "";

    if (!existingCustomerId) {
      await userRef.set({
        subscription: {
          tier: "free",
          status: null,
          model: "flat_monthly",
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          grantedByAdmin: false,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const priceId = requireStripeSecret("STRIPE_PRO_PRICE_ID");
    const session = await stripeRequest<StripeCheckoutSession>(
      "checkout/sessions",
      new URLSearchParams({
        "mode": "subscription",
        "customer": customerId,
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "success_url": returnUrl,
        "cancel_url": returnUrl,
        "metadata[firebaseUid]": uid,
        "subscription_data[metadata][firebaseUid]": uid,
      }),
    );

    if (!session.url) {
      response.status(500).json({error: "Stripe did not return a URL."});
      return;
    }
    response.status(200).json({url: session.url});
  } catch (error) {
    logger.error("Stripe checkout creation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({
      error: error instanceof Error ?
        error.message :
        "Unable to start billing.",
    });
  }
});

export const createBillingPortalSession = onRequest(async (
  request,
  response,
) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const decodedToken = await authenticateRequest(request);
    const uid = decodedToken.uid;
    const returnUrl = typeof request.body?.returnUrl === "string" ?
      request.body.returnUrl :
      "";
    if (!returnUrl) {
      response.status(400).json({error: "Return URL is required."});
      return;
    }
    if (!returnUrlIsAllowed(returnUrl)) {
      response.status(400).json({error: "Return URL is not allowed."});
      return;
    }

    const userSnapshot = await firestore.doc(`users/${uid}`).get();
    const userData = userSnapshot.data() || {};
    const customerId =
      typeof userData.subscription?.stripeCustomerId === "string" ?
        userData.subscription.stripeCustomerId :
        "";
    if (!userSnapshot.exists || userData.role !== "organiser" || !customerId) {
      response.status(400).json({
        error: "No Stripe customer is linked to this organiser.",
      });
      return;
    }

    const session = await stripeRequest<StripePortalSession>(
      "billing_portal/sessions",
      new URLSearchParams({
        customer: customerId,
        return_url: returnUrl,
      }),
    );
    if (!session.url) {
      response.status(500).json({error: "Stripe did not return a URL."});
      return;
    }
    response.status(200).json({url: session.url});
  } catch (error) {
    logger.error("Stripe portal creation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({
      error: error instanceof Error ?
        error.message :
        "Unable to open billing.",
    });
  }
});

/**
 * Mirrors a Stripe subscription object onto the owning user profile.
 * @param {StripeSubscription} subscription
 */
async function updateSubscriptionFromStripe(subscription: StripeSubscription) {
  const customerId = typeof subscription.customer === "string" ?
    subscription.customer :
    "";
  if (!customerId) return;

  const userSnapshot = await firestore.collection("users")
    .where("subscription.stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  const userDoc = userSnapshot.docs[0];
  if (!userDoc) return;

  const status = subscription.status || null;
  const isEnabled = status === "active" || status === "trialing" ||
    status === "past_due" || status === "canceled";
  await userDoc.ref.set({
    subscription: {
      tier: isEnabled ? "pro" : "free",
      status,
      model: "flat_monthly",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: subscription.current_period_end ?
        new Date(subscription.current_period_end * 1000) :
        null,
      grantedByAdmin: false,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
}

/**
 * Marks a registration/payment as paid from a completed Checkout Session.
 * @param {StripeCheckoutSession} session
 */
async function updateRegistrationPaymentFromCheckout(
  session: StripeCheckoutSession,
) {
  if (session.payment_status !== "paid") return;
  const metadata = session.metadata || {};
  const registrationId = metadata.registrationId || "";
  if (!registrationId) return;

  const paymentIntentId = typeof session.payment_intent === "string" ?
    session.payment_intent :
    "";
  const paymentId = `payment__${registrationId}`;
  const paymentReference = `Stripe ${session.id || paymentIntentId}`.trim();
  const amountCents = Number.parseInt(metadata.organiserAmountCents || "0", 10);
  const platformFeeCents = Number.parseInt(
    metadata.platformFeeCents || "0",
    10,
  );
  const stripeFeeRecoveryCents = Number.parseInt(
    metadata.stripeFeeRecoveryCents || "0",
    10,
  );
  const playerTotalCents = Number.parseInt(
    metadata.playerTotalCents || "0",
    10,
  );

  await Promise.all([
    firestore.doc(`registrations/${registrationId}`).set({
      playerPaid: true,
      organiserPaid: true,
      paymentReference,
      stripeCheckoutSessionId: session.id || null,
      stripePaymentIntentId: paymentIntentId || null,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true}),
    firestore.doc(`payments/${paymentId}`).set({
      paymentMethod: "stripe",
      stripeCheckoutSessionId: session.id || null,
      stripePaymentIntentId: paymentIntentId || null,
      paymentReference,
      amountCents,
      amount: amountCents / 100,
      platformFeeCents,
      stripeFeeRecoveryCents,
      playerTotalCents,
      playerPaid: true,
      organiserPaid: true,
      effectivePaid: true,
      status: "paid",
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true}),
  ]);
}

export const stripeBillingWebhook = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({error: "Method not allowed."});
    return;
  }

  try {
    const event = verifyStripeSignature(request);
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data?.object as StripeSubscription | undefined;
      if (subscription?.id) {
        await updateSubscriptionFromStripe(subscription);
      }
    } else if (event.type === "checkout.session.completed") {
      const session = event.data?.object as StripeCheckoutSession | undefined;
      if (session?.id) {
        await updateRegistrationPaymentFromCheckout(session);
      }
    }
    response.status(200).json({received: true});
  } catch (error) {
    logger.error("Stripe billing webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(400).json({error: "Invalid Stripe webhook."});
  }
});

export {
  deliverNotificationEvent,
  queueApprovalApprovedNotification,
  queueApprovalRequestedNotification,
  queueNewEventOpenedNotifications,
  queuePaymentDueSoonNotifications,
  queueRegistrationCreatedNotification,
  queueRegistrationDeletedNotification,
  queueRegistrationUpdatedNotifications,
} from "./notifications.js";
