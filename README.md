# Community Sports

## Overview
Community Sports is a Firebase-backed web app for managing recurring community sports series, dated session events, player registrations, and organiser payment confirmation.

The current MVP is badminton-first, but the data model supports broader sports workflows.

## Current Architecture

### Core Collections
- `users` — real user accounts and roles
- `players` — searchable player directory used for event registration
- `sessions` — recurring session series definitions
- `sessionEvents` — dated occurrences of a session series
- `registrations` — registrations tied to a specific event
- `payments` — mirrored payment bookkeeping records

### Roles
- **player** — can view all active series/events and register self
- **organiser** — owns and manages only their own series/events
- **admin** — can manage any organiser-owned series/events

## Deployment

### Frontend
- Next.js static export
- deployed to Firebase Hosting from local CLI
- live domain: `sports.tranzha.com`

### Backend
- Firebase Functions scaffold exists, but deployment is blocked until project is upgraded to Blaze

## Local Development

### Frontend
```bash
cd web-app
npm install
npm run dev
```

### Firebase Deploy (local only)
```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules,firestore:indexes
```

## Environment Setup
### Frontend (`web-app/.env.local`)
```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

### Backend (`functions/.env`)
```env
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_DATABASE_URL=
FIREBASE_WEB_API_KEY=
```

## Important Behavior
- Session series must always have an organiser owner
- Only players should be registered to events
- Inactivating a series preserves history instead of deleting it
- Organiser-private manual players remain visible only to the organiser who created them

## Supporting Docs
- `ARCHITECTURE.md`
- `TESTING.md`
- `TODO.md`
