# Smoke Test Checklist (`@example.com`)

Use this checklist after every small deployment. Keep it short, but do not skip the final browser pass on [sports.tranzha.com](https://sports.tranzha.com).

## Accounts

- Admin: `admin@example.com` / `testtest1234`
- Organiser: `john@example.com` / `testtest1234`
- Player: `player1@example.com` / `testtest1234`
- Membership player: `memberbenefits@example.com` / `testtest1234`

## Preconditions

- Reuse an active `@example.com` series owned by `john@example.com` with an open next event.
- Reuse an active membership-enabled `@example.com` series owned by `john@example.com`.

## Critical flow

- [ ] `admin@example.com` can sign in, land on `/dashboard`, and open both `Manage organisers` and `Manage players`.
- [ ] `john@example.com` can sign in, land on `/dashboard`, see the persistent menu, open `Approvals`, open `Manage players`, and open `/profile`.
- [ ] `player1@example.com` can sign in, land on `/dashboard`, open the mobile/compact menu if needed, and open `/profile`.
- [ ] `memberbenefits@example.com` can request organiser approval if still unapproved, or already shows an approved state if the fixture is pre-approved.
- [ ] `john@example.com` can approve that organiser request from the dedicated approvals page when needed.
- [ ] An approved player can register into the open event.
- [ ] That player can enter a payment reference.
- [ ] `john@example.com` can see the registration, see the payment reference, and click `Confirm` so the row shows `Received`.
- [ ] The player can leave the event when allowed, or the organiser can remove the player when the cancellation cutoff blocks self-removal, and the registration list updates immediately without permission errors.
- [ ] Approved player can open the series membership panel and either see the organiser-contact helper text or the expected active membership state, with no in-app request-membership button.
- [ ] `john@example.com` can open `View all events` for a series without runtime or permission errors.

## Guardrails

- [ ] No duplicate identity is created for the same email after sign-in.
- [ ] Admin and organiser accounts do not regress to player role.
- [ ] `@example.com` users stay inside the test partition.
