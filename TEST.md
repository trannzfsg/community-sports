# Testing Entry Point

Use [TESTING.md](./TESTING.md) for the full regression checklist after major feature work.

Use [TESTING_SMOKE.md](./TESTING_SMOKE.md) for the short deployment smoke checklist after smaller changes.

Recent feature coverage is also automated locally with:

```bash
cd web-app
npm run build
npx serve -l 3001 out
node scripts/recent-features-regression.mjs
```

That browser regression covers the persistent menu, first-login onboarding, dedicated organiser approvals page, cancellation-policy enforcement, event-level overrides with audit visibility, and the organiser-managed membership flow.
