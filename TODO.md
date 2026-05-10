# To-Do List

- [ ] Allow organiser accounts to also act as players.
  - [x] Review current role, player profile, dashboard, approvals, registration, rules, and tests.
  - [x] Plan product and architecture decisions, then confirm assumptions before implementation.
  - [x] Keep single `organiser` role while adding implicit player capability.
  - [x] Auto-register organisers as the first player in their own new events.
  - [x] Let organisers request normal player approval from other organisers.
  - [x] Split organiser profile/onboarding into organiser and player sections.
  - [x] Implement approved dual organiser/player behaviour.
  - [x] Verify with automated checks and live browser testing.
  - [ ] Commit, merge to main, deploy, and complete smoke validation.

- [ ] Implement hosted player checkout with Stripe Connect platform cut.
  - [x] Add series online-payment settings for casual and member fees.
  - [x] Add event-level online payment amount override support.
  - [x] Add Checkout Session creation and webhook completion.
  - [x] Add player pay-online action and payment status updates.
  - [ ] Verify full sandbox flow in browser.

- [ ] Implement as per PREMIUM_FEATURES_PLAN.md
  - [x] Build subscription gating foundation first
  - [x] Add organiser Pro upgrade/manage surface using Stripe Billing
  - [x] Add admin Pro grant/revoke controls
  - [x] Add Firestore rules and verification coverage for subscription fields
  - [x] Confirm before continuing beyond gating into payment/accounting/push features
  - [x] Add in-app notification inbox foundation for the robust-notifications premium slice

- [ ] Move the "show comment" and "hide comment" button in feedback page to the 2nd line below upvote/downvote buttons.

- [ ] STOP HERE, confirm before continue. Change onboarding from text based to screenshot based. A few screenshots per section, with minimal text. Tidy up onboarding too to include any new functions that's missed. Implement a marker so we know what onboarding instructions are up to, and able to retro fit new functions into onboarding after the marker in future.
