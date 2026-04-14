# WhatsApp Integration Plan

## Scope requested

- Organiser button on a session event to post current registered player names to a configured WhatsApp group.
- Automatic repost when player registrations change (join/remove/status movement).
- Investigate inbound group commands (e.g. `@sports-tran add me`) to update registrations.

## Recommended architecture

1. Use **WhatsApp Business Platform Cloud API** (Meta) with a dedicated business number.
2. Add a small server-side messaging module in Firebase Functions:
   - `sendEventRosterMessage(eventId)` callable/HTTP endpoint (organiser/admin triggered).
   - Registration change trigger path (on write to `registrations`) that enqueues/debounces roster updates.
3. Store WhatsApp config on session series:
   - `whatsAppEnabled: boolean`
   - `whatsAppTargetType: "group" | "direct"` (group support depends on approved integration path)
   - `whatsAppTargetId`
4. Add audit logging collection:
   - `whatsAppMessages` with status, provider response id, eventId, seriesId, retries, and last error.

## Important product constraint

- Official WhatsApp Cloud API is strongest for **business-to-user** messaging, while direct group automation can be limited depending on approved app capabilities.
- Group-bot style command listening may require a different provider layer or approved intermediary architecture.
- Recommendation: deliver outbound roster push first, then evaluate inbound command feasibility with a short technical spike.

## Cost model (high level)

- WhatsApp Business conversations are billed by Meta conversation category and country.
- Costs vary by template/utility/service conversation windows.
- Additional costs:
  - Firebase Functions invocations and networking.
  - Optional queueing/retry infrastructure.

## Delivery phases

1. **Phase 1 (low risk):**
   - Manual “Send roster to WhatsApp” button.
   - Per-series WhatsApp target configuration.
   - Delivery status logging.
2. **Phase 2:**
   - Automatic roster resend on registration updates with debounce window (e.g., 20-60 seconds).
3. **Phase 3 (research spike):**
   - Inbound message processing and command parsing feasibility for group workflows.

## Testing strategy

- Sandbox/staging WhatsApp destination and test series under `@example.com` partition.
- End-to-end tests:
  - Manual send button.
  - Player added/removed updates.
  - Failure retry behavior (invalid target, network failure, rate limit).
- Security tests:
  - Only authorised organiser/admin for that event can send messages.
  - Partition boundaries preserved (`live` vs `test`).

## Decisions needed from user before implementation

1. Confirm provider path: strictly Meta Cloud API first, or allow third-party provider if group support is blocked.
2. Confirm acceptable message frequency for automatic updates (every change vs batched).
3. Confirm whether inbound command automation is mandatory for MVP or can be post-MVP.
