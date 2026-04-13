# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Principles

These rules apply to all work in this repository and cannot be skipped:

1. **Always test in a browser before marking work done.** After implementing any change, verify the result in a live browser session. Do not claim something is working without having observed it working.

2. **Always review code for consistency and readability.** Before finishing, check that new code follows the existing patterns in the codebase so other Claude sessions and agents can easily understand it.

3. **Always plan before implementing — then critically review the plan.** Write out the intended approach first. Then challenge it: does it make sense? Does it miss major issues? Are there security concerns? Is it easy to maintain? Only proceed once the plan passes that review.

4. **Always confirm product and architecture assumptions with the user.** Do not assume and proceed on decisions related to product behaviour or major technical architecture. Stop and ask.

5. **Always add logs and traces through execution steps, and read them when debugging.** If you find yourself going in circles on an issue, stop. Check whether there are conflicting product requirements before continuing.

6. **Always think critically about requests before starting.** If a request doesn't make sense, conflicts with a prior decision, or has unclear implications, stop and ask immediately rather than guessing.

7. **Always search memory for known errors before investigating new ones.** Check existing error memory for a matching solution first. If a new solution is found, record it in memory so future sessions can reuse it.

8. **Always maintain TODO.md.** Before starting any task, add it to the top of `TODO.md` as an incomplete item. If the task has multiple steps or it makes sense to break it down during planning, add sub-items. Mark each item complete once done. If multiple tasks are requested at once, add all of them before starting. Once a main task is completed (means all subtasks should be completed too), move it to TODO_COMPLETED.md for future reference.

9. **Always commit and merge to main** After finishing any task, commit and merge to main. If the task has multiple steps or it makes sense to break it down, commit after each step, and push to main as long as the user impacts (including features, performance and security) don't go backward. Also always deploy to firebase and GCP.

## Commands

### Frontend (`web-app/`)
```bash
npm run dev        # Start Next.js dev server (port 3000)
npm run build      # Build static export for Firebase Hosting
npm run lint       # Run ESLint
npm test           # Run all tests (Node.js native test runner with --experimental-strip-types)
```

To run a single test file:
```bash
node --experimental-strip-types --test tests/auth-profile.test.ts
```

### Firebase Functions (`functions/`)
```bash
npm run build      # Compile TypeScript
npm run lint       # ESLint check
npm run serve      # Build + start Firebase emulators (functions only)
```

### Firebase Deployment
```bash
firebase deploy --only hosting                              # Deploy static frontend
firebase deploy --only firestore:rules,firestore:indexes   # Deploy Firestore rules/indexes
```

## Architecture

### Overview

Community Sports is a static Next.js app (client-side only, no SSR) backed entirely by Firestore. Firebase Functions exist as a scaffold but are **not deployed** — the app works fully as a frontend-only SPA. Firebase Data Connect (PostgreSQL) is configured but **unused**.

### Frontend (`web-app/src/`)

- **`app/`** — Next.js App Router pages, organized by role: `admin/`, `organiser/`, `sessions/`, `dashboard/`, `login/`, `profile/`
- **`lib/`** — All business logic and Firebase queries. Key files:
  - `firebase.ts` — SDK initialization
  - `auth-profile.ts` — Role resolution on login; checks for pre-assigned pending user records
  - `flow-access.ts` — Permission checks used across pages
  - `session-series.ts` — Session series CRUD (inactivation, not deletion)
  - `dashboard-event-state.ts` — Full/waiting-list state logic
  - `payments.ts` — Payment mirroring between `registrations` and `payments` collections
  - `admin-player-flows.ts` — Admin operations on the player directory
- **`components/`** — Shared UI components (date picker, searchable player select)

Path alias: `@/*` maps to `src/*` (defined in `tsconfig.json`).

### Firestore Data Model

Core collections:
- `users` — Unified user model (manual + self-registered). Email is unique and user-editable.
- `players` — Searchable player directory. Organisers can create name-only private players.
- `sessions` — Recurring session series (inactivated, not deleted).
- `sessionEvents` — Dated occurrences of a session series.
- `registrations` — Player registrations for events. Has `playerPaid` and `organiserPaid` flags; both true = paid.
- `payments` — Mirrors effective payment state derived from registrations.

### Roles and Access

Roles: **admin**, **organiser**, **player**. Enforced in both `firestore.rules` (~350 lines) and `lib/flow-access.ts`.

- **Admin**: Full access to all collections.
- **Organiser**: Manages only their own sessions; sees registrations for their events; can view skill levels.
- **Player**: Reads active sessions/events; registers self; toggles own `playerPaid` flag (only when registered, not on waiting list).

On self-registration, if a `users` doc with a matching email exists with a pre-assigned role (`pending` state), that role is preserved; otherwise defaults to `player`.

### Key Behavioural Details

- **Waiting list**: Events that reach capacity put additional registrants on a waiting list (FIFO). Waiting-list players cannot mark themselves as paid.
- **Series inactivation**: "Deleting" a series sets it inactive, preserving event/registration history. Inactive series are hidden from players.
- **Organiser-private players**: Players created by an organiser are visible only to that organiser until the player self-registers.
- **Skill levels**: Australian-tier levels; visible to organisers only, not players.

### Environment Setup

The frontend requires `web-app/.env.local` with Firebase API keys. See `web-app/.env.local.example` for the required variables.

### Testing

Unit tests live in `web-app/tests/` and use the Node.js native test runner with `--experimental-strip-types` (no transpile step). Manual test scenarios are documented in `TESTING.md` and `HUMAN_TEST_SCENARIOS.md`.
