# Premium Features — Product + Implementation Plans (rev 2)

## Context

TODO.md lists three premium features earmarked as future-only: in-app payments, organiser accounting, and a more robust notification system. Rev 2 (2026-04-24) replaces card-first Stripe with Australian low-fee rails after user flagged that 1.7% + A$0.30 card fees (~A$0.55 on a A$15 casual) eat one player's share every 28-player session. Rev 2 also adds subscription-based gating so premium features are only available to paying organisers, turning the platform itself into a revenue stream.

Validated assumptions (2026-04-24):

- Firebase project is already on Blaze — Cloud Functions deploy.
- **Payment rails for player → organiser**:
  - **Primary**: PayTo / PayID via an AU NPP gateway (evaluate Azupay / Monoova / Zepto / Stripe PayTo-AU). Flat ~A$0.10–A$0.20 per txn, instant settlement, bank-to-bank.
  - **Cheap tier**: existing manual bank reference flow kept as a fee-free fallback.
  - Card / Apple Pay / Google Pay is **deferred** to a later iteration unless user opts back in — fee profile too high for small tickets.
- **Bundling / membership payment request**:
  - Members pay in prepaid blocks (e.g. 4 sessions for A$60) → one transaction instead of four.
  - New flow: organiser requests payment from a player as a condition of membership. Player pays via PayTo/PayID (or Stripe) or manual ref → on confirmation, organiser promotes them to member (`autoPaidUntilDate` extended).
  - Flow is optional — organiser can still promote a player to member without requesting payment (existing behaviour preserved).
- **Subscription / feature gating**:
  - **Only organisers pay.** Players never subscribe.
  - **Monetisation model** — keep flexible; design supports both, pick final pricing at rollout:
    - **A**: flat monthly Pro sub (e.g. A$X/month) collected via Stripe Billing card.
    - **B**: per-transaction platform cut (e.g. Y% or Zc) skimmed from PayTo/PayID (or Stripe) transfers. Organiser absorbs, never the player.
  - **Tier structure**: single Pro tier unlocks all three premium features (payments, accounting, push). Admin can grant free Pro to specific organisers via user flag (beta, comps, friends-of-platform).
- Refunds: organiser-initiated via gateway + auto-refund when a player self-cancels inside the cancellation-policy window (unchanged).
- Stripe Connect model for payout destination is dropped (used to solve card Connect split). New rails settle directly organiser-side; platform cut (option B) or flat sub (option A) collected separately via Stripe Billing on the organiser's own card.
- Accounting cost model: per-event fixed categories (`venue`, `staff`, `equipment`, `other`) + free-form non-event ledger (unchanged).
- Accounting scopes: per-organiser, per-series, AU FY (Jul–Jun), calendar year, all-time (unchanged).
- Accounting access: organiser sees own; admin sees all; players see own payment history (unchanged).
- Notifications: **PWA + Web Push via FCM** for mobile iOS (16.4+ homescreen) + Android. Retain Telegram + scaffolded email. Shared retry dispatcher (unchanged).
- Currency: AUD only for v1.

Existing foundation to reuse:

- [payments.ts](web-app/src/lib/payments.ts) — `PaymentRecord`, `syncPaymentRecordForRegistration`, dual-flag model.
- [session-series.ts](web-app/src/lib/session-series.ts) — `SessionSeries`, `SessionEvent`, `RegistrationItem`, `autoPaidUntilDate` (extend for bundle blocks), Brisbane-TZ helpers.
- [functions/src/notifications.ts](functions/src/notifications.ts) — `notificationEvents` queue, Telegram + email, idempotency, per-channel status.
- [firestore.rules](firestore.rules) — partitioned role checks; extend, don't rewrite.
- [lib/flow-access.ts](web-app/src/lib/flow-access.ts) — central gate for feature access — primary hook point for subscription checks.

---

## Feature 0 — Subscription Gating (new, prerequisite for 1–3)

### Product

- Organiser profile → "Upgrade to Pro" panel → Stripe Billing checkout → successful sub marks `users.subscription.tier = 'pro'` + `status = 'active'`.
- Pro unlocks: in-app payment rails, accounting pages, mobile push preferences + delivery.
- Free organisers keep everything they have today: manual bank ref flow, dashboard, notifications via Telegram/email only.
- Admin can set `subscription.tier = 'pro'` + `subscription.grantedByAdmin = true` on any user to comp Pro without Stripe.
- Pricing decision kept open: same feature gate whether monetisation ends up being flat monthly sub (Stripe Billing) or per-transaction cut (deducted at PayTo/PayID/Stripe settlement). Both models write to the same `subscription` object; only the billing source differs.
- Visible UX hints on locked features: small "Pro" badge on menu items + on-click modal explaining the upgrade.

### Implementation

New user fields (`users` collection):

- `subscription`:
  - `tier`: `'free' | 'pro'`
  - `status`: `'active' | 'past_due' | 'canceled' | 'trialing' | null`
  - `model`: `'flat_monthly' | 'txn_cut' | 'admin_grant'`
  - `stripeCustomerId?`, `stripeSubscriptionId?`
  - `currentPeriodEnd?` (Timestamp)
  - `grantedByAdmin?: boolean`
  - `grantedByAdminAt?`, `grantedByAdminBy?` (admin UID)

New code:

- `web-app/src/lib/subscription.ts`:
  - `isPro(user)` — pure predicate.
  - `hasFeature(user, featureKey)` — maps Pro → `{inAppPayments, accounting, pushNotifications}`; free-tier falls through.
  - `subscriptionBannerState(user)` — drives UI nudges.
- `web-app/src/lib/flow-access.ts` — add `canUseInAppPayments`, `canUseAccounting`, `canUsePushNotifications`; each checks `hasFeature`.
- `web-app/src/app/organiser/subscription/page.tsx` — upgrade + manage page, Stripe customer portal link.
- `web-app/src/app/admin/users/[userId]/page.tsx` — admin controls to grant/revoke Pro.
- `web-app/src/components/ProLockedOverlay.tsx` — reused modal + inline badge.

Cloud Functions (`functions/src/subscription.ts`, new):

- `createBillingCheckoutSession` (callable, organiser-only).
- `createBillingPortalSession` (callable, organiser-only).
- `stripeBillingWebhook` (HTTPS): handles `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. Writes `subscription` on the user record. Separate webhook endpoint + secret from the payment-rail webhook.

Firestore rules:

- `users.subscription` — read by owner + admin. Writable only by Cloud Functions + admin (admin for `grantedByAdmin` fields only; cannot spoof `status`/`stripeSubscriptionId`).
- Premium collections (`eventCosts`, `ledgerEntries`, new `paymentIntents`, push preference extensions) gated behind Pro checks: `isPro(ownerOrganiser)`.

Cost-effectiveness:

- Single feature switch reused everywhere → one code path for lock/unlock.
- No duplicated gating logic between client and server — client uses `flow-access.ts`, server mirrors in Firestore rules.

### Verification

- Admin grants Pro to a test organiser → premium pages load, badges disappear.
- Admin revokes → pages re-lock immediately (Firestore live listener on user doc).
- Stripe Billing test-mode sub → webhook flips tier; cancel → `status=canceled` but grace period until `currentPeriodEnd`.
- Rules tests: free organiser cannot read/write premium collections; admin-granted Pro can.

---

## Feature 1 — In-App Payments (PayTo/PayID AU rails, or Stripe, with manual fallback)

### Product

- **Gate**: only Pro organisers can enable in-app rails. Free organisers keep manual bank reference only.
- **Organiser onboarding** (Pro):
  - Profile page → "Connect bank for PayTo" (or Stripe) → gateway onboarding (Azupay/Monoova/Stripe-PayTo-AU, vendor pick pending — see open decisions).
  - On success, organiser record stores `payidHandle`, `gatewayAccountId`, `settlementAccountVerified`.
- **Session-series setting**: `paymentMode` = `manual_reference | in_app_payto | either`. Default `manual_reference` for backward compatibility.
- **Session-series setting**: `feeBearer` = `player_surcharge | organiser_absorb`. At A$0.10–A$0.20 flat, absorbing is viable for most organisers — but still configurable.
- **Player flow** (PayTo/PayID/Stripe):
  - Registration → "Pay now" opens a PayTo agreement (once, consented in their bank app) or a one-off PayID push or Stripe. Confirmation webhook flips `playerPaid = true` + `paymentReference = payto:<ref>` + `gatewayFeeCents`.
  - Fallback button: "I'd rather pay manually" → existing manual ref input.
- **Bundle / membership payment request flow** (new):
  - Organiser on player row → "Request membership payment" → picks block size (default 4 sessions × series price) → sends payment request.
  - Player dashboard shows "Membership payment request" banner with amount + block terms → pays via PayTo/PayID or manual ref.
  - On confirmation, `autoPaidUntilDate` extended by block length; player becomes member (`seriesMemberships.status = 'active'`).
  - Organiser can still skip the request and mark a player a member directly (existing path preserved).
- **Refunds** (Pro only):
  - Organiser dashboard → Refund button on paid registration → calls callable → gateway refund + `playerPaid = false` + `refundedAt` recorded.
  - Auto-refund on player self-cancel when `now < eventStart - cancellationPolicyHours`. Outside window → blocked.

### Implementation

**Gateway vendor decision — pending** (open decision 1 below). Plan assumes the interface is vendor-agnostic: a thin adapter (`functions/src/payments/rails/payto-adapter.ts`) with `createPaymentAgreement`, `chargePaymentAgreement`, `refund`, `verifyWebhook`. Swapping vendor = new adapter, no app-code change.

New Firestore fields:

- `sessions` (SessionSeries): `paymentMode`, `feeBearer`, `membershipBlockSize` (default 4), `membershipBlockPriceCents` (optional — defaults to blockSize × defaultPriceCasual).
- `users` (organiser): `payidHandle`, `gatewayAccountId`, `gatewayAccountVerified`.
- `payments`: `gateway` (`'manual' | 'payto' | 'payid'`), `gatewayPaymentId`, `gatewayFeeCents`, `refundId`, `refundedAt`, `refundReason`, `netToOrganiserCents`, `platformCutCents?` (for txn-cut monetisation).
- New collection `membershipPaymentRequests/{id}`: `organiserId`, `playerUserId`, `sessionSeriesId`, `blockSize`, `amountCents`, `status` (`pending|paid|expired|canceled`), `expiresAt`, `paymentId?`, `createdAt`, `dataPartition`.

New/updated code:

- `web-app/src/lib/payments.ts` — extend `syncPaymentRecordForRegistration` to persist gateway IDs + fees.
- `web-app/src/lib/membership-requests.ts` — CRUD + promote-to-member on payment confirmation (reuse `seriesMemberships` + `autoPaidUntilDate`).
- `web-app/src/components/PayNowButton.tsx` — PayTo/PayID agreement UX + fallback to manual ref.
- `web-app/src/app/organiser/payments/page.tsx` — gateway onboarding + payout status.
- `web-app/src/app/organiser/series/[id]/members/page.tsx` — "Request membership payment" action + status tracking.
- `web-app/src/app/sessions/edit/page.tsx` — `paymentMode`, `feeBearer`, `membershipBlockSize` controls (Pro-gated).
- `web-app/src/app/dashboard/page.tsx` — Pay now / Refund buttons + membership-request banner for players.

Cloud Functions (`functions/src/payments/`):

- `rails/payto-adapter.ts` — vendor-neutral interface (Azupay or chosen vendor).
- `createPaymentIntent` (callable, player): validates eligibility + Pro on organiser, creates agreement, returns client handoff.
- `paymentsWebhook` (HTTPS): signature verify → flip paid flags + gateway fields + enqueue notification + (if txn-cut model) compute and defer platform-cut ledger entry.
- `refundPayment` (callable, organiser/admin): gateway refund + flag reversal.
- `onRegistrationDelete` trigger: auto-refund when deletion happens inside policy window.
- `handleMembershipPaymentConfirmation` — on `membershipPaymentRequests` status change to `paid`, extend `autoPaidUntilDate`, create bulk registrations for upcoming events in block, enqueue notifications.

Firestore rules:

- Gateway-ID fields on `payments` and `users` → writable only by Cloud Functions (webhook).
- `membershipPaymentRequests` → organiser read/write own; player read/update-status-only own (to mark canceled).
- All "enable in-app pay" writes gated on `isPro(organiserId)` via rules helper.

Env / secrets:

- `PAYTO_GATEWAY_API_KEY`, `PAYTO_WEBHOOK_SECRET`, `PAYTO_GATEWAY_ACCOUNT_ID`, vendor-specific creds.
- `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET` (Feature 0), separate from payment rails.

Cost-effectiveness:

- A$0.10–A$0.20 flat vs A$0.55 card = ~65–80% fee reduction on a A$15 ticket.
- Bundle / membership flow further cuts txn count 4× → effective fee near 0.3% of revenue.
- Vendor-agnostic adapter means we can re-tender when a cheaper rail lands.
- Manual ref stays free as the fallback + free-tier offering.

### Verification

- Gateway sandbox end-to-end: create event, pay via PayTo/PayID (or Stripe - pending user decision), webhook flips flags, notification delivered.
- Manual fallback path on same event type still works.
- Membership payment request: organiser requests → player pays → member promoted → auto-paid for 4 upcoming events, notifications fired.
- Refund path: full + partial; `refundedAt` + flag clear + registration state.
- Auto-refund path: cancel inside policy window → refund issued; outside → blocked with existing contact-organiser error.
- Gate: free organiser cannot see in-app pay settings; revoking Pro mid-cycle stops new intents but honours pending ones.
- Rules tests: client cannot write gateway ID fields.

### Open decisions (need user input before build)

1. **Vendor pick** for PayTo/PayID rail — Azupay, Monoova, Zepto, or Stripe PayTo-AU. Trade-off: pricing, AU onboarding time, sandbox quality, PayTo maturity. Stripe is also viable option with higher fees. Confirm with user before proceeding.
2. **Monetisation model** for subscription — flat monthly Pro (A$X) vs per-txn platform cut (Y% or Zc). Both are buildable; pick one for launch based on anticipated organiser volume. Preferred per-txn small cut (e.g. Stripe takes 0.30+1.7% on top of $15 casual, platform takes extra 2% on $15). It'll be good to be able to hide this from end users, so they see as $15 + transaction costs. 

---

## Feature 2 — Organiser Accounting

(Unchanged from rev 1 except where noted.)

### Product

- **Pro-gated**: free organisers see a locked overlay. Pro unlocks all views.
- **Event-linked costs**: event detail → add cost entries with category (`venue|staff|equipment|other`), amount, optional note, optional vendor.
- **Ledger entries**: organiser tab for non-event income/expense (sponsor, insurance, gear), free-form category, direction in/out, optional attach to series.
- **Reports** (organiser → Accounting):
  - Filter: scope (`all` | `series` | `event`), period (`all-time` | `calendar year` | `AU FY` | custom).
  - Shows: revenue net of refunds, costs, net, cashflow timeline (month buckets), outstanding unpaid, **platform cut totals** if txn-cut monetisation is active.
  - CSV export.
- **Admin view**: same page + organiser selector.
- **Player view**: profile → Payment History (lifetime, read-only, receipts where available).

### Implementation

New collections / fields as rev 1, plus:

- `payments.platformCutCents?` already listed in Feature 1 — Accounting nets it out of organiser revenue.
- `eventCosts` + `ledgerEntries` rules: organiser must be Pro to create (prevent half-written data by lapsed subscribers); read still allowed after downgrade.

Indexes (unchanged): `eventCosts(organiserId, incurredAt desc)`, `ledgerEntries(organiserId, occurredAt desc)`, `payments(organiserId, updatedAt desc)`, `sessionEvents(organiserId, eventDate desc)`.

Reuse: `PaymentRecord.amount` as revenue source (paid & not refunded), Brisbane-TZ helpers for FY cut-offs.

### Verification

Same as rev 1. Additionally:

- Platform-cut line items show up in reports when txn-cut monetisation is enabled.
- Revoke Pro mid-period → read still works, write is blocked.

---

## Feature 3 — Robust Notifications (Mobile Push + shared retry)

(Largely unchanged from rev 1. Gate added.)

### Product

- **Pro-gated**: mobile push is a Pro feature. Free users keep Telegram + email.
- Adds Web Push via FCM on top of Telegram + (now-enabled) email.
- iOS (16.4+) install-to-homescreen + Android native.
- Shared retry dispatcher (Cloud Tasks, exponential backoff, 3 attempts) — covers all channels.
- In-app notification bell (all users, free + Pro) — reads own `notificationEvents`, unread counter, mark-as-read.

### Implementation

As rev 1. Addition:

- `hasFeature(user, 'pushNotifications')` gate before prompting for browser push + before `deliverPush` runs.
- Free-tier users still get bell + Telegram + email; only push is gated.

### Verification

As rev 1. Addition:

- Toggle Pro → push registration available; revoke → existing tokens silently stop (webhook drops delivery for non-Pro).

---

## Critical Files to Modify

- [web-app/src/lib/payments.ts](web-app/src/lib/payments.ts) — gateway IDs, fee/refund/platform-cut fields.
- [web-app/src/lib/session-series.ts](web-app/src/lib/session-series.ts) — `paymentMode`, `feeBearer`, membership block config.
- [web-app/src/lib/flow-access.ts](web-app/src/lib/flow-access.ts) — subscription-aware feature gates.
- [web-app/src/lib/subscription.ts](web-app/src/lib/subscription.ts) (new) — tier + feature predicates.
- [functions/src/notifications.ts](functions/src/notifications.ts) — push channel, shared retry dispatcher.
- [functions/src/payments/](functions/src/payments/) (new) — PayTo (or Stripe) adapter, webhook, refund, membership confirm.
- [functions/src/subscription.ts](functions/src/subscription.ts) (new) — Stripe Billing callable + webhook.
- [functions/src/index.ts](functions/src/index.ts) — register new triggers + Cloud Tasks handler.
- [firestore.rules](firestore.rules) — `subscription` lockdown, Pro-gated collections, gateway-ID lockdown, new collections.
- [firestore.indexes.json](firestore.indexes.json) — indexes per Feature 2.
- [web-app/src/app/dashboard/page.tsx](web-app/src/app/dashboard/page.tsx) — Pay now, Refund, bell, membership-request banner.
- [web-app/src/app/profile/page.tsx](web-app/src/app/profile/page.tsx) — push prefs, subscription panel, payment-history link.
- [web-app/src/app/organiser/](web-app/src/app/organiser/) — new subscription, payments onboarding, accounting, ledger, member-request pages.
- [web-app/src/app/admin/](web-app/src/app/admin/) — accounting + Pro-grant controls.

## Suggested Build Order

1. **Deploy existing Functions scaffolding to Blaze** — prove Telegram + scheduled jobs run. Smoke via `TESTING_SMOKE.md`.
2. **Feature 0 — Subscription gating** — locks down nothing real yet (no premium code exists), but stands up Stripe Billing, `subscription` schema, admin-grant flow, and `hasFeature` predicate. Everything downstream is gated by this.
3. **Feature 3 — Push + shared retry dispatcher** — smallest, improves reliability for payment notifications in Feature 1. Gate on `hasFeature(user, 'pushNotifications')`.
4. **Feature 1 — PayTo/PayID (or Stripe) payments + membership payment request** — biggest revenue-enabler for organisers. Build vendor-neutral adapter first, land manual-ref-compatible refund path, then wire membership block flow.
5. **Feature 2 — Accounting** — depends on Feature 1 data (refunds, platform cut) being in place.

## Open decisions blocking build

- **Gateway vendor** — Azupay vs Monoova vs Zepto vs Stripe PayTo-AU. Recommend 1-day spike comparing fees, onboarding time, PayTo maturity, sandbox quality.
- **Monetisation model** — flat monthly Pro vs per-txn platform cut (organiser absorbs). Pick one for launch; schema supports either.
- **Pro pricing** — A$X/month (or Y% cut). Needs market research (what do comparable AU community-sport SaaS charge?).
- **Free-tier limits** — should free organisers have any cap (events/month, members) to drive upgrades, or is the Pro-feature lockout enough?
