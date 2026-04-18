# Member Benefits Plan

## What We Are Solving
- Organiser-level loyalty benefits after a player reaches a configured number of confirmed games with that organiser.
- Session-series membership that can keep a player enrolled in a recurring series without the organiser manually re-adding them every week.

## Recommendation
- Treat these as two related but separate features:
  - `Organiser loyalty`: benefits earned across all series owned by one organiser.
  - `Series membership`: a recurring opt-in for one specific session series.
- Reuse the existing event creation path instead of inventing a separate scheduler.
- Keep all derived membership counts and auto-registration writes server-side in Firebase Functions.
- Roll out in stages so we do not mix pricing changes, recurring registration, and new admin controls all at once.

## Why This Fits The Current App
- The app already has a useful definition of a "confirmed game" in [web-app/src/lib/player-stats.ts](C:/github/community_sports/community_sports/web-app/src/lib/player-stats.ts): a registration is counted only when it is not on the waiting list and `organiserPaid` is true.
- New events are already created through [web-app/src/lib/session-series.ts](C:/github/community_sports/community_sports/web-app/src/lib/session-series.ts), and that same flow already supports `copyRosterFromLastEvent`.
- Organiser approval already exists in [web-app/src/lib/organiser-approvals.ts](C:/github/community_sports/community_sports/web-app/src/lib/organiser-approvals.ts), so recurring registration should respect that instead of creating a second permission model.
- Notifications already react to `sessionEvents` and `registrations` in [functions/src/notifications.ts](C:/github/community_sports/community_sports/functions/src/notifications.ts), so membership work has to account for those triggers.

## Product Shape

### A. Organiser Loyalty
- A player earns progress with an organiser across every series that organiser owns.
- Progress should be based on organiser-confirmed attendance, not just raw registrations.
- Each organiser can configure a small set of tiers, for example:
  - `5 confirmed games`: badge only
  - `10 confirmed games`: $5 discount
  - `20 confirmed games`: one free casual game
- Recommended first release: support only one monetary benefit type, `casual price override`, because it fits the current manual payment model best.

### B. Series Membership
- A player can opt into one series membership at a time per series.
- The main value is "keep me on the roster for each new event in this series."
- Recommended states:
  - `active`
  - `paused`
  - `cancelled`
- Recommended player controls:
  - join or leave the series membership
  - pause recurring registration without losing history
  - skip one event without cancelling the membership

## Recommended Data Model

### `organiserBenefitPrograms/{organiserId}`
- `enabled: boolean`
- `programName: string`
- `qualifyingMetric: "organiserConfirmedGames"`
- `tiers: [{id, minGames, benefitType, benefitValue, label}]`
- `dataPartition`
- `updatedAt`

### `organiserBenefitMemberships/{organiserId__playerId}`
- `organiserId`
- `playerId`
- `playerName`
- `playerEmail`
- `confirmedGames`
- `currentTierId`
- `currentTierLabel`
- `benefitSnapshot`
- `status: "active" | "inactive"`
- `lastQualifiedAt`
- `dataPartition`
- `updatedAt`

### `seriesMemberships/{seriesId__playerId}`
- `seriesId`
- `organiserId`
- `playerId`
- `playerName`
- `playerEmail`
- `status: "active" | "paused" | "cancelled"`
- `skipNextEvent: boolean`
- `joinedAt`
- `lastAutoRegisteredEventId`
- `lastAutoRegisteredAt`
- `dataPartition`
- `updatedAt`

### Small additions to existing docs
- `registrations`
  - add `source: "self" | "organiser" | "roster-copy" | "series-membership"`
  - add `seriesMembershipId?: string | null`
- `sessions`
  - add `seriesMembershipEnabled?: boolean`
  - add `benefitProgramEnabled?: boolean`

## Source Of Truth Rules
- `organiserBenefitPrograms` can be edited by the organiser or admin.
- `seriesMemberships` can be requested by the player, approved/managed by organiser/admin if needed.
- `organiserBenefitMemberships` is derived data only and should be written by Functions, not the client.
- Auto-created registrations must be created by Functions so we can keep capacity, approval, and idempotency checks in one place.

## Server-Side Flows

### 1. Loyalty recompute
- Trigger on `registrations` create, update, and delete.
- Recompute only for the affected player and organiser.
- Count qualifying registrations as:
  - `status != "waiting"`
  - `organiserPaid == true`
- Write the summary into `organiserBenefitMemberships/{organiserId__playerId}`.

### 2. Series membership auto-registration
- Trigger on `sessionEvents/{sessionEventId}` create.
- Load the parent series and all active `seriesMemberships` for that series.
- For each member:
  - skip if organiser approval is no longer valid
  - skip if already registered
  - skip if `skipNextEvent == true`, then clear the flag
  - assign `registered` or `waiting` using the same capacity logic used today
  - create the registration with `source = "series-membership"`
- Rebalance the event counts after inserts.
- Store `lastAutoRegisteredEventId` and `lastAutoRegisteredAt` on the membership record.

### 3. Benefit application
- Recommended first release: do not silently mutate historic prices.
- Instead, when an eligible player is registered, expose the earned benefit in the organiser UI and optionally prefill a discounted expected amount in the payment mirror.
- If we later automate pricing, add a separate `appliedBenefit` field on `registrations` or `payments`.

## Interaction With Existing Features

### Organiser approval
- A player should not be able to start a series membership unless they are approved for that organiser.
- If approval is later revoked, the membership should auto-pause instead of silently continuing.

### Waiting list
- Series membership should respect current event capacity.
- If the event is full, the member goes to the waiting list exactly like a normal registration.
- Do not reserve capacity for members in phase 1.

### Copy roster from last event
- This is the biggest overlap with the proposed feature.
- Recommendation: keep both features, but define the order clearly:
  - run `copyRosterFromLastEvent` first
  - run series-membership auto-registration second
  - dedupe by registration id
- Longer term, series membership may replace blanket roster copy for many organisers.

### Notifications
- Auto-created registrations will fire the existing registration notification triggers.
- That is probably acceptable, but the "new event opened" notification may arrive before the membership registration exists because both flows react to event creation.
- Recommended phase-1 handling: accept that ordering.
- Recommended later refinement: move "new event opened" notifications behind a queue document so they run after membership auto-registration finishes.

## UI Surfaces

### Player
- Dashboard card showing organiser loyalty progress and current tier.
- Series-level toggle: `Join this series membership`.
- Membership controls: `Pause`, `Resume`, `Skip next event`, `Cancel`.

### Organiser
- Session edit screen:
  - enable or disable series membership for this series
  - view active members
- Loyalty settings:
  - configure tier thresholds
  - choose benefit type and amount
- Event view:
  - show when a registration came from series membership
  - show which players currently qualify for a loyalty benefit

### Admin
- Read-only visibility first.
- Manual override tools only after the workflow is stable.

## Rollout Plan

### Phase 1: Read-only loyalty stats
- Add `organiserBenefitPrograms` and `organiserBenefitMemberships`.
- Recompute confirmed game counts in Functions.
- Show organiser loyalty progress in the UI.
- No pricing changes yet.

### Phase 2: Series membership without pricing automation
- Add `seriesMemberships`.
- Add player opt-in and organiser visibility.
- Auto-register on event creation with waiting-list support.
- Track registration source.

### Phase 3: Benefit redemption
- Apply the chosen benefit type during registration or payment.
- Add organiser/admin override tools.
- Decide whether benefits can stack or expire.

## Main Risks
- `organiserPaid` currently acts as the closest thing to "confirmed attendance," but it may not perfectly match what you mean by "games registered" or "games played."
- `copyRosterFromLastEvent` and series membership can surprise organisers if both are on and the behavior is not clearly explained.
- Notification timing around new event creation may be slightly noisy until we queue event-opened notifications after membership processing.
- Auto-registration must stay idempotent so repeated event-create retries do not duplicate registrations.

## Decisions To Confirm Before We Implement
1. Should loyalty progress count `registered games`, or only organiser-confirmed games? My recommendation is organiser-confirmed games.
2. What benefit types do you want in version 1? My recommendation is just one: a fixed casual-price discount or override.
3. Should series membership be player self-service, organiser-managed, or both? My recommendation is both: player opt-in, organiser can pause or cancel.
4. When both `copyRosterFromLastEvent` and series membership are enabled, do you want both to run, or should series membership replace roster copy for that series?
5. Should members ever get reserved spots ahead of normal players? My recommendation is no for the first release.
6. Should a player be able to skip one event while keeping the membership active? My recommendation is yes.
