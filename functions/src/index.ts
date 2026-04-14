import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import type {Request, Response} from "express";

setGlobalOptions({maxInstances: 10});

const adminApp = getApps().length ? getApps()[0] : initializeApp();
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
  response.set("Access-Control-Allow-Headers", "Content-Type");
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
