import test from "node:test";
import assert from "node:assert/strict";
import { sendNotificationTest } from "../src/lib/notification-test.ts";

test("sendNotificationTest uses the cloud functions url derived from project id", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "community-sports-6584e";

  let capturedUrl = "";
  let capturedRequest: RequestInit | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedRequest = init;
    return new Response(JSON.stringify({
      queued: true,
      eventId: "event-123",
      channel: "telegram",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendNotificationTest({
      idToken: "token-123",
      channel: "telegram",
    });

    assert.equal(
      capturedUrl,
      "https://us-central1-community-sports-6584e.cloudfunctions.net/sendNotificationTest",
    );
    assert.equal(capturedRequest?.headers instanceof Headers, false);
    assert.deepEqual(result, {
      queued: true,
      eventId: "event-123",
      channel: "telegram",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProjectId;
  }
});
