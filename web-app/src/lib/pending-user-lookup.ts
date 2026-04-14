export type PendingUserLookupResult = {
  displayName?: string;
  email?: string;
  role?: "player" | "organiser" | "admin";
  status?: "active" | "inactive";
};

const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_FUNCTION_NAME = "lookupPendingUserProfile";

function getPendingUserLookupUrl() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_FUNCTION_NAME}`;
}

export async function lookupPendingUserProfile(idToken: string) {
  const response = await fetch(getPendingUserLookupUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
  });

  const payload = await response.json().catch(() => null) as
    | (PendingUserLookupResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to resolve pending user role.");
  }

  return {
    displayName: payload?.displayName,
    email: payload?.email,
    role: payload?.role,
    status: payload?.status,
  } satisfies PendingUserLookupResult;
}
