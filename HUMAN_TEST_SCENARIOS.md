# Human Test Scenarios

These are end-to-end manual scenarios written from a real user point of view.

## 1. Logged-out visitor lands on the app
- Open `/`
- Confirm the login form is shown immediately
- Confirm there is no old MVP/helper text about hard-coded role assignment
- Try switching between **Sign in** and **Create account**

## 2. New player registers and edits profile
- Register a brand new player account
- Confirm the app lands on the dashboard
- Open **Profile**
- Confirm the player can edit their display name
- Confirm the player can set **Skill level**
- Save profile and refresh
- Confirm skill level persists

## 3. Player joins a session with available spots
- Sign in as a player
- Find a session whose next event is not full
- Confirm event state shows **available**
- Click **Register**
- Confirm the player appears in the registrations list
- Confirm state changes to **going**
- Confirm the player can toggle **Paid / Not paid**

## 4. Player joins a full session with waiting list space
- Use an event whose registered count equals capacity but waiting list still has space
- Confirm player-facing button says **Join waiting list**
- Join the event
- Confirm the player appears with status **Waiting list**
- Confirm player cannot see the player-paid toggle while waiting
- Confirm organiser-confirm button is also hidden for waiting-list players

## 5. FIFO waiting-list promotion
- Use an event with at least one waiting-list player
- Remove one registered player above them
- Confirm the first waiting-list player is automatically promoted to **Registered**
- Confirm order follows earliest registration first

## 6. Full event and waiting-list-full styling
- Check an event with open spots: organiser should see it as **open**
- Check an event that is full but waiting list still has room: organiser should see it as **full**
- Check an event with both event and waiting list full: organiser should see **waiting list full**
- For players, confirm cards show **going**, **waiting list**, **available**, or **not available** appropriately

## 7. Organiser manual player flow
- Sign in as organiser
- Add an existing self-registered player from the searchable picker
- Add a new manual name-only player from the picker
- Confirm the manual player is saved and available for future organiser use
- Confirm organiser can set/edit that manual player's skill level
- Confirm skill level appears in the event registration list for organisers

## 8. Organiser edit series
- Open **Edit series** for a series owned by the organiser
- Confirm the page loads without permission/runtime errors
- Change waiting list capacity and save
- Return to dashboard and confirm the updated value appears

## 9. Role integrity
- Confirm login/register flow no longer depends on hard-coded emails in the UI
- Confirm organiser/admin accounts are not filtered out by string-matching email hacks in the dashboard code path
- Confirm actual stored `users.role` drives access

## 10. Logout
- Open `/logout`
- Confirm session is cleared and the app returns to login
