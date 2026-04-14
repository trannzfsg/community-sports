# Firebase Web Key and Client-Side Security Audit

## What was verified

- Firebase web config values are loaded from env (`NEXT_PUBLIC_FIREBASE_*`) and not embedded as new hardcoded literals in app source.
- A tracked debug script with a hardcoded API key (`web-app/tmp-live-sdk-check.mjs`) was removed.
- Firestore security remains rule-driven by authenticated identity and partition (`live` vs `test`), so API key possession alone does not grant data access.

## Why API keys appear in email links and client code

- Firebase Web API keys are **project identifiers**, not secret credentials.
- Firebase Auth action links (verify email / recover email / reset password) include the API key by Firebase design.
- Exposure of this key is expected; risk is controlled by Authentication, Firestore Rules, and backend authorization checks.

## Real controls that matter

- Firestore Rules (already in place) enforcing role + partition + ownership.
- Firebase Auth token verification on server-side functions (`authenticateRequest`).
- API key restrictions in Google Cloud Console (manual step).
- App Check to reduce abuse from unauthorized clients (recommended rollout).

## Manual actions required (user verification needed)

1. In Google Cloud Console for project `community-sports-6584e`, edit the web API key used by `web-app/.env.local`.
2. Add application restrictions:
   - Allow localhost dev origin(s) you use.
   - Allow deployed production host(s) only.
3. Add API restrictions to required Firebase APIs only (Auth, Firestore, Identity Toolkit as needed by current flows).
4. Re-test login, registration, dashboard reads/writes, and email-change flows from both localhost and deployed site.
5. Decide App Check rollout mode:
   - Phase 1: monitor-only / partial coverage.
   - Phase 2: enforce on selected products/functions.

## Notes

- If key restrictions are too strict, auth flows can fail silently with network/permission errors; roll out with staged testing.
- Email action links still include the API key after restrictions; this is normal and not itself a vulnerability.
