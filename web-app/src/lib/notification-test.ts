export type SendNotificationTestChannel = "telegram" | "email";

export type SendNotificationTestResult = {
  queued: boolean;
  eventId: string;
  channel: SendNotificationTestChannel;
};

const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_FUNCTION_NAME = "sendNotificationTest";

function getSendNotificationTestUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SEND_NOTIFICATION_TEST_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing Firebase project configuration.");
  }

  return `https://${DEFAULT_FUNCTION_REGION}-${projectId}.cloudfunctions.net/${DEFAULT_FUNCTION_NAME}`;
}

export async function sendNotificationTest(input: {
  idToken: string;
  channel: SendNotificationTestChannel;
}) {
  const response = await fetch(getSendNotificationTestUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.idToken}`,
    },
    body: JSON.stringify({
      channel: input.channel,
    }),
  });

  const payload = await response.json().catch(() => null) as
    | (SendNotificationTestResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to queue the test notification.");
  }

  return {
    queued: payload?.queued ?? true,
    eventId: payload?.eventId || "",
    channel: payload?.channel || input.channel,
  } satisfies SendNotificationTestResult;
}
