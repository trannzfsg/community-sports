import test from "node:test";
import assert from "node:assert/strict";
import { syncProfileEmailChange } from "../src/lib/profile-email-change.ts";

test("syncProfileEmailChange uses the cloud functions url derived from project id", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "community-sports-6584e";

  let capturedRequest: RequestInit | undefined;
  let capturedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedRequest = init;
    return new Response(JSON.stringify({ email: "new@example.com" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await syncProfileEmailChange({
      idToken: "token-123",
      previousEmail: "old@example.com",
      nextEmail: "new@example.com",
    });

    assert.equal(
      capturedUrl,
      "https://us-central1-community-sports-6584e.cloudfunctions.net/syncUserEmailChange",
    );
    assert.equal(capturedRequest?.headers instanceof Headers, false);
    assert.deepEqual(result, { email: "new@example.com" });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProjectId;
  }
});
