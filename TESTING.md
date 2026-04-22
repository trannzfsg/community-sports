# Full Testing Checklist (`@example.com`)

Use this checklist after major feature work, cross-role fixes, or any change that touches shared data, permissions, or core booking flows. Run locally first, then repeat the relevant final pass on [sports.tranzha.com](https://sports.tranzha.com).

## Shared rules

- Stay inside the `@example.com` test partition unless a step explicitly asks `admin@example.com` to compare test and live visibility.
- Default test accounts live in `.env.test.local`.
- Primary account, admin: `admin@example.com` / `testtest1234`
- Primary account, organiser: `john@example.com` / `testtest1234`
- Primary account, player: `player1@example.com` / `testtest1234`
- Primary account, membership player: `memberbenefits@example.com` / `testtest1234`
- Prefer reusing stable test fixtures instead of creating throwaway data every run.
- If you create temporary data, clean it up or clearly rename/inactivate it before finishing.

## Recommended reusable fixtures

Create or reuse these under `john@example.com` in the `@example.com` partition:

- `Open test series`: active series with an open next event and available spots.
- `Waitlist test series`: active series whose next event is full but whose waiting list still has room.
- `Membership test series`: active series with series membership enabled plus default membership start/end and auto-paid values configured.
- `History test series`: series with at least one completed or cancelled event and at least one lockable event in the event history view.

## Core regression suites

### F01. Authentication, routing, and partition guardrails

- [ ] Logged-out visitor opening `/` is sent to the login experience.
- [ ] `admin@example.com` signs in and lands on `/dashboard` without permission errors.
- [ ] `john@example.com` signs in and lands on `/dashboard` without permission errors.
- [ ] `player1@example.com` signs in and lands on `/dashboard` without permission errors.
- [ ] `memberbenefits@example.com` signs in and lands on `/dashboard` without permission errors.
- [ ] Admin can open `/admin/organisers`, `/admin/players`, `/profile`, and return to `/dashboard`.
- [ ] Organiser can open `/organiser/players`, `/profile`, and return to `/dashboard`.
- [ ] Player can open `/profile` and return to `/dashboard`.
- [ ] Organiser and players only see `@example.com` sessions, events, and people.
- [ ] Admin can still see both test-partition and live data where intended.
- [ ] `/logout` signs the current user out and returns to `/` cleanly.

### F02. Admin organiser management

- [ ] Admin opens `Manage organisers` and sees `Registered organisers` populated with `john@example.com`.
- [ ] Active pending organisers section loads without permission or runtime errors.
- [ ] Inactive organiser sections load without permission or runtime errors.
- [ ] Admin can edit `john@example.com`, save, and refresh without the organiser disappearing from `Registered organisers`.
- [ ] If a safe pending organiser fixture exists, admin can inactivate it and reactivate it from the inactive section.
- [ ] Registered organisers remain canonical registered users after admin edits; no UI regression pushes them back into a pending-only path.

### F03. Admin and organiser player management

- [ ] Admin opens `Manage players` and sees both `Self-registered players` and `Organiser private players`.
- [ ] Organiser opens `Manage players` and sees both `Your private players` and `Registered players`.
- [ ] Organiser can create a new private player fixture and it appears in `Your private players`.
- [ ] Organiser can edit that private player's display name and skill level.
- [ ] Admin can see that organiser private player in the organiser-specific private-player section.
- [ ] Admin can edit the same private player.
- [ ] Admin can inactivate and reactivate a safe player fixture from the inactive sections.
- [ ] Organiser can still see inactive registered and private players as historical read-only entries.
- [ ] Self-registered players are not duplicated inside organiser private-player sections.
- [ ] Organiser cannot remove or fully edit self-registered players from organiser player management.

### F04. Series creation, editing, and visibility

- [ ] Admin can create a new series owned by `john@example.com`.
- [ ] Organiser can create a new series they own.
- [ ] Organiser cannot see or edit series they do not own.
- [ ] Editing a series allows changing `nextGameOn`, waiting-list capacity, prices, and membership defaults.
- [ ] Default membership start date saves correctly at the series level.
- [ ] Default membership end date saves correctly at the series level.
- [ ] Default membership auto-paid-until date saves correctly at the series level.
- [ ] Editing `nextGameOn` updates the active next-event state as expected.
- [ ] Deleting a series uses inactivation behavior rather than destructive deletion.
- [ ] Inactivated series disappear from normal player discovery lists.

### F05. Organiser approval gate

- [ ] As `memberbenefits@example.com`, dashboard shows organiser approval status for `john@example.com`.
- [ ] Unapproved player can request organiser approval.
- [ ] Organiser sees the approval request and can approve it from the dashboard.
- [ ] Approved player now sees the organiser's events and can use registration flows.
- [ ] Unapproved players cannot view or join the organiser's events.
- [ ] Organiser cannot manually add an unapproved registered player to an event.

### F06. Registration, payment reference, and organiser confirmation

- [ ] Approved player can register into an open event in `Open test series`.
- [ ] Registered player appears in the event list and their own registration is pinned to the top of their player view.
- [ ] Player can enter or update a payment reference.
- [ ] Organiser can see that payment reference on the registration row.
- [ ] Organiser can click `Confirm`, and the row shows `Paid` plus `Received`.
- [ ] Organiser can undo confirmation and re-confirm without breaking the row state.
- [ ] Organiser or admin can remove any registration.
- [ ] Player can remove themself from the same event.
- [ ] Registration ordering for other players still follows registration time ascending.

### F07. Waiting list behavior

- [ ] In `Waitlist test series`, an additional approved player sees `Join waiting list` instead of `Register`.
- [ ] Waiting-list player appears with waiting-list status, not registered status.
- [ ] Waiting-list player does not see player-paid controls.
- [ ] Organiser does not see the payment confirmation control for waiting-list rows.
- [ ] Removing a registered player above the queue promotes the earliest waiting-list player automatically.
- [ ] Promotion follows FIFO order.
- [ ] Once promoted, the player can then use payment reference and confirmation flows normally.

### F08. Series membership and auto-registration

- [ ] Approved player can request series membership on `Membership test series`.
- [ ] Organiser can approve that membership request from the dashboard.
- [ ] Membership panel displays the effective start date, end date, and auto-paid-until date.
- [ ] Default membership start date uses the organiser approval date unless an organiser-set series default overrides it.
- [ ] Organiser can override start date, end date, and auto-paid-until date for a specific member.
- [ ] Player can toggle `Skip next event` and undo that skip.
- [ ] Creating the next event auto-registers active members before any roster-copy logic runs.
- [ ] Membership auto-registration stops for events after the configured end date.
- [ ] Membership end date does not remove the player from already-created future events.
- [ ] If the event date is on or before the effective auto-paid-until date, the auto-created registration starts with both `playerPaid` and `organiserPaid` set to true.

### F09. Event history and locking

- [ ] `View all events` opens `/sessions/view?id=...` for a series.
- [ ] Event history lists events newest first.
- [ ] Organiser can mark an event as locked and unlock it again.
- [ ] Locked events block registration changes and payment changes.
- [ ] Locking warns before closing an event that still has unconfirmed payments.
- [ ] Organiser can still inspect participant and payment state from the history screen.
- [ ] Completed and cancelled event statuses remain visible in history.
- [ ] Dashboard only shows `Create next event` when there is no open next event.

### F10. Profile, stats, and notifications

- [ ] Profile loads for admin, organiser, and player without permission errors.
- [ ] Player can edit display name and skill level, save, refresh, and see the values persist.
- [ ] Organiser can view games-played stats in profile.
- [ ] Player can view games-played-by-organiser table in profile.
- [ ] Telegram notification settings can be enabled, saved, and reloaded without drift.
- [ ] `Send test Telegram` queues successfully when Telegram is configured.
- [ ] Email notifications remain hidden when the email-notifications feature flag is off.

## Targeted regression add-ons

Run these when you touch the corresponding feature area.

### X01. Identity linking and canonical account cleanup

- [ ] Seed a stale `managedUsers/{email}` organiser record for `john@example.com`, sign in, and confirm the registered organiser path still wins.
- [ ] After organiser sign-in or admin organiser save, stale `managedUsers/{email}` cleanup removes the redundant managed record.
- [ ] Admin sign-in does not recreate a `players/{uid}` record for an admin account.
- [ ] Registered organiser still appears in `Registered organisers` after stale managed-doc cleanup.

### X02. Email change and auth-profile recovery

- [ ] Using an `@example.com` account, change the email to another safe `@example.com` address and confirm the direct test-user path works.
- [ ] Refresh profile state and confirm `users/{uid}` email stays in sync with Firebase Auth.
- [ ] Sign out and sign back in with the new email.
- [ ] Revert the test account back to its original email before finishing.
- [ ] If working on non-example flows, verify the recent-login prompt and verification-link messaging are correct.

### X03. Notification delivery

- [ ] Organiser Telegram notification preference changes persist.
- [ ] Approval request event queues an organiser notification.
- [ ] Player registration event queues an organiser notification.
- [ ] Player self-removal event queues an organiser notification.
- [ ] Payment reference update queues an organiser notification.
- [ ] New event creation queues the relevant player notification when enabled.

### X04. Test-partition isolation

- [ ] `@example.com` users cannot see live users, live sessions, or live events.
- [ ] Non-`@example.com` users cannot see `@example.com` sessions or identities.
- [ ] Admin can still administer both partitions without role drift or permission errors.
