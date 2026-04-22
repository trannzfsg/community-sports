# Human Test Scenarios

Use this file as the narrative companion to `TESTING.md`. Each scenario groups the most important user journeys and points back to the canonical checklist sections so AI and human runs stay aligned.

## 1. Visitor to signed-in user

- Actors: logged-out visitor, `player1@example.com`
- Covers: `F01`, `F10`
- Pass signal: login, routing, profile loading, and logout all work without permission or runtime errors.

## 2. Admin manages organisers and players

- Actors: `admin@example.com`, `john@example.com`
- Covers: `F02`, `F03`, `X01`, `X04`
- Pass signal: admin can manage organisers and players, registered organisers stay canonical, and test/live partition visibility remains correct.

## 3. Organiser manages private and registered players

- Actors: `john@example.com`
- Covers: `F03`
- Pass signal: organiser can create and edit private players, can view registered players separately, and cannot accidentally regain write access over self-registered people.

## 4. Player approval to event registration

- Actors: `memberbenefits@example.com`, `john@example.com`
- Covers: `F05`, `F06`
- Pass signal: unapproved player requests approval, organiser approves, player can then register and payment-reference flow works end to end.

## 5. Waiting list promotion

- Actors: two approved player fixtures plus `john@example.com`
- Covers: `F07`
- Pass signal: a full event accepts waiting-list joins, payment controls stay hidden on the waitlist, and FIFO promotion works after a removal.

## 6. Membership-driven recurring registration

- Actors: `memberbenefits@example.com`, `john@example.com`
- Covers: `F08`
- Pass signal: series membership request, approval, date overrides, skip-next-event, and auto-paid auto-registration all behave as configured.

## 7. Organiser operates the series lifecycle

- Actors: `john@example.com`, optionally `admin@example.com`
- Covers: `F04`, `F09`
- Pass signal: series create/edit/inactivate flows work, next-event controls behave correctly, and event history plus lock/unlock remain usable.

## 8. Profile, email, and notification recovery

- Actors: any safe `@example.com` account
- Covers: `F10`, `X02`, `X03`
- Pass signal: profile saves persist, email-change recovery stays in sync, and Telegram notification tests plus event-triggered notifications queue correctly.
