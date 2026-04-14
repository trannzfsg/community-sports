import test from "node:test";
import assert from "node:assert/strict";
import { lookupPendingUserProfile } from "../src/lib/pending-user-lookup.ts";

test("lookupPendingUserProfile uses deployed function url and returns role payload", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "community-sports-6584e";

  let capturedUrl = "";
  let capturedAuthHeader = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    capturedAuthHeader = headers?.Authorization || "";

    return new Response(JSON.stringify({
      displayName: "Test Organiser",
      email: "tranzha83+test1@gmail.com",
      role: "organiser",
      status: "active",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await lookupPendingUserProfile("id-token-123");
    assert.equal(
      capturedUrl,
      "https://us-central1-community-sports-6584e.cloudfunctions.net/lookupPendingUserProfile",
    );
    assert.equal(capturedAuthHeader, "Bearer id-token-123");
    assert.deepEqual(result, {
      displayName: "Test Organiser",
      email: "tranzha83+test1@gmail.com",
      role: "organiser",
      status: "active",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProjectId;
  }
});
