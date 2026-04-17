# Member Benefits Plan

## Goals
- Organiser-level loyalty benefits after player reaches X attended games.
- Session-series membership that can auto-register eligible players into future events.

## Scope Split

### A. Organiser Loyalty Membership
Players accumulate played games with an organiser and unlock configured benefits.

### B. Session-Series Membership
Players enroll in a specific series membership that can auto-register them for each new event.

## Data Model Proposal

### `organiserMembershipRules/{organiserId}`
- `enabled: boolean`
- `tiers: [{minGames:number, benefitType:string, benefitValue:number|string}]`
- `dataPartition`

### `organiserMemberships/{organiserId__playerId}`
- `organiserId`
- `playerId`
- `gamesPlayedConfirmed`
- `currentTier`
- `benefitsSnapshot`
- `status: active|inactive`
- `dataPartition`

### `seriesMemberships/{seriesId__playerId}`
- `seriesId`
- `playerId`
- `autoRegister: boolean`
- `status: active|paused|cancelled`
- `effectiveFrom`
- `dataPartition`

## Behavior

### Organiser Loyalty
- Recompute `gamesPlayedConfirmed` when registrations are confirmed/paid (server-side).
- Tier changes are derived from rules and written back to membership record.
- Dashboard displays current organiser tier to player and organiser.

### Series Auto-Registration
- When organiser creates next event, function checks active `seriesMemberships`.
- For each eligible member:
  - Skip if already registered
  - Respect event capacity/waitlist rules
  - Create registration with source `membership-auto`
- Notify organiser with summary of auto-registrations.

## Admin/Organiser Controls
- Organiser can configure membership rules for own organiser scope.
- Organiser can enable/disable series auto-registration per player.
- Admin can view and override in exceptional cases.

## Security and Integrity
- Membership writes should be server-side for derived fields (`gamesPlayedConfirmed`, `currentTier`).
- Client can request membership enrollment, but server validates:
  - player ownership/identity
  - organiser/session scope
  - partition consistency

## Rollout Plan
1. Phase 1: Read-only membership stats (no auto actions).
2. Phase 2: Enable organiser loyalty benefits.
3. Phase 3: Enable series auto-registration with feature flag and dry-run mode first.

## Open Product Decisions (Need Confirmation)
- What exact benefits should each tier grant? (discount, priority, fee waiver, etc.)
- Should auto-registration prioritize paid members before normal registrants?
- Can players opt out per event while keeping series membership active?
