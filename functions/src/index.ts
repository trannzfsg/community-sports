import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import type {Request, Response} from "express";

setGlobalOptions({maxInstances: 10});

const adminApp = getApps().length ? getApps()[0] : initializeApp();
const firestore = getFirestore(adminApp);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://community-sports-6584e.web.app",
  "https://community-sports-6584e.firebaseapp.com",
]);

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
 * Resolves the logical data partition for the supplied email address.
 * @param {string} email
 * @return {"test"|"live"}
 */
function getDataPartitionForEmail(email: string) {
  return normalizeEmail(email).endsWith("@example.com") ? "test" : "live";
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
    const displayName =
      typeof userData.displayName === "string" && userData.displayName.trim() ?
        userData.displayName.trim() :
        nextEmail;
    const status =
      typeof userData.status === "string" && userData.status.trim() ?
        userData.status.trim() :
        "active";
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

    if (role === "player" || role === "organiser") {
      const nextPendingRef = firestore.doc(`users/${nextEmail}`);
      batch.set(nextPendingRef, {
        displayName,
        email: nextEmail,
        role,
        status,
        dataPartition: nextPartition,
        userId: uid,
        isPending: true,
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
      firestore.collection("users")
        .where("isPending", "==", true)
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
      const previousPendingRef = firestore.doc(`users/${previousEmail}`);
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
    const displayName =
      typeof userData.displayName === "string" && userData.displayName.trim() ?
        userData.displayName.trim() :
        nextEmail;
    const status =
      typeof userData.status === "string" && userData.status.trim() ?
        userData.status.trim() :
        "active";

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

    if (role === "player" || role === "organiser") {
      batch.set(firestore.doc(`users/${nextEmail}`), {
        displayName,
        email: nextEmail,
        role,
        status,
        dataPartition: "test",
        userId: uid,
        isPending: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const [registrationSnapshot, paymentSnapshot, stalePendingSnapshot] =
      await Promise.all([
        firestore.collection("registrations").where("userId", "==", uid).get(),
        firestore.collection("payments").where("userId", "==", uid).get(),
        firestore.collection("users")
          .where("isPending", "==", true)
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
      const previousPendingRef = firestore.doc(`users/${currentEmail}`);
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

    const pendingSnapshot = await firestore.doc(`users/${signedInEmail}`).get();
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
