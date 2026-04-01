# Consolidated To-Do List

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

### General Tasks
- [ ] Review and refine role documents as project-specific roles emerge.

### Community Sports Software Development

#### Firebase Setup
- [x] Create/init Firebase project in the project folder.
- [ ] Configure Firestore database with the following collections:
  - `users`: Store player/organiser details.
  - `sessions`: Track session details like time, location, availability, etc.
  - `payments`: Record session payments.
- [ ] Connect your subdomain to Firebase Hosting.
  - Ensure SSL configuration is enabled.

#### Frontend Development
- [ ] Build essential UI pages:
  - Login/Register page for players and organisers (Firebase Auth).
  - Dashboard for participants to view session availability.
  - Dashboard for organisers to manage sessions and tick payments.
- [ ] Deploy the frontend to Firebase Hosting.
  - Use GitHub Actions for CI/CD workflows.

#### Backend Development
- [ ] Implement backend logic via Firebase Functions:
  - Availability checks for sessions.
  - Payment tracking logic.
- [ ] Write Firebase Functions to handle organiser and player requests.

#### Final Checks and Review
- [ ] Test the full app workflow:
  - Player registration, login, and session booking.
  - Organiser session management and payment tracking.
- [ ] Optimize Firestore queries to fit free-tier limits.
- [ ] Finalize and document the project structure for potential future scalability.
