export type PasswordResetLookupResult = {
  canReset: boolean;
  blockMessage?: string;
};

const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_FUNCTION_NAME = "passwordResetLookup";

function getPasswordResetLookupUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_PASSWORD_RESET_LOOKUP_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_FUNCTION_NAME}`;
}

export async function lookupPasswordResetEligibility(email: string) {
  const response = await fetch(getPasswordResetLookupUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const payload = await response.json().catch(() => null) as PasswordResetLookupResult & { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to check password reset eligibility.");
  }

  return {
    canReset: payload?.canReset ?? true,
    blockMessage: payload?.blockMessage,
  } satisfies PasswordResetLookupResult;
}
