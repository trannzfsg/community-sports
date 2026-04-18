# Notifications Options Plan (Cost-First)

## Goal
Notify organisers when:
- A player requests approval
- A player registers, notify event player list numbers out of total too
- A player removes registration, notify event player list numbers out of total too
- A player submits/updates payment reference, notify event player payment numbers out of total too
Notify players when:
- An organiser approves an approval
- Payment not made when event has 15 minutes to start
- Moves up from wait list to registered
- Organiser confirms payment
- A new event previously joined has started a new one
Make sure all above is configurable (enable/disable) in profile section

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
1. Start with Option A (email) for all triggers. Configurable via profile section - notification preferences.
2. Implement telegram support per session series for organisers only wanting instant push. Configurable via profile section - notification preferences.
3. Keep WhatsApp and Discord integration parked until volume/ROI justifies cost.

## Architecture (for Email + Telegram)
- Emit notification events server-side via Firebase Functions only.
- Triggers:
  - `organiserApprovals` create: send organiser "player requested approval".
  - `organiserApprovals` update from `pending` to `approved`: send player "organiser approved you".
  - `registrations` create: send organiser "player registered" with registered/waiting counts out of total capacity.
  - `registrations` delete: send organiser "player removed registration" with updated registered/waiting counts out of total capacity.
  - `registrations` update when `paymentReference` changes or `playerPaid` changes from false to true: send organiser "payment reference submitted/updated" with paid counts out of registered count.
  - `registrations` update when `status` changes from `waiting` to `registered`: send player "you moved off the wait list".
  - `registrations` update when `organiserPaid` changes from false to true: send player "organiser confirmed payment".
  - `sessionEvents` create for an existing series: notify previously joined players that the next event is now open.
  - Scheduled function every 5 minutes: find active events starting within the next 15 minutes and notify registered unpaid players once.
- Add `notificationPreferences` collection keyed by organiser user id and player user id:
  - Document id: `notificationPreferences/{userId}`.
  - Store `userId`, `dataPartition`, transport config (`email.enabled`, `telegram.enabled`, `telegram.chatId`, `telegram.chatType`), and per-trigger booleans for organiser and player notifications.
  - Default all notification toggles to `false`; nothing sends unless the user explicitly enables it in Profile.
  - Keep Telegram config on the server-readable preference doc only; the bot token stays in Functions config/secrets and never reaches the client.
  - Read preferences at send time so profile changes take effect immediately without redeploying or backfilling users.
- Add `notificationEvents` collection for idempotent work items:
  - One normalized document per recipient + trigger + source change, including message payload, channel eligibility, delivery status, and an idempotency key.
  - Delivery functions can safely retry from this collection without re-reading the original business mutation path.
- Rate-limit bursts by coalescing multiple registration changes within short window (for spam control).

## Security Notes
- Never send Firestore/API secrets to client.
- Validate that event belongs to target organiser or target player before sending.
- Use idempotency key per event change to avoid duplicate notifications on retries.

## Proposed Next Step
- Implement Email notifications - enabled only if configurations are set to true. The from email to use for notifications is: noreply@firebase.tranzha.com
- Implement Telegram notifications - enabled only if configurations are set to true.
