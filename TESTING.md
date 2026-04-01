# Testing Checklist

## Auth
- [ ] Logged-out user sees login on `/`
- [ ] Player login lands on dashboard
- [ ] Organiser login lands on dashboard
- [ ] Admin login lands on dashboard
- [ ] `/logout` signs the user out and returns to `/`

## Session Series
- [ ] Admin can create series for an organiser owner
- [ ] Organiser can create their own series
- [ ] Organiser cannot see other organisers' series
- [ ] Admin can edit any series
- [ ] Organiser can edit only their own series
- [ ] Inactivating a series hides it from active dashboard lists

## Events
- [ ] Create next event works when no open next event exists
- [ ] Open next event hides the create-next-event button
- [ ] Full event shows full styling for organisers
- [ ] Player sees joined / available / not available states correctly

## Registrations
- [ ] Player can register self
- [ ] Player can leave self
- [ ] Organiser/admin can remove any registration
- [ ] Self is pinned to top of registration list
- [ ] Others remain ordered by registration time ascending

## Player Directory
- [ ] Self-registered players appear in searchable picker
- [ ] Organiser-private manual players appear only for owner organiser
- [ ] Admin/organiser accounts do not appear in picker
- [ ] Selecting or creating a player adds them immediately to the event

## Payments UI
- [ ] Player paid button label is correct
- [ ] Organiser confirmation label is correct
- [ ] No `effective: pending` badge remains in UI
