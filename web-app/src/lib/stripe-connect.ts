export type StripeConnectStatus = {
  accountId?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  disabledReason?: string | null;
  currentlyDue?: string[];
  updatedAt?: unknown;
};

export type StripeConnectUser = {
  role?: "player" | "organiser" | "admin" | null;
  stripeConnect?: StripeConnectStatus | null;
};

export type StripeConnectActionResult = {
  url: string;
};

export type StripeConnectStatusResult = {
  stripeConnect: StripeConnectStatus;
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

export function canReceiveOnlinePayments(user?: StripeConnectUser | null) {
  const connect = user?.stripeConnect;
  return user?.role === "organiser" &&
    connect?.chargesEnabled === true &&
    connect?.payoutsEnabled === true;
}

export function getStripeConnectStatusLabel(connect?: StripeConnectStatus | null) {
  if (!connect?.accountId) return "Not set up";
  if (connect.chargesEnabled && connect.payoutsEnabled) return "Ready";
  if (connect.detailsSubmitted) return "Pending review";
  return "Setup incomplete";
}

async function callConnectFunction<T>(input: {
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
    | (T & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to update Stripe Connect.");
  }

  if (!payload) {
    throw new Error("Stripe Connect returned an empty response.");
  }

  return payload;
}

export function createConnectAccountLink(input: {
  idToken: string;
  returnUrl: string;
}) {
  return callConnectFunction<StripeConnectActionResult>({
    functionName: "createConnectAccountLink",
    configuredUrl: process.env.NEXT_PUBLIC_STRIPE_CONNECT_ACCOUNT_LINK_URL,
    idToken: input.idToken,
    returnUrl: input.returnUrl,
  });
}

export function refreshConnectAccountStatus(input: {
  idToken: string;
  returnUrl: string;
}) {
  return callConnectFunction<StripeConnectStatusResult>({
    functionName: "refreshConnectAccountStatus",
    configuredUrl: process.env.NEXT_PUBLIC_STRIPE_CONNECT_STATUS_URL,
    idToken: input.idToken,
    returnUrl: input.returnUrl,
  });
}
