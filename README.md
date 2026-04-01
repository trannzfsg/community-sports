# Community Sports

## Overview
This project aims to create a software solution for managing community sports sessions, players, organisers, payments, and communications. The current MVP is oriented around badminton, but the project structure should stay flexible enough to support broader community sports workflows over time.

## MVP Summary
### Core Features
1. Player and Organiser Roles:
   - Organisers handle session management, payments, and player notifications.
   - Players can view session details, check availability, and make payments.

2. Payment Handling:
   - Differentiated pricing for session types (for example, long-term members vs casual players).
   - Payment methods including PayID.

3. Sessions:
   - Multiple sessions weekly at varying times and locations.
   - Session status checks (full / available spots).
   - Bookings to guarantee spots.

4. Notifications System:
   - Payment reminders for players.
   - Alerts for organisers on non-payments.

5. User Management:
   - Organisers, players, and admins account logins.
   - Messaging integrations such as WhatsApp, alongside a web app for broader accessibility.

6. Logging:
   - Logs for errors/issues to avoid repeating mistakes.
   - Memory-based logs for session summaries.

## Tech Stack
- Authentication: Firebase Authentication
- Database: Firebase Firestore
- Hosting: Firebase Hosting
- Frontend: Next.js
- Backend: Firebase Functions (TypeScript)

## Firebase Environment Setup
### Frontend (`web-app/.env.local`)
Fill in:
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
Fill in:
```env
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_DATABASE_URL=
FIREBASE_WEB_API_KEY=
```

You can get these from Firebase Console > Project settings > General > Your apps.

## Directory Structure
```text
/community_sports
|-- /.git
|-- /.firebaserc
|-- /functions
|-- /public
|-- /web-app
|-- firebase.json
|-- firestore.rules
|-- README.md
```
