export type SyncProfileEmailChangeResult = {
  email: string;
};

export type DirectExampleEmailChangeResult = {
  email: string;
};

const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_FUNCTION_NAME = "syncUserEmailChange";
const DEFAULT_DIRECT_EXAMPLE_FUNCTION_NAME = "changeExampleUserEmail";
const PENDING_EMAIL_CHANGE_KEY = "pending-profile-email-change";
const DEFAULT_FUNCTION_URLS: Record<string, string> = {
  "community-sports-6584e": "https://syncuseremailchange-cyz7zlp3oq-uc.a.run.app",
};
const DEFAULT_DIRECT_EXAMPLE_FUNCTION_URLS: Record<string, string> = {
  "community-sports-6584e": "https://changeexampleuseremail-cyz7zlp3oq-uc.a.run.app",
};

export type PendingEmailChange = {
  previousEmail: string;
  nextEmail: string;
};

function getSyncUserEmailChangeUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SYNC_USER_EMAIL_CHANGE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  if (DEFAULT_FUNCTION_URLS[projectId]) {
    return DEFAULT_FUNCTION_URLS[projectId];
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_FUNCTION_NAME}`;
}

function getDirectExampleUserEmailChangeUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_DIRECT_EXAMPLE_USER_EMAIL_CHANGE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  if (DEFAULT_DIRECT_EXAMPLE_FUNCTION_URLS[projectId]) {
    return DEFAULT_DIRECT_EXAMPLE_FUNCTION_URLS[projectId];
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_DIRECT_EXAMPLE_FUNCTION_NAME}`;
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

export async function changeExampleUserEmailDirectly(input: {
  idToken: string;
  nextEmail: string;
}) {
  const response = await fetch(getDirectExampleUserEmailChangeUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.idToken}`,
    },
    body: JSON.stringify({
      nextEmail: input.nextEmail,
    }),
  });

  const payload = await response.json().catch(() => null) as
    | (DirectExampleEmailChangeResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to change the example user email.");
  }

  return {
    email: payload?.email || input.nextEmail,
  } satisfies DirectExampleEmailChangeResult;
}
