# App Check Rollout Plan (Web + Functions)

## Goal

Reduce abuse from unauthorized scripted clients while preserving current login and registration UX.

## Phase 0: Prep

- Enable App Check in Firebase project for web app.
- Choose provider:
  - reCAPTCHA Enterprise (recommended for production)
  - reCAPTCHA v3 (lower setup overhead for initial rollout)
- Add environment values for site key(s) in web app env files.

## Phase 1: Client instrumentation (no enforcement)

- Initialize App Check in frontend startup (same place Firebase app is initialized).
- Enable token auto-refresh.
- Validate that normal flows still work:
  - login/register
  - dashboard load
  - profile save / email change
  - organiser/admin management screens

## Phase 2: Functions hardening

- For sensitive HTTP/callable functions, validate App Check token where supported.
- Keep existing Auth ID token checks; App Check complements but does not replace authentication.
- Add structured logging for rejected requests:
  - missing/invalid App Check token
  - uid/email when available
  - endpoint name and timestamp

## Phase 3: Progressive enforcement

- Start with monitor mode (if available) and log failure rates.
- Enforce App Check on lowest-risk surfaces first.
- Expand to all relevant products after 1-2 stable release cycles.

## Verification checklist

- Localhost dev still works (debug provider/dev allowances).
- Deployed site works for both `@example.com` and live users.
- No spike in auth/profile errors after enabling enforcement.
- Functions reject unauthorized non-App-Check traffic as expected.

## Rollback plan

- Keep enforcement toggles reversible per-product.
- If user-facing failures occur, temporarily disable enforcement and inspect App Check + function logs.
