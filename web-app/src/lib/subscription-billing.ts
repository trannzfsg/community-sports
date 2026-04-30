export type BillingActionResult = {
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

async function callBillingFunction(input: {
  functionName: string;
  configuredUrl?: string;
  idToken: string;
  returnUrl: string;
}) {
  const response = await fetch(getFunctionUrl(input.functionName, input.configuredUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.idToken}`,
    },
    body: JSON.stringify({
      returnUrl: input.returnUrl,
    }),
  });

  const payload = await response.json().catch(() => null) as
    | (BillingActionResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to start Stripe Billing.");
  }

  if (!payload?.url) {
    throw new Error("Stripe did not return a redirect URL.");
  }

  return payload;
}

export function createBillingCheckoutSession(input: {
  idToken: string;
  returnUrl: string;
}) {
  return callBillingFunction({
    functionName: "createBillingCheckoutSession",
    configuredUrl: process.env.NEXT_PUBLIC_STRIPE_BILLING_CHECKOUT_URL,
    idToken: input.idToken,
    returnUrl: input.returnUrl,
  });
}

export function createBillingPortalSession(input: {
  idToken: string;
  returnUrl: string;
}) {
  return callBillingFunction({
    functionName: "createBillingPortalSession",
    configuredUrl: process.env.NEXT_PUBLIC_STRIPE_BILLING_PORTAL_URL,
    idToken: input.idToken,
    returnUrl: input.returnUrl,
  });
}
