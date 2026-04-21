# To-Do List

- [ ] Change status in events from "Paid" "OK" to "Paid" "Received".
- [ ] Display start date of membership for each player. Then allow organiser to specify an end date for session series membership. If the end date is not specified, the members will always be members until organiser cancels them. If the end date is specified, the membership automatically ends after the end date. Also allow organiser to specify whether players are automatically "paid" and "received" status when entering into membership - as some session series allow bulk pre-payment until a certain date, to guarantee registration. 
- [ ] Notifications. The organiser needs to have notifications. This is needed for player requesting approval, player register to event, player remove themself from event, player enter pay reference. While a website cannot post notifications direction onto the phone, what's the cheapest way to enable notifications through another tool (e.g. discord or facebook messenger or something even simpler)? Whatsapp might be the best, but it costs a lot. I'm looking for cheapest long term options. Plan this out and confirm with me on next steps.
  - [x] Drafted options and rollout plan in [NOTIFICATIONS_OPTIONS_PLAN.md](C:/github/community_sports/community_sports/NOTIFICATIONS_OPTIONS_PLAN.md).
  - [x] Replace the Architecture TBAs in [NOTIFICATIONS_OPTIONS_PLAN.md](C:/github/community_sports/community_sports/NOTIFICATIONS_OPTIONS_PLAN.md) with the updated server-side trigger and data-model design.
  - [x] Add profile-managed notification preferences for email and Telegram.
  - [x] Scaffold Firebase Functions notification event generation for approval, registration, payment, and next-event triggers.
  - [x] Add actual Telegram delivery from queued notification events, with private-chat-first validation in profile settings.
  - [x] Seed the provided Telegram chat id for `tranzha83+test@gmail.com` and verify end-to-end delivery.
  - [x] Add a small profile button to send a Telegram test notification.
  - [x] Finish email notification delivery wiring and document the required SMTP configuration.
- [ ] Admin user exists in firestore players collection. They should be removed. The one currently in players collection is tranzha83@gmail.com. Also make sure when an admin user logs in, it doesn't get auto added to players collection.
- [ ] We've fixed this for players, now we need to fix for organisers accounts too - Unify managed + registered identities into a single canonical account path: add server-side login linker to merge legacy email-keyed records into `users/{uid}` and migrate linked data (session series owned by organiser), stop recreating managed docs for registered users, and validate with `@example.com` sign-ins.
- [ ] Recheck whether registered organisers are showing in the registered organiser section in admin user login, manage organiser screen. They didn't show before maybe due to the previous bug.
  - [x] Added fallback merge logic so registered organisers appear even when no `managedUsers` record exists.
- [x] Create a player test account (player1@example.com/testtest1234) and store in .env.test.local file.
- [ ] Go through TODO_COMPLETED.md, analyse key features built, then build up TESTING.md using @example.com users. Also build up a TESTING_SMOKE.md using @example.com users for critical user flows (login, registration, organiser operating events and player operating registration/payment). Consolidate HUMAN_TEST_SCENARIOS.md and TESTING.md, both should be used for both AI and human testing.
- [x] Add to AGENTS.md: for small changes, execute TESTING_SMOKE.md automatically after deployment; for major feature changes, execute TESTING.md for full feature testing. 
- [x] Add to AGENTS.md: from now on, all changes needs to be implemented in its own git branch and tested thoroughly on local before merging to main and deploy to firebase, as we have real users already.

- [ ] **Integration with whatsapp - parked: when ready, execute [WHATSAPP_INTEGRATION_PLAN.md](C:/github/community_sports/community_sports/WHATSAPP_INTEGRATION_PLAN.md)**
  - [x] Stop implementation and produce a concrete implementation plan covering setup requirements, cost model, and test strategy.
  - [ ] 1 button in a session event, for organiser to post the registered players names list into a specific whatsapp group message. The whatsapp group should be configurable (optional) for each session series.
  - [ ] Every time a player get registered into an event, or removed, in anyway, automatically send the updated list as above into the whatsapp group.
  - [ ] Stop implementation, discuss and find out the simplest way to catch whatsapp messages and update player list. For example, is it possible to have a bot listening to whatsapp group @ messsages, e.g. "@sports-tran add me" which triggers a player registration in the active event linked to the group. 

- [ ] App Check rollout (parked): when ready, execute [APP_CHECK_ROLLOUT_PLAN.md](C:/github/community_sports/community_sports/APP_CHECK_ROLLOUT_PLAN.md) in staged monitor-first mode.
  
