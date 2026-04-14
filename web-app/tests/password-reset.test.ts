import test from "node:test";
import assert from "node:assert/strict";
import { lookupPasswordResetEligibility } from "../src/lib/password-reset.ts";

test("uses configured password reset lookup url", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_PASSWORD_RESET_LOOKUP_URL;

  process.env.NEXT_PUBLIC_PASSWORD_RESET_LOOKUP_URL = "https://example.com/passwordResetLookup";

  let capturedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ canReset: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await lookupPasswordResetEligibility("john@example.com");
    assert.equal(capturedUrl, "https://example.com/passwordResetLookup");
    assert.deepEqual(result, { canReset: true, blockMessage: undefined });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_PASSWORD_RESET_LOOKUP_URL = originalUrl;
  }
});

test("returns block message from lookup endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "community-sports-6584e";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    canReset: false,
    blockMessage: "This account uses Google sign-in. Use Continue with Google instead of password reset.",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  try {
    const result = await lookupPasswordResetEligibility("tranzha83@gmail.com");
    assert.deepEqual(result, {
      canReset: false,
      blockMessage: "This account uses Google sign-in. Use Continue with Google instead of password reset.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProjectId;
  }
});

test("throws lookup error when endpoint rejects the request", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "community-sports-6584e";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: "Email is required.",
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  try {
    await assert.rejects(
      () => lookupPasswordResetEligibility(""),
      /Email is required\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProjectId;
  }
});
