# Notifications Options Plan (Cost-First)

## Goal
Notify organisers when:
- A player requests approval
- A player registers
- A player removes registration
- A player submits/updates payment reference

## Option Comparison

### Option A: Email notifications (recommended first)
- Cost: near-zero at current scale (Firebase Functions + SMTP provider/free tier)
- Complexity: low
- Reliability: high
- Pros:
  - No third-party app install required for organisers
  - Works immediately with existing user emails
  - Good audit trail
- Cons:
  - Not instant-push on phone for every user

### Option B: Discord webhook per organiser
- Cost: free
- Complexity: medium
- Reliability: medium-high
- Pros:
  - Fast mobile notifications
  - Easy channel-level separation
- Cons:
  - Requires organiser Discord setup
  - Webhook URL management and rotation needed

### Option C: Telegram bot per organiser/channel
- Cost: free
- Complexity: medium
- Reliability: high
- Pros:
  - Strong mobile push behavior
  - Bot supports commands later
- Cons:
  - Extra onboarding for organisers

### Option D: WhatsApp Cloud API
- Cost: highest long-term
- Complexity: high
- Reliability: high
- Pros:
  - Best user familiarity
- Cons:
  - Message/template costs
  - Heavier compliance and template management

## Recommended Rollout
1. Start with Option A (email) for all four triggers.
2. Add optional Discord webhook support per session series for organisers wanting instant push.
3. Keep WhatsApp integration parked until volume/ROI justifies cost.

## Architecture (for Option A + optional Discord)
- Emit notification events server-side via Firebase Functions only.
- Triggers:
  - `organiserApprovals` status changes
  - `registrations` create/delete/update
- Add `notificationPreferences` collection keyed by organiser user id:
  - `emailEnabled`
  - `discordWebhookUrl` (optional, encrypted/secret-managed if possible)
  - `minimumEventTypes` filters
- Rate-limit bursts by coalescing multiple registration changes within short window (for spam control).

## Security Notes
- Never send Firestore/API secrets to client.
- Validate that event belongs to target organiser before sending.
- Use idempotency key per event change to avoid duplicate notifications on retries.

## Proposed Next Step
- Implement Option A only first (email notifications) behind a feature flag:
  - `notifications.email.enabled=true` in runtime config.
