import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";

setGlobalOptions({maxInstances: 10});

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
    organiserVisibility: "organisers can only manage and view their own sessions/payments",
    adminVisibility: "admins can view everything",
  });
});
