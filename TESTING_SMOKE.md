# Smoke Test Checklist (`@example.com`)

Use this checklist after every small deployment.

## Accounts
- Admin: `admin@example.com` / `testtest1234`
- Organiser: `john@example.com` / `testtest1234`
- Player: `player1@example.com` / `testtest1234`

## Critical Flows
- [ ] Login works for admin, organiser, and player (lands on dashboard without permission errors).
- [ ] Admin can open Manage organisers and Manage players pages without Firestore permission errors.
- [ ] Organiser can open Manage players page and dashboard without Firestore permission errors.
- [ ] Player can see organiser approval section on dashboard and request approval.
- [ ] Organiser can approve that player request on dashboard.
- [ ] Approved player can see organiser events and register.
- [ ] Organiser sees player registration in event list and can remove it.
- [ ] Player can leave event and organiser list updates correctly.
- [ ] Profile page loads for all three roles without permission errors.

## Guardrails
- [ ] No duplicate user identities are created for the same email after sign-in.
- [ ] No role regression (organiser/admin must not become player).
