# To-Do List

- [ ] Add inactive player segments to admin and organiser player management views. Admin can reactivate inactive players; organiser can view inactive players but cannot reactivate them.
- [ ] Implement a forget password functionality on login page. Only users with email/password auth can use this. Display proper error message for SSO users. Use firebase native functionalities for this.
- [ ] Add another section in profile page, allow user to change email address, this requires a firebase email link verification, which is the same process as self-registration (use firebase feature to do this). If user is using email/password auth, no further action is needed. Alert user that if they were using SSO, they'll be changed into email/password auth, and need to use forget password on login page to set a new password.
- [ ] All users with @example.com domain is test users. Find a good way to segregate them from other users. Admin user should be able to see all. Users with @example.com email domain should only be able to see other @example.com users, including sessions and events created by those users. Users with non @example.com emails should not be able to see any @example.com users or sessions/events created by those users. 

- [ ] **Integration with whatsapp**
  - [ ] Stop implementation, discuss and make a plan on how to implement this; what's required from whatsapp side and how to set it up; how much the cost will be; how to test it etc.
  - [ ] 1 button in a session event, for organiser to post the registered players names list into a specific whatsapp group message. The whatsapp group should be configurable (optional) for each session series.
  - [ ] Every time a player get registered into an event, or removed, in anyway, automatically send the updated list as above into the whatsapp group.
  - [ ] Stop implementation, discuss and find out the simplest way to catch whatsapp messages and update player list. For example, is it possible to have a bot listening to whatsapp group @ messsages, e.g. "@sports-tran add me" which triggers a player registration in the active event linked to the group. 
  
