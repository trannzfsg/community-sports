# To-Do List


- [ ] Admin user exists in firestore players collection. They should be removed. The one currently in players collection is tranzha83@gmail.com. Also make sure when an admin user logs in, it doesn't get auto added to players collection.
- [ ] We've fixed this for players, now we need to fix for organisers accounts too - Unify managed + registered identities into a single canonical account path: add server-side login linker to merge legacy email-keyed records into `users/{uid}` and migrate linked data (session series owned by organiser), stop recreating managed docs for registered users, and validate with `@example.com` sign-ins.
- [ ] Recheck whether registered organisers are showing in the registered organiser section in admin user login, manage organiser screen. They didn't show before maybe due to the previous bug.
- [ ] Create a player test account (player1@example.com/testtest1234) and store in .env.test.local file.
- [ ] Go through TODO_COMPLETED.md, analyse key features built, then build up TESTING.md using @example.com users. Also build up a TESTING_SMOKE.md using @example.com users for critical user flows (login, registration, organiser operating events and player operating registration/payment). 
- [ ] Add to AGENTS.md: for small changes, execute TESTING_SMOKE.md automatically after deployment; for major feature changes, execute TESTING.md for full feature testing.

- [ ] **Integration with whatsapp - parked: when ready, execute [WHATSAPP_INTEGRATION_PLAN.md](C:/github/community_sports/community_sports/WHATSAPP_INTEGRATION_PLAN.md)**
  - [x] Stop implementation and produce a concrete implementation plan covering setup requirements, cost model, and test strategy.
  - [ ] 1 button in a session event, for organiser to post the registered players names list into a specific whatsapp group message. The whatsapp group should be configurable (optional) for each session series.
  - [ ] Every time a player get registered into an event, or removed, in anyway, automatically send the updated list as above into the whatsapp group.
  - [ ] Stop implementation, discuss and find out the simplest way to catch whatsapp messages and update player list. For example, is it possible to have a bot listening to whatsapp group @ messsages, e.g. "@sports-tran add me" which triggers a player registration in the active event linked to the group. 

- [ ] App Check rollout (parked): when ready, execute [APP_CHECK_ROLLOUT_PLAN.md](C:/github/community_sports/community_sports/APP_CHECK_ROLLOUT_PLAN.md) in staged monitor-first mode.
  
