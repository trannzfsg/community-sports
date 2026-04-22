# To-Do List

- [ ] Execute all scenarios in `TESTING.md`, record every issue/question found, and keep a short list of things we cannot fully validate in-app (for example external email delivery and Telegram delivery).
  - [x] Run the checklist end to end with the `@example.com` test accounts.
  - [x] Add a TODO sub-item for each bug, regression, or product question found.
    - [ ] Bug: admin `Manage organisers` -> editing and saving an existing registered organiser (`john@example.com`) fails with `Missing or insufficient permissions.` instead of saving cleanly.
    - [ ] Bug: admin `Manage players` -> removing an organiser private player deletes or hides the record completely instead of moving it into the inactive organiser-private section with a `Reactivate player` action.
    - [ ] Bug: player organiser-approval requests do not persist. A new `@example.com` player can click `Request approval` and briefly see `Requested`, but after reload the dashboard goes back to `Status: not requested` and no approval record appears for the organiser to approve.
    - [ ] Bug: organiser `Create next event` can fail silently after an event is marked completed. On `Membership Date QA 1776781147568`, clicking `Create next event` left the completed `2026-04-27` event in place and did not create a new `sessionEvents` document.
    - [ ] Bug: admin test-partition visibility is too narrow. Firestore contains live sessions (`PCYC`, `test event do not register`), but `admin@example.com` did not see those live titles on the dashboard while `player1@example.com` correctly hid them.
    - [ ] Bug: example-domain email change has a broken success UX. Changing `qa.approval.player.1776841435518@example.com` to `qa.approval.player.changed.1776841435518@example.com` moved the login email, but the UI did not show the expected success confirmation cleanly and the reverse change surfaced `Firebase: Error (auth/user-token-expired).`
  - [x] Capture a short blocked-items list for checks that need external inboxes, Telegram chats, or other out-of-band verification.
    - [ ] Blocked validation: real outbound registration, verification, password-reset, and non-`@example.com` email-change emails cannot be confirmed without access to the destination inboxes.
    - [ ] Blocked validation: Telegram delivery to the actual chat/device cannot be fully confirmed from inside the app without access to the configured bot conversation, even though historical `notificationEvents` records show prior `sent` Telegram deliveries.
    - [ ] Blocked validation: end-to-end organiser/player notification triggers for approval requests, registrations, removals, and payment-reference updates were not fully revalidated all the way through external delivery in this pass.
- [ ] TBA
