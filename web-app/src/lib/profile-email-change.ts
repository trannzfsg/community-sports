export type SyncProfileEmailChangeResult = {
  email: string;
};

const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_FUNCTION_NAME = "syncUserEmailChange";
const PENDING_EMAIL_CHANGE_KEY = "pending-profile-email-change";

export type PendingEmailChange = {
  previousEmail: string;
  nextEmail: string;
};

function getSyncUserEmailChangeUrl() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_FUNCTION_NAME}`;
}

export function rememberPendingEmailChange(value: PendingEmailChange) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PENDING_EMAIL_CHANGE_KEY, JSON.stringify(value));
}

export function readPendingEmailChange() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(PENDING_EMAIL_CHANGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PendingEmailChange>;
    if (!parsed.previousEmail || !parsed.nextEmail) {
      return null;
    }

    return {
      previousEmail: parsed.previousEmail,
      nextEmail: parsed.nextEmail,
    } satisfies PendingEmailChange;
  } catch {
    return null;
  }
}

export function clearPendingEmailChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(PENDING_EMAIL_CHANGE_KEY);
}

export async function syncProfileEmailChange(input: {
  idToken: string;
  previousEmail: string;
  nextEmail: string;
}) {
  const response = await fetch(getSyncUserEmailChangeUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.idToken}`,
    },
    body: JSON.stringify({
      previousEmail: input.previousEmail,
      nextEmail: input.nextEmail,
    }),
  });

  const payload = await response.json().catch(() => null) as
    | (SyncProfileEmailChangeResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to sync the updated email.");
  }

  return {
    email: payload?.email || input.nextEmail,
  } satisfies SyncProfileEmailChangeResult;
}
