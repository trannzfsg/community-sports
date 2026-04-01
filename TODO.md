# Consolidated To-Do List

#### Next Items
- [x] Self-registered players can view all session series and events. The ones that's full and they're not registered to, should be greyed out in colour and state not available. The ones that they're in should be highlighted in colour and state going. The ones that they're not registered yet, and not full yet, should be highlighted in colour and state available to join.
- [x] Add human test scenarios in `HUMAN_TEST_SCENARIOS.md`.
- [x] Build a lightweight automated test suite for registration/waiting-list logic.
- [x] Run lint, build, and automated tests successfully.

#### Firebase Setup
- [x] Create/init Firebase project in the project folder.
- [x] Configure Firestore database with the following collections:
  - [x] `users`: Store player/organiser details.
  - [x] `players`: Store shared self-registered players plus organiser-private manual players.
  - [x] `sessions`: Store session series definitions.
  - [x] `sessionEvents`: Store dated occurrences of a session series.
  - [x] `payments`: Record session payments.
- [x] Connect your subdomain to Firebase Hosting.
  - [x] Ensure SSL configuration is enabled.

#### Backend Development
- [ ] Deploy the backend to Firebase Functions. (Deferred by product decision: app works fine without backend deployment for now; only revisit if truly needed.)

#### Final Checks and Review
- [ ] Test the full app workflow:
  - [ ] Player registration, login, and session booking.
  - [ ] Organiser session management and payment tracking.
- [x] Optimize Firestore queries to fit free-tier limits.
- [x] Finalize and document the project structure for potential future scalability.

### Completed
- [x] Discord integration completed
- [x] Consolidate the roles and create corresponding markdown files with consolidated rules for each role as future references.
- [x] Outline, assign, and prioritize tasks like research, devops, hosting, and expert roles as needed.
- [x] Mark newly added roles or rules into their respective markdown files when created.
- [x] Rename project references from badminton_community_software to community_sports where applicable.
- [x] Initialize Firebase environment template files in the project.
- [x] Fill Firebase config values into environment files.
- [x] Set up frontend framework in the project (`web-app` exists as Next.js app).
- [x] Install and configure Firebase SDK scaffold in the frontend.
- [x] Initialize Firebase Functions project structure.
- [x] Set up initial Firestore security rules scaffold.
- [x] Build initial UI page scaffolds for login and dashboard.
- [x] Implement role-aware auth scaffolding for player / organiser / admin.
- [x] Add organiser-isolated and admin-wide Firestore access rules scaffold.
- [x] Write initial Firebase Functions endpoints (`health`, `rolesInfo`).
- [x] Commit initial Firebase/role scaffold into git.
- [x] Add session schema fields including `dayOfWeek`, `startAt`, `endAt`, `firstSessionOn`, `defaultPriceCasual`, and `typeOfSport`.
- [x] Build initial session creation flow for organiser/admin users.
- [x] Update dashboard to read and display Firestore-backed sessions.
- [x] Fix dark button/link contrast issue caused by global anchor styling.
- [x] Add `nextGameOn` with automatic next-occurrence default based on session day of week.
- [x] Allow organiser/admin to manually edit `nextGameOn` in the system.
- [x] Change `nextGameOn` auto-roll-forward cutoff from midnight to the session start time.
- [x] Preserve manually delayed `nextGameOn` values unless the computed future schedule catches up or passes them.
- [x] Switch app date/calendar locale hints to Australian English (`en-AU`).
- [x] Replace native date inputs on session forms with a custom Monday-first date picker.
- [x] Convert frontend deployment to a static-export Firebase Hosting path that works without Blaze.
- [x] Deploy the frontend to Firebase Hosting from local Firebase CLI.
- [x] Remove the display of "starts from" from player view.
- [x] Allow player to register for a session.
- [x] Allow player to indicate whether they have paid for the session or not.
- [x] Allow organiser to confirm whether a player has paid or not.
- [x] Ensure organiser confirmation can overwrite the player's paid flag, and if organiser marks paid, both organiser/player paid state are treated as paid.
- [x] Allow organiser to register players manually.
- [x] Allow both player and organiser to see the full list of registered players and both paid flags (player flag and organiser flag).
- [x] Refactor app logic so `sessions` represent session series, while dated occurrences are stored as `sessionEvents`.
- [x] Allow organiser to copy the list of players from the last occurrence of the same session series into the next occurrence as a default list via a series-level flag.
- [x] Configure and use the `payments` collection to mirror effective payment state per registration/event.
- [x] Replace organiser free-text add-player with a searchable player dropdown that includes self-registered players and organiser-private manual players.
- [x] Allow organiser to create new name-only players from that dropdown, visible only to the organiser who created them.
- [x] Improve event controls and registration removal.
- [x] Current organiser and player logins are showing "not enough permission" when viewing dashboard; fix the ownership/permission model so their dashboards work.
- [x] Each session series must have an owner who is an organiser. Backfill the 2 existing session series so their owner is the only organiser account.
- [x] Only players can be added to a session event. Organiser/admin should not appear as players unless they have a player profile.
- [x] Remove organiser/admin entries currently present as players in session events.
- [x] Organiser should be able to add/edit/delete their own session series, just like admin, except admin can perform these against any series owned by any organiser, and organiser cannot see session series doesn't belong to them.
- [x] Fully registered events should be highlighted to organiser as full. Not fully registered events should be highlighted too in different colour.
