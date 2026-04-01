# Community Sports Architecture

## Current Model

### Users
Real-world accounts stored in `users` with one record per person.

Roles:
- `player`
- `organiser`
- `admin`

### Players Directory
`players` is a convenience directory for event registration.

Contains:
- self-registered players (shared / visible to organisers)
- organiser-private manual players (name-only allowed)

### Session Series
Stored in `sessions`.

A session series defines a recurring activity:
- organiser owner
- organiser display name
- sport type
- day of week
- venue
- start/end time
- capacity
- default casual price
- next game date
- roster-copy behavior

### Session Events
Stored in `sessionEvents`.

A session event is a dated occurrence of a session series.

Contains:
- event date
- organiser owner
- organiser display name
- booked count
- copied series metadata snapshot

### Registrations
Stored in `registrations`.

Registrations belong to a specific `sessionEventId`.

Contains:
- player identity
- player email
- player paid flag
- organiser paid flag
- created timestamp

### Payments
Stored in `payments`.

This is currently a mirrored bookkeeping collection derived from registration/payment state, not a real external payment gateway integration.

## Deployment

### Frontend
- Next.js static export
- deployed to Firebase Hosting from local CLI only
- custom domain: `sports.tranzha.com`

### Backend
- Firebase Functions scaffold exists
- deployment currently blocked until project is upgraded to Blaze

## Important Operational Rules
- Session series must always have an organiser owner
- Organisers can only see/manage their own series
- Admin can manage any organiser-owned series
- Only players should be registered to events
- Series deletion is implemented as inactivation, not hard deletion

## Known Constraint
Without Blaze, any true server-side scheduled jobs / privileged backend automation should be deferred or handled manually.
