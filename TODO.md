# To-Do List

- [ ] Firebase client config and API key security audit
  - [x] Scan repo for hardcoded Firebase API keys and remove any debug artifacts that expose concrete keys in tracked source files.
  - [x] Document why Firebase web API keys are public identifiers (not secrets) and identify real risk controls (Auth, Firestore Rules, App Check, and API restrictions).
  - [ ] Apply Google Cloud API key restrictions for production and staging origins, then verify auth + Firestore flows still work after restrictions.
  - [x] Add App Check rollout plan (and optional enforcement) for web app + callable/onRequest functions that depend on browser clients.

- [ ] **Integration with whatsapp**
  - [x] Stop implementation and produce a concrete implementation plan covering setup requirements, cost model, and test strategy.
  - [ ] 1 button in a session event, for organiser to post the registered players names list into a specific whatsapp group message. The whatsapp group should be configurable (optional) for each session series.
  - [ ] Every time a player get registered into an event, or removed, in anyway, automatically send the updated list as above into the whatsapp group.
  - [ ] Stop implementation, discuss and find out the simplest way to catch whatsapp messages and update player list. For example, is it possible to have a bot listening to whatsapp group @ messsages, e.g. "@sports-tran add me" which triggers a player registration in the active event linked to the group. 
  
