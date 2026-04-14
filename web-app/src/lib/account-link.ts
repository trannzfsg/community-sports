type LinkRegisteredUserDataResult = {
  uid: string;
  email: string;
  role: "player" | "organiser" | "admin";
  status: "active" | "inactive";
};

const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_FUNCTION_NAME = "linkRegisteredUserData";

function getLinkRegisteredUserDataUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_LINK_REGISTERED_USER_DATA_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_FUNCTION_NAME}`;
}

export async function linkRegisteredUserData(idToken: string) {
  const response = await fetch(getLinkRegisteredUserDataUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
  });

  const payload = await response.json().catch(() => null) as
    | (LinkRegisteredUserDataResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to unify user records.");
  }

  return {
    uid: payload?.uid || "",
    email: payload?.email || "",
    role: payload?.role || "player",
    status: payload?.status || "active",
  } satisfies LinkRegisteredUserDataResult;
}
