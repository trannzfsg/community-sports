# To-Do List

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
  
