export type PlayerCheckoutResult = {
  url: string;
};

const DEFAULT_FUNCTION_REGION = "us-central1";

function getFunctionUrl(functionName: string, configuredUrl?: string) {
  const trimmedUrl = configuredUrl?.trim();
  if (trimmedUrl) return trimmedUrl;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${functionName}`;
}

export async function createPlayerCheckoutSession(input: {
  idToken: string;
  registrationId: string;
  returnUrl: string;
}) {
  const response = await fetch(
    getFunctionUrl(
      "createPlayerCheckoutSession",
      process.env.NEXT_PUBLIC_STRIPE_PLAYER_CHECKOUT_URL,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.idToken}`,
      },
      body: JSON.stringify({
        registrationId: input.registrationId,
        returnUrl: input.returnUrl,
      }),
    },
  );

  const payload = await response.json().catch(() => null) as
    | (PlayerCheckoutResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to start online payment.");
  }

  if (!payload?.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return payload;
}
