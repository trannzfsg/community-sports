import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webAppDir, "..");
const execAsync = promisify(exec);

function encodeUpdateMask(fieldPaths) {
  const params = new URLSearchParams();
  fieldPaths.forEach((fieldPath) => params.append("updateMask.fieldPaths", fieldPath));
  return params.toString();
}

async function readResponsePayload(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function isExampleEmail(email) {
  return normalizeEmail(email).endsWith("@example.com");
}

export function assertExampleEmail(email, label) {
  if (!isExampleEmail(email)) {
    throw new Error(`${label} must stay inside the @example.com test partition. Received: ${email}`);
  }
}

export function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

export function loadFirebaseQaConfig(overrides = {}) {
  const appEnv = readEnvFile(path.join(webAppDir, ".env.local"));
  const testEnv = readEnvFile(path.join(repoRoot, ".env.test.local"));

  const config = {
    projectId: overrides.projectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || appEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    apiKey: overrides.apiKey || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || appEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
    adminEmail: overrides.adminEmail || process.env.ADMIN_TEST_EMAIL || testEnv.ADMIN_TEST_EMAIL,
    adminPassword: overrides.adminPassword || process.env.ADMIN_TEST_PASSWORD || testEnv.ADMIN_TEST_PASSWORD,
    organiserEmail: overrides.organiserEmail || process.env.ORGANISER_TEST_EMAIL || testEnv.ORGANISER_TEST_EMAIL,
    organiserPassword: overrides.organiserPassword || process.env.ORGANISER_TEST_PASSWORD || testEnv.ORGANISER_TEST_PASSWORD,
    playerEmail: overrides.playerEmail || process.env.PLAYER_TEST_EMAIL || testEnv.PLAYER_TEST_EMAIL,
    playerPassword: overrides.playerPassword || process.env.PLAYER_TEST_PASSWORD || testEnv.PLAYER_TEST_PASSWORD,
  };

  if (!config.projectId || !config.apiKey || !config.adminEmail || !config.adminPassword) {
    throw new Error("Missing Firebase QA configuration in .env.local or .env.test.local.");
  }

  return config;
}

export async function signInWithPassword(config, email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(`Firebase sign-in failed for ${email}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function fetchUserContext(config, email, password, label) {
  assertExampleEmail(email, label);
  const authRecord = await signInWithPassword(config, email, password);
  return {
    email,
    password,
    uid: authRecord.localId,
    idToken: authRecord.idToken,
  };
}

export async function fetchDocument(config, idToken, documentPath) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${documentPath}`,
    {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${documentPath}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function patchDocument(config, idToken, documentPath, fields, updateMaskFields = []) {
  const updateMask = updateMaskFields.length ? `?${encodeUpdateMask(updateMaskFields)}` : "";
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${documentPath}${updateMask}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  );

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(`Failed to patch ${documentPath}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function deleteDocument(config, idToken, documentPath) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${documentPath}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    },
  );

  if (response.status === 404) {
    return;
  }

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    if (response.status === 403) {
      const deleteCommand = `npx -y firebase-tools@latest firestore:delete "${documentPath}" --project "${config.projectId}" --force`;
      await execAsync(deleteCommand, { cwd: repoRoot });
      return;
    }

    throw new Error(`Failed to delete ${documentPath}: ${JSON.stringify(payload)}`);
  }
}

export function buildApprovalId(organiserUid, playerUid) {
  return `${organiserUid}__${playerUid}`;
}

export async function fetchUserProfile(config, adminToken, uid) {
  const document = await fetchDocument(config, adminToken, `users/${uid}`);
  if (!document?.fields) {
    return null;
  }

  return {
    displayName: document.fields.displayName?.stringValue || "",
    email: document.fields.email?.stringValue || "",
    role: document.fields.role?.stringValue || "",
  };
}

export async function resetOnboardingVersions(config, adminToken, uid) {
  await patchDocument(
    config,
    adminToken,
    `users/${uid}`,
    {
      onboardingSeenVersions: {
        mapValue: {
          fields: {},
        },
      },
    },
    ["onboardingSeenVersions"],
  );
}

export async function setOrganiserApprovalStatus(config, adminToken, input) {
  const documentPath = `organiserApprovals/${buildApprovalId(input.organiserUid, input.playerUid)}`;

  if (input.status === "none") {
    await deleteDocument(config, adminToken, documentPath);
    return;
  }

  await patchDocument(config, adminToken, documentPath, {
    organiserId: { stringValue: input.organiserUid },
    organiserName: { stringValue: input.organiserName },
    playerId: { stringValue: input.playerUid },
    playerName: { stringValue: input.playerName },
    playerEmail: { stringValue: input.playerEmail },
    dataPartition: { stringValue: "test" },
    status: { stringValue: input.status },
    updatedAt: { timestampValue: new Date().toISOString() },
  });
}
