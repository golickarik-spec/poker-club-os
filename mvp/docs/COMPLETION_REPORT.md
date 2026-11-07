# Completion report

Version 0.2.0: the CRM, club management, community and analytics work, added
to the existing Poker Club OS prototype (0.1.0) without rebuilding it.

One fact frames everything in this report. **The application has no server.**
What the brief calls "the backend" is a service layer (`src/platform`) that
runs in the same browser tab as the interface. Its permission checks are real
code, they are unit-tested, and they are the code a server would run. But in
this prototype a person with the browser's developer tools can read and change
the stored data directly. Wherever this report says "enforced", it means
"enforced by the service layer", not "enforced across a network". Nothing here
is production-ready and nothing here is described as such.

Sections follow the brief: A audit, B new features, C architecture, D demo
instructions, E test results, F outstanding issues, G implementation status.

## What was run

| Check | Result |
|---|---|
| TypeScript, strict (`npm run typecheck`) | clean |
| Unit and integration tests (`npm test`) | 146 of 146 pass |
| Browser journeys in headless Chromium (`npm run e2e`) | 135 of 135 checks pass: A 15, B 17, C 14, D 54, E 23, smoke 12 |
| Screen tour | 61 screen states opened at 1440×900 and 390×844, in English and Hebrew (244 page loads), each checked by script for untranslated message keys, sideways page overflow and runtime errors: none found. About forty of the screenshots were looked at by eye, and what that turned up was fixed. |

What was **not** run: any browser other than Chromium, any physical phone,
screen readers, load or performance tests, a clean `npm install` (the sandbox
has no registry access), and the app with its web fonts loaded (font requests
are blocked here, so every screenshot reviewed used the system fallback).

Journeys A and D play real hands, so their duration depends on the cards. Both
have time limits generous enough to have passed every run made for this
report, but a slow hand could in principle make one time out without the
product being at fault.

---

## A. Audit of the existing application

The full audit, with file and line references to the 0.1.0 baseline, is in
`docs/CRM_AUDIT.md`. Summary of the ten mandatory questions, before and after:

| # | Question | Before | After |
|---|---|---|---|
| 1 | Can players join private tournaments without authorization? | PARTIAL: registering was protected, watching was not, and private lobbies rendered for anyone | PASS (service layer) |
| 2 | Are membership permissions checked by the backend? | PASS (service layer) | PASS, extended to reads |
| 3 | Can a player follow a club without becoming a member? | FAIL: no follow concept | PASS |
| 4 | Can a club administrator approve members? | PASS | PASS |
| 5 | Is tournament registration tied to authenticated players? | PARTIAL: no real authentication | PARTIAL, unchanged |
| 6 | Can administrators access another club's data? | PARTIAL: writes refused, reads unguarded | PASS (service layer) |
| 7 | Is tournament history stored persistently? | PARTIAL: one browser, eight hours | PARTIAL, unchanged |
| 8 | Are player statistics calculated from actual game records? | PASS for players; analytics were a generated series | PASS for both |
| 9 | Are messaging and notifications already implemented? | PARTIAL: notifications only | PASS, in-app only |
| 10 | Are club profiles customizable? | PARTIAL | PASS |

Authorization problems fixed before any feature work:

1. A private tournament's tables can no longer be watched by opening them
   directly. `Runtime.attach` asks `canWatchTournament` and throws.
2. A private tournament's lobby, player list and results are not rendered for
   people who may not see it; they get a "Private tournament" page.
3. The club page shows non-members only what the club made public.
4. A seat request waiting for approval no longer holds a seat.
5. Club-private data is read only through functions that check the actor's
   permission in that club. Three architecture tests fail the build otherwise.

Two things the audit found that were not security problems but had to change:
analytics and plan usage read a generated series instead of records (replaced;
there is no stored analytic figure any more), and leaving a club deleted the
membership row, which left nothing to build a timeline from (replaced by an
event log).

## B. New features

**Relationships.** Registered user, follower, member and tournament
participant are four separate records. Membership has the six statuses of the
brief (shown as Not a member, Pending, Approved, Declined, Suspended, Banned);
registration has its seven (none, requested, approved, registered, waitlisted,
rejected, cancelled). Following never grants access to anything private.

**Private tournament access.** Tournaments are private by default. A club
chooses who can register: any approved member, members whose seat staff
approve one by one, or invited members only. An optional access code is an
extra check on top of membership and never a way in for a non-member; five
wrong tries lock that person out for ten minutes. A club can also mark a
tournament as a public demonstration, which anyone can watch and only
approved members can play. Staff see requests, approve or decline, invite
members, manage the waiting list (with automatic promotion when a seat frees
up), withdraw a place, restore one, and see confirmed participants against
capacity. Tournament invitation links expire, can be limited in uses and can
be revoked.

**Club profiles.** Logo, cover, description, location and time zone, follower
count, member count (if the club shows it), public tournaments, public
announcements, results and ranking (if the club shows them), Follow, Request
to join, Contact organizer. Eight kinds of social link, each validated against
its platform's address and each with its own public switch.

**CRM section in the club console** with eleven entries:

- *CRM overview*: eight figures, five charts, a period selector, and a
  "needs attention" list whose items open the exact people they count.
- *Players*: everyone with any relationship to the club. Search by name,
  username, user id or member id; seven filters; seven sort orders; bulk tag,
  untag, assign, save as segment, announce and export, each confirmed in a
  dialog. A card list on phones.
- *Player profile*: identity, both statuses side by side, tournament record
  and history from results, activity timeline, tags, assigned staff, private
  notes with author, timestamps and edit history, and quick actions (message,
  invite to a tournament, approve, suspend, ban).
- *Membership requests*: pending, declined, and suspended or banned, with
  what the club already knows about each person.
- *Tags and segments*: club-specific tags with nine colours; six built-in
  segments that follow the CRM settings; a rule builder with thirteen fields,
  all/any matching, a live preview and count; saved lists; "send announcement
  to this segment".
- *Inbox*: conversation list with search, filters, unread counts and
  assignee; the thread with staff-only notes; a player summary with recent
  tournaments and notes; assign, resolve, reopen, block, report.
- *Announcements*: type, title, message, optional picture, audience (members,
  followers, both, a segment, the players of one tournament), publish now or
  schedule, with or without a notification. Each one shows recipients,
  delivered, opted out, read and errors, taken from its delivery record.
- *Notifications*: what reached the staff member, and a log of everything the
  club sent with the same five figures.
- *Analytics*: conversion funnel, retention, acquisition sources, engagement
  (details below).
- *Automation*: five rules, each with a switch, its setting, who it would
  apply to now, its last run and a full run history.
- *CRM settings*: what "active", "inactive" and "new member" mean; invitation
  links by source; data retention; erasing one person's CRM records.

**Player side.** A Messages area with one conversation per club, blocking and
reporting; five notification preferences (club announcements, tournament
reminders, club messages, membership updates, registrations and results) plus
a per-club switch; consent choices when asking to join (announcements, sharing
a contact address with that club's staff).

**Analytics.**

- *Conversion funnel*: New followers → Membership requests → Approved members
  → First-time participants → Returning participants, counted as unique
  people from one cohort, each stage a subset of the one before. Every stage
  shows its count, its share of the starting cohort, its share of the previous
  stage, the drop-off, and the same figure for the previous period of equal
  length. Horizontal bars start at zero and share one scale. Periods: 7, 30,
  60, 90 days, all time, custom dates. An observation window (7 to 90 days, or
  "up to today") gives each person the same time to convert and leaves out
  people whose window has not elapsed, saying how many. A second view, "All
  member acquisition", starts at membership requests so directly invited
  members are not lost. Selecting a bar lists the people behind it; the list
  is the same array the count came from.
- *Four KPI cards*: follower to member, member to player, repeat
  participation, tournaments per active player. Each shows the value, the
  numerator and denominator, the previous period, the change, a small trend
  and its definition in words.
- *Retention*: new participants, played twice or more, three or more,
  tournaments per active player, average days between tournaments, 7-, 30-
  and 90-day return rates, and monthly cohorts by first tournament. A
  percentage is shown only for people whose days have passed.
- *Acquisition sources*: per source, unique people who opened a link, new
  accounts, follows, requests, approvals, first participation, returning, and
  the share of approved members who played. People who arrived without a
  trackable link are "Unknown". No fingerprinting.
- *Engagement*: daily, weekly and monthly active people, participants,
  completed entries, seats currently held (kept apart from participation),
  messages, announcements, follower growth, tournaments created and
  completed, average field, entries by week, formats, peak hours, requests,
  approval rate, time to approve, inactive members, member growth.

**Lifecycle.** New follower, interested, approved (not played), first-time
participant, returning participant, inactive, with a separate "active" flag.
Worked out from events and tournament records each time; never stored, and
shown next to membership status rather than instead of it.

**Staff roles.** Owner, manager, tournament manager, support agent, player
(the old "moderator" role became support agent). The matrix is in section C.

## C. Architecture changes

Described fully in `docs/ARCHITECTURE.md` section 3. In brief:

**Frontend components.** New: `src/console/crm/` (Overview, Players,
PlayerProfile, Requests, Segments, Inbox, NotificationsCenter, Analytics,
Automation, CrmSettings, and shared pieces: status and lifecycle badges, tag
chips, player cell, range picker, `useReport`), `src/player/Messages.tsx`,
`src/ui/image.ts`. Rewritten: the player's club page, the clubs list and join
dialog, the console's announcements, the registrations tab of the tournament
control room. Extended: wizard (visibility, access, code), branding (location,
time zone, public switches, social links), roles (add staff), lobby (access
states), settings (preferences), console navigation (CRM group). Removed:
`console/Members.tsx` and `console/Analytics.tsx`, whose jobs moved into the
CRM. The existing design system was reused throughout; no new visual language
was introduced.

**Backend services.** The service layer was split from one file into modules
with one-directional imports: `core.ts` (ids, audit, notifications, delivery
records), `analytics.ts`, `crm.ts`, `messaging.ts`, `automation.ts`, and
`api.ts` (clubs, follows, memberships, tournament access, announcements,
tenants). Every function that reads or writes a club's private data takes the
actor and checks that actor's permission in that club first; the few
unguarded calculations are grouped in one object (`compute`) that screens are
not allowed to import.

**Database schema.** There is no database. The typed `DB` object gained
`follows`, `conversations`, `messages`, `blocks`, `reports`, `batches`
(delivery records), `accessAttempts` and a per-club `crm` store (profiles,
events, tags, notes, segments, rules, runs, links, settings). Memberships and
registrations gained statuses; tournaments gained visibility, access and code;
clubs gained location, time zone, social links and public switches. The
stored `analytics` series was deleted. The table-by-table mapping to the
entities listed in the brief is in the architecture document (3.6). Uniqueness
rules are enforced in code and tested, not by constraints.

**API routes.** None exist, and none were added: there is nothing to route
to. The architecture document (3.7) lists the routes a server would expose
and the service function behind each.

**Authorization and permission rules.** Twenty-two permissions. Permissions
come only from an active membership of the same club. Platform administrators
have no club permissions.

| | Owner | Manager | Tournament manager | Support agent |
|---|---|---|---|---|
| Player list and profiles | yes | yes | yes | yes |
| Approve, suspend, ban; assign roles | yes | yes | no | no |
| Tournaments and registrations | yes | yes | yes | no |
| Announcements, analytics | yes | yes | yes | no |
| Private notes, inbox | yes | yes | no | yes |
| Tagging, segments, links, automation, settings, export | yes | yes | no | no |
| Subscription | yes | no | no | no |

## D. Demo instructions

Open `dist/index.html`. The top bar switches identity at any time. The same
steps run automatically with `npm run e2e -- --only=D`.

1. **New player** (Daniel Levy) → Clubs → Midnight Poker Club → **Follow**.
2. Daniel → **Request to join** → confirm. The page shows "Request pending".
3. **Club owner** (Michael Katz) → Membership requests → **Approve** Daniel.
   Daniel has a notification and a welcome message.
4. Michael → Players → search "Daniel" → open him → add the tag **Weekend
   Player**; write a private note.
5. Michael → Tournaments → New tournament → Deep stack → name "Sunday
   Championship" → Structure: 20,000 chips (the preset), levels 10 minutes →
   Registration: 100 seats, "Members, each approved by staff" → In 2 min →
   Publish.
6. Daniel → Tournaments → Sunday Championship → **Request a seat**. Michael →
   that tournament → Registrations → **Approve**. Then switch to **Owner of
   another club** (Dana): the tournament is in none of her lists. The app has
   no address bar of its own, so opening it "by direct URL" is done by the
   automated journey, which writes the address into the saved session and
   reloads; Dana gets "Private tournament".
7. Michael → Registrations → Add simulated players → Start now. Daniel →
   Tournaments → Sunday Championship → Go to my table → play. Michael → Live
   tab → demo clock ×240 until a winner is shown.
8. Repeat steps 5 to 7 with a quick Turbo open to all approved members.
   Michael → Players → Daniel: lifecycle **Returning participant**, membership
   still **Approved**.
9. Michael → Announcements → audience "Members and followers" → write →
   Publish. Daniel's bell shows it. Daniel → club page → ⋯ → Club preferences →
   switch announcements off; Michael's next announcement counts him as opted
   out and he receives nothing.
10. Daniel → club page → **Contact organizer** → write. Michael → Inbox →
    Daniel → reply; try a staff note, assigning and resolving.
11. Michael → Tags and segments → New segment → "Tag is Weekend Player", Add
    condition, "Membership is Approved" → Save → View players.
12. Michael → Analytics → 7 days, observation window "Up to today" → select
    **Returning participants** → Daniel is in the list. "Open in the player
    database" shows the same people.
13. Dana → her console lists River Kings players only. Michael's club is
    reachable from none of her menus.

Other things worth trying as **Player** (Alex): "Staff & Friends Turbo" asks
for an access code (it is shown to staff in the control room: `FRIENDS24`);
"Final Table Qualifier" is full and offers the waiting list; "Founders' Table"
is invitation-only and does not appear for him until Michael invites him
(the tournament → Registrations → Invite a member).

## E. Test results

All figures are from the final build.

The thirty-two tests named in the brief, and where each is carried out:

| # | Test | Where | Result |
|---|---|---|---|
| 1 | Unapproved players cannot enter private tournaments | `crm.test.ts` 1, 1b, 1c; journeys D and E | pass |
| 2 | Following does not grant membership | `crm.test.ts` 2; journey D | pass |
| 3 | A shared tournament password does not bypass authorization | `crm.test.ts` 3, 3b; journey E | pass |
| 4 | Club administrators cannot manage another club | `crm.test.ts` 4, 4b; journey E | pass |
| 5 | Revoked membership affects access | `crm.test.ts` 5, 5b; journey E | pass |
| 6 | Expired invitations are rejected | `crm.test.ts` 6, 6b | pass |
| 7 | Duplicate registrations are prevented | `crm.test.ts` 7; journey E | pass |
| 8 | Tournament capacity restrictions are enforced | `crm.test.ts` 8; journey E | pass |
| 9 | Tags are persistent | `crm.test.ts` 9 | pass |
| 10 | Removing tags updates dynamic segments | `crm.test.ts` 10, 10b | pass |
| 11 | Player profiles display correct club-specific information | `crm.test.ts` 11; journey D | pass |
| 12 | Activity timelines reflect actual events | `crm.test.ts` 12; journey D | pass |
| 13 | Private notes remain restricted | `crm.test.ts` 13; journey E | pass |
| 14 | Messages reach the correct club | `crm.test.ts` 14, 14b; journey D | pass |
| 15 | Notifications are delivered to eligible users | `crm.test.ts` 15, 15b, 15c; journey D | pass |
| 16 | Notification preferences are respected | `crm.test.ts` 16; journey D | pass |
| 17 | CRM search and filters work | `crm.test.ts` 17, 17b, 17c; journey D | pass |
| 18 | Funnel stages use the correct cohort | `crm.test.ts` 18 | pass |
| 19 | Users are counted only once per stage | `crm.test.ts` 19 | pass |
| 20 | Conversion percentages use correct denominators | `crm.test.ts` 20 (1,000 / 600 / 480 / 300 / 180 gives 60%, 80%, 62.5%, 60%); journey D | pass |
| 21 | Direct invitees appear in the appropriate acquisition view | `crm.test.ts` 21 | pass |
| 22 | Tournament registration alone does not count as participation | `crm.test.ts` 22 | pass |
| 23 | Second-tournament participation updates retention metrics | `crm.test.ts` 23; journey D | pass |
| 24 | Date filters work correctly | `crm.test.ts` 24 | pass |
| 25 | Funnel drill-down returns the matching player records | `crm.test.ts` 25; journey D | pass |
| 26 | No club can view another club's private analytics | `crm.test.ts` 26; journey E | pass |
| 27 | Existing poker gameplay still works | `engine.test.ts` (37), `tournament.test.ts` (15); journey A | pass |
| 28 | Tournament creation still works | `platform.test.ts`; journeys B and D | pass |
| 29 | Tournament registration still works | `platform.test.ts`; journeys A, B, D, E | pass |
| 30 | Navigation still works | journeys A to E use the menus; the screen tour opens every console entry | pass |
| 31 | Desktop and mobile layouts are usable | smoke journey (390 px, no sideways overflow on any player or CRM screen); screen tour | pass, with the caveats in F |
| 32 | Hebrew RTL layouts function correctly | smoke journey; `i18n.test.ts` (5); screen tour in Hebrew | pass, with the caveats in F |

Beyond those: the five automations (4 tests), club profile and social links
(3), a service-level run of the whole demo journey (1), "seeded figures are
derived from records" (1), and three architecture tests (no screen reads a
club's private stores; no screen reads an access code or the unguarded
calculations; no payment, wallet or cash-out code path exists).

Journey E, in a browser, as River Kings' owner: all ten Midnight console
pages, a Midnight player profile and a Midnight tournament's control room
refuse her when opened by address, and no Midnight name or tag is rendered.

## F. Outstanding issues

Stated plainly, most important first.

1. **Enforcement stops at the browser.** All clubs' data, including private
   notes and conversations, sits in one browser's local storage where its
   user can read it. Club isolation is demonstrated and tested as logic; it is
   not secured. This is the first thing a production build must change.
2. **No real accounts.** The onboarding step "the player creates an account"
   cannot be performed; six fixed identities stand in. For the same reason the
   "New accounts" column of the acquisition report shows only the seeded
   history and does not grow during a session.
3. **In-app notifications only.** No email, SMS or push. Because no channel
   can fail, "Errors" is always 0; it is recorded, not invented, but it has
   never been non-zero.
4. **Timers need the tab open.** Scheduled announcements, tournament
   reminders and the daily inactive check run from a browser timer. Close the
   tab and they wait until it is opened again. The automation screen says so.
5. **Data is temporary.** State survives reloads in one browser and is
   discarded after eight hours so that seeded tournaments stay in the near
   future. "Persistent" in this report means within that.
6. **Most people in the demo are simulated.** About 500 simulated accounts
   provide the membership, history and funnel figures. They are labelled BOT,
   reports that include their history say "Includes demo history", their
   reading of announcements is generated and labelled "Simulated", and exports
   mark them in a column. Only what the six identities do is real activity.
7. **Invitation links are not real web addresses.** A link is pasted into
   "Join a club"; that is when its opening is recorded. Nothing can be
   tracked outside the prototype, by design.
8. **Export is copy, not download.** The export dialog shows comma-separated
   text to copy. No file is written.
9. **Automation is five fixed rules, not a free-form builder.** Each can be
   switched, configured and inspected; new rules cannot be composed.
10. **Segment rules are flat.** All-of or any-of over up to twelve
    conditions; no nested groups.
11. **Player filters.** Join date can be filtered only as "approved in the
    last 14 days", not by an arbitrary date range. Last activity and
    participation have presets, not free ranges.
12. **"New follower" has no time limit.** It means "follows the club and has
    not asked for membership", however long ago.
13. **Rescheduling.** People holding a place are told when a published
    tournament's start time changes, but a tournament can only be edited
    before its registration opens (an existing rule), so in practice this
    reaches invited members only.
14. **Data retention is applied by hand.** Setting a limit erases nothing
    until "Apply now" is pressed; there is no scheduled job.
15. **Read receipts.** Conversations track unread counts per side, not
    "seen" per message.
16. **Abuse reports** reach the platform with who reported whom and why, and
    can be marked reviewed. There is no further moderation tooling.
17. **Role choices that may need discussion.** A tournament manager can open
    the player list and analytics and publish announcements; a support agent
    cannot tag players. Both follow from a literal reading of the brief and
    are one line each to change in `permissions.ts`.
18. **Phone layout of the console.** Every screen fits a 390 px phone without
    the page scrolling sideways, and the player list and approval queue
    become cards. The wider analytics tables (sources, cohorts, delivery log,
    automation history) scroll sideways inside their own panel.
19. **Hebrew.** The interface is fully translated and laid out
    right-to-left, with Latin names and numbers kept left-to-right. The
    wording has not been reviewed by a native-speaking editor, several
    timeline and status phrases use the masculine form, and seeded content
    (club, tournament and tag names, announcements, messages) is English.
20. **Not tested**: browsers other than Chromium, real devices, assistive
    technology, performance with more than a few hundred members. Reports
    recompute from records on each request, which is instant at this size and
    would need indexed queries at scale.

## G. Implementation status

Each item is in exactly one group. Items from version 0.1.0 are included so
that this is one complete picture.

### 1. Implemented and functioning

Verified by the tests and browser runs above.

**Poker and tournaments (unchanged from 0.1.0)**
- No-Limit Texas Hold'em for 2 to 9 seats with complete betting rules, side
  pots, split pots, antes, showdown and eliminations; hand evaluation checked
  against all 2,598,960 five-card hands; per-viewer redaction of hole cards;
  command validation; turn timer and sitting out.
- Multi-table freezeout tournaments and sit & gos: seating, levels and breaks,
  late registration, balancing and breaking tables, final table, results;
  pause, resume, cancel; nine-state lifecycle; presets and a level editor.
- Player app: lobby, live table on desktop and phone, results, profile, hand
  history with replayer, settings.
- Platform administration: clubs, plans, limits, suspend and restore, billing
  view, support queue.

**Membership and access (new)**
- Follow and unfollow with a persistent state and a public follower count.
- Membership requests, approval, decline, suspension, ban and their reversal,
  each written to the activity log and to the person's timeline.
- Private-by-default tournaments with three access modes, optional access code
  with lock-out, invitations by staff and by expiring, revocable link,
  waiting list with automatic promotion, withdrawal of a place, capacity and
  duplicate protection. Refused consistently for lobby, tables and
  registration, including when opened by address.

**Club profile (new)**
- Location, time zone, social links with validation and per-link visibility,
  public switches for member count and results, Follow, Request to join,
  Contact organizer.

**CRM (new)**
- Player database with search, filters, sorts, pagination and bulk actions.
- Player profile with statistics and history from tournament records,
  timeline from recorded events, tags, assignment and private notes with
  history.
- Tags; built-in, dynamic and saved segments; segment announcements.
- Two-sided messaging with staff notes, assignment, resolve and reopen,
  unread counts, rate limits, blocking and reporting.
- Announcements with five audiences, scheduling, optional picture, and
  delivery figures from stored records; opt-outs respected at club and
  account level.
- Five notification preferences; duplicate protection by event key.
- Five automation rules with switch, setting, preview, history, error
  capture and duplicate protection.
- Funnel, KPIs, retention, acquisition sources and engagement, all computed
  from records, with drill-down to the people behind a funnel stage.
- Lifecycle classification separate from membership status.
- Role-based access for five roles, on reads as well as writes.
- CRM settings, invitation links by source, erasing one person's CRM records.

**Cross-cutting**
- English and Hebrew for every new screen; a test keeps the dictionaries in
  step and a browser check looks for untranslated keys.
- Phone and desktop layouts for every new screen.
- No payment, deposit, withdrawal, wallet, transfer or prize feature exists
  anywhere; a test fails the build if such a code path appears.

### 2. Implemented with simulated data

These work, but what they show, or the other party, is generated. Each is
labelled in the interface.

- **Other people.** About 500 simulated accounts: their memberships, follows,
  requests, registrations, play and messages.
- **History.** Past tournaments, and so most of what the funnel, retention,
  source and engagement reports show on first opening, come from generated
  history marked "Includes demo history". They are real records in the sense
  that every figure is counted from them; they are not real events.
- **Announcement reads by simulated members**, shown as a separate count.
- **Acquisition sources of the seeded members**, assigned when the demo data
  is generated.
- **Simulated staff** at The Final Table who approve join requests.
- **Plan usage figures** are now counted from records, but those records are
  mostly the generated history.
- **System health, pricing, invoices, game integrity, QR joining, demo
  clock**: as in 0.1.0 (simulated metrics, placeholder currency, design
  preview, sample tiles, accelerated time).

### 3. Partially implemented

- **Backend enforcement**: a tested service layer in the browser, not a
  server (F1).
- **Onboarding flow**: every step works except creating an account (F2).
- **Notification system**: in-app only, with an architecture (delivery
  records, per-channel consent) that further channels can be added to (F3).
- **Automation**: the five required rules, not a general builder (F9).
- **Scheduling**: works while the tab is open (F4).
- **Export**: copyable text, permission-checked and logged (F8).
- **Segment builder, player filters, read status, abuse handling,
  rescheduling, retention**: see F10 to F16.
- **Persistence**: local storage in one browser (F5).
- **Hebrew, accessibility, phone layout of wide tables**: see F18 to F20.
- From 0.1.0 and unchanged: multiplayer (one person against simulated
  opponents), hidden cards (redacted in the view but present in the tab's
  memory), disconnect handling, the simple moving-button rule, tournament
  time zone and banner options, results sharing, subscription changes by
  ticket, account screens shown but switched off.

### 4. Not implemented

- A server, an HTTP or WebSocket API, a database, background workers.
- Real accounts, passwords, sessions, two-step verification.
- Email, SMS or push notifications.
- File downloads of exports; importing players.
- Free-form automation rules; nested segment conditions.
- Table chat, friends, player-to-player messages (messaging is between a
  player and a club only).
- Rebuy, re-entry, add-on, bounty, satellite and multi-day tournaments;
  other poker variants; cash-game tables.
- Collusion detection, device fingerprinting, certified random number
  generation.
- Anything involving money. Deliberately.

### 5. Required before production

1. **Legal review first.** Qualified counsel must assess each target market
   before any commercial use, including the privacy and consent rules that
   apply to a CRM holding personal data and to marketing messages. The
   virtual-chip, no-money boundary must be preserved unless that review says
   otherwise.
2. **Authoritative server.** Move the engines and the service layer to a
   server. Clients send commands and receive only what they may see.
3. **Identity and security.** Real authentication; the actor comes from the
   session; rate limiting at the edge; a security review and penetration
   test, with tenant isolation as a primary target.
4. **Database.** Relational tables as mapped in the architecture document,
   with tenant-scoped access, unique constraints for memberships, follows and
   registrations, indexes for the report queries, an append-only event and
   audit store, backups.
5. **Jobs and channels.** Queued jobs for scheduled announcements, reminders
   and daily checks; push and email providers behind the existing delivery
   record, each with its own consent and unsubscribe handling.
6. **Privacy operations.** Data-subject requests, retention schedules that
   run on their own, export controls, staff access logs reviewed by someone.
7. **Game integrity, real-time reliability, billing, operations, quality,
   content**: unchanged from the 0.1.0 list (certified RNG and shuffle audit;
   reconnection and server-owned timers; business-to-business subscription
   billing only; monitoring; cross-browser, device and accessibility testing,
   native Hebrew review; counsel-written terms and policies).
