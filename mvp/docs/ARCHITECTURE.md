# Architecture

Poker Club OS is one browser application with three role-separated experiences
on top of two engines and a service layer. This document describes what is in
the repository today and how each part maps to a production deployment.

```
┌──────────────────────────── browser ────────────────────────────┐
│  Player app        Club console        Platform administration   │  src/player, src/console, src/platform-admin
│  ───────────────── shells, routing, design system ───────────── │  src/app, src/ui, src/table, src/shared
│                                                                  │
│  Service layer ("mock backend")                                  │  src/platform
│    api.ts        clubs, follows, memberships, tournament access  │
│    crm.ts        players, tags, notes, segments, links, export   │
│    messaging.ts  conversations, blocking, abuse reports          │
│    automation.ts the five rules and their run history            │
│    analytics.ts  funnel, KPIs, retention, sources (computed)     │
│    permissions   roles, tenant checks                            │
│    core.ts       audit, notifications, delivery records          │
│    runtime       scheduler, clock, simulated activity, tables    │
│    store         versioned in-memory DB + local storage          │
│                                                                  │
│  Engines (pure TypeScript, no UI or browser APIs)                │  src/engine
│    holdem        rules, betting, pots, showdown                  │
│    tournament    levels, seating, balancing, eliminations        │
│    view          per-viewer redaction of the event stream        │
│    bots          simulated opponents                             │
└──────────────────────────────────────────────────────────────────┘
```

In the prototype all of this runs in the browser tab. The boundaries are real
in the code: the engines import nothing from the UI, screens never mutate data
directly, every write goes through a service function that checks permissions,
and every read of club-private data (CRM records, conversations, analytics)
goes through one too. Because it is one tab, these checks protect against the
interface and against mistakes, not against someone with the developer tools
open; enforcing them against a hostile client needs the server described
below. Moving the service layer and engines to a server is the main step
towards production; the section "Path to production" lists what that involves.

## 1. Poker rules engine (`src/engine`)

**Cards.** A card is an integer 0–51 (`rank = c >> 2`, `suit = c & 3`). A
table and a hand are plain JSON objects, so they can be stored, sent over a
wire and replayed.

**Event sourcing.** `startHand` and `applyAction` mutate the table and append
to an ordered event log (`start`, `post`, `hole`, `turn`, `action`, `refund`,
`collect`, `street`, `show`, `showdown`, `award`, `end`). Everything the
interface shows is derived from that log:

- `redactEvent(event, viewer)` removes what the viewer may not see. Hole cards
  are only present in the `hole` event addressed to their owner; an observer
  gets none. Cards appear to others only through `show` events at showdown.
- `applyEvent(view, event)` is a reducer that builds the `TableView` the table
  screen draws. The same reducer drives live play, spectating and the hand
  replayer, so they cannot disagree.

This is the shape a server would use: the authoritative state stays on the
server and each client receives only its own redacted event stream.

In the prototype that boundary is a module boundary, not a network one. The
screens only ever receive redacted views, but the authoritative state lives in
the same browser tab (and in local storage), so it is not secret from someone
who inspects the page's memory. Real secrecy needs the server split.

**Commands.** `submitCommand(table, { seat, handNo, seq, actionId, action })`
rejects actions that are out of turn, for a previous hand, for a stale
sequence number, or already applied (duplicate `actionId`). That is the
protection against double clicks, delayed and out-of-order messages.

**Rules covered.** Button rotation, blinds, heads-up blind and action order,
preflop and postflop order, fold/check/call/bet/raise, minimum raise, short
all-in raises that do not reopen betting, the big blind's option, calls capped
by the deepest opponent, return of uncalled bets, main and side pots with
eligibility, split pots with odd chips going clockwise from the button,
all-in run-outs, classic antes and big-blind ante, timeouts (check if free,
otherwise fold), sitting out, eliminations ranked by starting stack when two
players bust in one hand. Tables seat 2–9.

**Hand evaluation.** `evaluate` scores 5–7 cards into one integer (category
plus kickers) so comparing hands is a number comparison. A test enumerates all
2,598,960 five-card hands and checks the category counts.

**Randomness.** Shuffling is Fisher–Yates over `crypto.getRandomValues` with
rejection sampling (no modulo bias). Tests use a seeded generator. The shuffle
is not externally certified and the interface never says it is.

**Simulated opponents.** Five styles (tight, aggressive, passive, balanced,
beginner). A bot receives `botContext(table, seat)`: its own two cards and the
same public information a human at that seat sees. It estimates equity by
Monte-Carlo sampling against unknown hands and picks a legal action. A test
asserts that the context contains no other player's cards.

## 2. Tournament engine (`src/engine/tournament.ts`, `structure.ts`)

A `TournamentLive` holds the structure, the players, the tables and a
timeline. Time is injected (`advanceClock(live, ms)`), so tests run a whole
tournament in milliseconds and the demo can run at ×1, ×10, ×60 or ×240.

- **Structures.** Presets (Turbo, Regular, Deep stack, Sit & Go) generate
  blind ladders, antes, breaks and late-registration windows; the wizard edits
  the result and `validateStructure` rejects broken ones. `estimateDurationMinutes`
  gives the operator a length estimate.
- **Seating.** Random draw across the minimum number of tables.
- **Hands.** One table can be "driven" (paced for a person to watch or play);
  all other tables play instantly in the background with the same engine.
  `settleHand` applies eliminations exactly once per hand.
- **Balancing.** After each hand: if the remaining players fit on fewer
  tables, the smallest idle table is broken; if tables differ by two or more,
  the player next to post the big blind moves. Nobody moves during a hand.
  Moves, closures, the final table and heads-up are written to the timeline.
- **Late registration** adds a full stack at the next hand while the window is
  open. **Pause/resume** stops the clock and dealing.
- **Results.** Finishing order, who knocked whom out and at which level,
  duration, hands played.

## 3. Service layer (`src/platform`)

There is no HTTP API. The "backend" is a set of plain functions, each with the
same shape, and it is the code a server would run:

```
requirePermission(db, actorId, 'crm.notes', clubId)   // or requirePlatform; throws ForbiddenError
validate input                                         // DomainError with a code the UI translates
mutate or compute                                      // plain objects
audit(...), logEvent(...), notify(...)                 // stored as key + parameters
```

Modules import in one direction only, so there are no cycles and each can be
tested alone:

```
core ← analytics ← crm ← messaging ← automation ← api ← runtime
```

v0.4 adds modules beside these (each guarded the same way):

| Module | What it owns |
|---|---|
| `engine/variants.ts`, `engine/hands.ts` | variant registry; Omaha / Hi-Lo / short-deck hand evaluation |
| `platform/competition.ts` | performance score, global and club leaderboards, tiers, leagues, achievements |
| `platform/calendar.ts` | personal calendar events, reminders, `.ics` |
| `platform/retention.ts` | inactivity alerts, derived preferences, activity heatmap and recommendations, weekly report, club pulse |
| `platform/scheduling.ts` | templates, recurring schedules (club-local, DST-safe), `runSchedules` |
| `platform/migration.ts` | CSV import → imported records, attach on approval |
| `platform/integrity.ts` | scan over results → cases, review workflow |
| `platform/channels.ts` | notification channel adapters, outbox, honest summary |
| `platform/runtime.ts` `feeds` | delayed spectator / streamer frames (`spectate`) |
| `ui/qr.ts` | QR encoder (byte mode, EC-M, versions 1–9) |

`core.ts` imports `channels.ts` (fan-out after an in-app notification) and
`api.ts` imports `migration.ts` (attach on approval); both are call-time uses,
so module evaluation stays acyclic in effect.

### 3.1 Relationships

A person and a club can be related in four independent ways. Each has its own
record and none implies another.

| Relationship | Record | States |
|---|---|---|
| Registered user | `users` | exists or not; grants nothing in any club |
| Follower | `follows` (club, user, notify) | following or not; never grants access |
| Member | `memberships` (club, user, role, status) | none, pending, active ("approved"), rejected, suspended, banned |
| Tournament participant | `tournament.registrations[]` | none, requested, approved, registered, waitlisted, rejected, cancelled |

**Lifecycle** (new follower, interested, approved, first-time participant,
returning participant, inactive, plus an "active" flag) is a fifth thing and
is never stored: `analytics.lifecycleOf` works it out from follow and
membership events and from tournament records. A returning participant can
have a suspended membership; the two are shown side by side and never merged.

### 3.2 Tournament access

A tournament has `visibility` (private by default, or public demonstration),
`access` (any approved member, each seat approved by staff, or invited members
only) and an optional `accessCode`. Three functions decide everything and the
screens only reflect them:

- `canViewTournament` — who may open the lobby, the player list and results.
- `canWatchTournament` — who may attach to a table. `Runtime.attach` calls it
  and throws, so a table cannot be opened by address.
- `registerForTournament` — in order: active club, approved membership,
  registration open, no place already held (and none withdrawn by staff),
  an invitation where the tournament requires one, the access code (five
  wrong tries in ten minutes lock that person out), enough demo points, then
  capacity. A full tournament puts the person on the waiting list; the first
  person on it is promoted when a seat frees up. A request waiting for
  approval holds no seat.

The access code is checked after membership, so knowing it never substitutes
for being an approved member. Invitation links carry an expiry, a use limit
and can be revoked; a tournament link authorises approved members only.

### 3.3 CRM, messaging, automation

- **Player database** (`crm.queryPlayers`): one row per person who has any
  relationship with the club, built on demand from memberships, follows, CRM
  profiles and tournament records. Filters, sorts and segment rules all run on
  that row, so a figure and its list cannot disagree.
- **Tags, notes, assignments** live in the club's `crm` store. Notes keep
  their author, timestamps and earlier versions.
- **Segments** are either dynamic (a list of rules, re-evaluated every time)
  or static (a saved list). Six built-in segments are generated from the
  club's CRM settings rather than stored.
- **Messaging** (`messaging.ts`): one conversation per player and club, with
  internal staff notes, assignment, resolve/reopen, per-side unread counts,
  rate limits, duplicate detection, blocking in both directions and abuse
  reports that go to the platform without the message content.
- **Announcements and delivery** (`core.deliver`): every send creates a
  delivery record with the number eligible, the ids delivered to, the number
  opted out and errors; reads are recorded against it when a notification is
  opened. Statistics are read from that record and nowhere else.
- **Automation** (`automation.ts`): five rules (welcome, reminder, new public
  tournament, membership request, inactive tagging). Each run is recorded with
  a dedupe key, so a trigger that fires twice does its work once.

### 3.4 Analytics

`analytics.ts` stores nothing. Two sources of truth feed every figure:

- **Participation**: tournament results, plus the registered players of
  tournaments that are running now. Registration alone is never participation.
- **Milestones** (first follow, first request, first approval): the CRM event
  log, which carries a timestamp for each.

The funnel takes the people whose first follow (or, in the acquisition view,
first request) falls inside the period, gives each the same observation
window from their own start, leaves out anyone whose window has not elapsed,
and counts each stage as a subset of the one before. The previous period has
the same length and ends one millisecond before the current one begins. Each
stage returns the user ids it counted; the drill-down list is that array.

### 3.5 Permissions

Five club roles, twenty-two permissions, plus platform administrators, who
have no club permissions at all.

| | Owner | Manager | Tournament manager | Support agent | Player |
|---|---|---|---|---|---|
| Console, player list and profiles | yes | yes | yes | yes | no |
| Approve, suspend, ban members; assign roles | yes | yes | no | no | no |
| Tournaments: create, edit, run, cancel, registrations | yes | yes | yes | no | no |
| Announcements | yes | yes | yes | no | no |
| Analytics | yes | yes | yes | no | no |
| Private notes | yes | yes | no | yes | no |
| Inbox | yes | yes | no | yes | no |
| Tag and assign players | yes | yes | no | no | no |
| Tags, segments, links, automation, CRM settings | yes | yes | no | no | no |
| Export | yes | yes | no | no | no |
| Branding, club profile, activity log | yes | yes | no | no | no |
| Subscription | yes | no | no | no | no |

Permissions come only from an active membership in the same club, so staff of
one club have none in another. Screens ask `can(...)` to decide what to show;
service functions call `requirePermission(...)` regardless. Three
architecture tests fail the build if a file outside `src/platform` reads the
CRM store, the conversations, the unguarded calculations or a tournament's
access code.

### 3.6 Data model

One typed object (`DB` in `types.ts`) shaped like relational tables, with the
club id as the tenant key. How it maps to the tables a production database
would have:

| Table | Where it lives today |
|---|---|
| users | `db.users` |
| clubs | `db.clubs` (profile, branding, social links, public switches) |
| club_followers | `db.follows` |
| club_memberships, membership requests, club_staff | `db.memberships`: a request is a row with status `pending`, staff are rows with a role |
| club_member_profiles, crm_member_tags, crm_staff_assignments | `db.crm.profiles` (member number, source, tag ids, assigned staff) |
| crm_tags | `db.crm.tags` |
| crm_segments, crm_segment_conditions | `db.crm.segments` (rules inline) |
| crm_notes | `db.crm.notes` (with history) |
| crm_activity_events, acquisition_events | `db.crm.events` |
| crm_conversations, crm_messages | `db.conversations`, `db.messages`, plus `db.blocks` and `db.reports` |
| crm_announcements | `db.announcements`, with `db.batches` as the delivery records |
| crm_automation_rules, crm_automation_runs | `db.crm.rules`, `db.crm.runs` |
| notifications | `db.notifications` (each linked to a club, a delivery record and a dedupe key where it has one) |
| notification_preferences | `db.settings[user].notifications`, `membership.announcements`, `follow.notify` |
| tournaments | `db.tournaments` |
| tournament_access_requests, tournament_registrations | `tournament.registrations[]` (one row per person, with a status), `db.accessAttempts` |
| tournament_participations | not stored; derived from results and live tournaments |
| tournament_results | `db.results` |
| club_invitation_links | `db.crm.links` |
| audit_logs | `db.audit` |

There are no indexes or database constraints because there is no database:
uniqueness (one membership per person and club, one registration per person
and tournament, one tag name per club) is enforced in the service functions
and covered by tests.

### 3.7 What an HTTP API would look like

Not built. The service functions are the contract; a server would expose them
roughly like this, with the actor taken from the session instead of an
argument:

| Would-be route | Service function |
|---|---|
| `POST /clubs/:id/follow`, `DELETE …/follow` | `followClub`, `unfollowClub` |
| `POST /clubs/:id/membership-requests` | `requestJoin` |
| `POST /clubs/:id/members/:user/approve` (reject, suspend, ban …) | `approveMember`, `rejectMember`, `suspendMember`, `banMember` |
| `GET /clubs/:id/players?…` | `crm.queryPlayers` |
| `GET /clubs/:id/players/:user` | `crm.playerProfile` |
| `POST /clubs/:id/players/tags`, `/notes`, `/assign` | `crm.addTag`, `crm.addNote`, `crm.assignStaff` |
| `GET/POST /clubs/:id/segments`, `GET …/segments/:sid/preview` | `crm.listSegments`, `crm.createSegment`, `crm.previewSegment` |
| `GET /clubs/:id/inbox`, `POST …/conversations/:cid/messages` | `messaging.clubInbox`, `messaging.sendClubMessage` |
| `POST /clubs/:id/messages` (player side) | `messaging.sendPlayerMessage` |
| `POST /clubs/:id/announcements` | `publishAnnouncement` |
| `GET /clubs/:id/analytics/funnel` (kpis, retention, sources, engagement) | `analytics.funnelReport` and its siblings |
| `GET/PATCH /clubs/:id/automation/:rule` | `automation.listRules`, `automation.updateRule` |
| `POST /tournaments/:id/registrations` | `registerForTournament` |
| `POST /tournaments/:id/registrations/:user/approve` (reject, revoke, invite) | `approveRegistration`, `rejectRegistration`, `revokeRegistration`, `authorizePlayer` |
| `GET /invitations/:token` | `openInvite` |

### 3.8 The rest

- **Lifecycle** (`lifecycle.ts`): DRAFT → SCHEDULED → REGISTRATION_OPEN →
  REGISTRATION_CLOSED → SEATING → RUNNING ⇄ PAUSED → COMPLETED, with
  CANCELLED reachable before completion. `assertTransition` rejects anything
  else; completed and cancelled are terminal.
- **Plans and limits.** Three editable plans with four pricing models; a
  club's effective limits are its plan's limits plus per-club overrides.
  Publishing a tournament, adding staff and accepting members check them.
  "Monthly active players" is the number of unique participants in the last
  thirty days, counted from tournament records.
- **Runtime** (`runtime.ts`): a 250 ms tick plays the part of the server's
  background workers. It opens registration and starts tournaments on
  schedule, advances clocks, plays background tables, finalises results, and
  once a second publishes scheduled announcements, runs the timed automation
  rules and produces the simulated activity (simulated registrations, simulated
  reading of notifications, simulated staff approvals at one club).
  `TableDriver` presents a table to one viewer: it feeds redacted events to
  the screen at a readable pace, runs the turn timer, lets bots act and saves
  the viewer's hand history.
- **Store** (`store.ts`): the "database" is one versioned object; subscribers
  re-render on change. It is saved to local storage (best effort).

Text that is stored and shown later (notifications, audit entries, timeline)
is stored as a message key with parameters, so it renders in the reader's
language rather than the writer's.

## 4. Interface

- **Routing and session** (`src/app/session.ts`): in-memory routes with a
  history stack; no URL dependence, so the single file works from disk or
  embedded. Demo sign-in selects one of six seeded identities. A route that a
  service function refuses renders a "no access" page.
- **Two looks, one app** (v0.3): `scripts/build.mjs --design=v2|v3` picks a
  stylesheet (`src/styles/app.css` or `app-v3.css`, same token names) and
  defines `__DESIGN__`; `src/app/variants.ts` is the only module that chooses
  between a v2 and a v3 component (shells, player home, lobby hero, table
  stage). Features added in v0.3 (rankings, table branding, analytics deep
  links, CRM secondary navigation) are design-independent. See
  `docs/DESIGN_V3.md`.
- **Shells** (`shells.tsx`, `shells.v3.tsx`): a demo bar (always visible: demo
  badge, language, role switch, reset) and three shells. v2: players get a
  sidebar on desktop and a bottom tab bar on phones; staff get a sidebar that
  becomes a drawer. v3: players get a top bar with an account menu and a
  five-tab bar on phones; staff get a grouped sidebar with a club switcher, a
  context trail and, on CRM pages, a secondary tab strip.
- **CRM screens** (`src/console/crm`): each screen asks the service layer for
  a report through `useReport`, which recomputes straight after any action
  and otherwise at most every 1.5 seconds. Wide tables become card lists on a
  phone.
- **Design system** (`src/ui`): tokens in Tailwind's `@theme`; buttons,
  badges, panels, form controls, dialogs with focus trapping, menus, tabs,
  toasts, skeletons and empty states. A club's accent colour is a CSS variable
  set on the club's scope, so branding reaches every screen of that club.
- **Table** (`src/table`): seats are placed along a stadium outline that is
  wide on desktop and tall on phones; cards and chips are CSS and inline SVG.
  `TableStage.v3.tsx` keeps the same geometry and adds the v0.3 cloth, plates
  and timer ring. A tournament's `tableBranding` (logo source, opacity, scale,
  felt theme) is resolved by `platform/table-branding.ts`, which the wizard
  preview, the home cameo and the live table all share; the logo is drawn
  below the board under every gameplay element.
  The action bar has sizing presets, a slider, a numeric field, large-bet
  confirmation and keyboard shortcuts.
- **Charts** (`src/ui/charts.tsx`): line, bar, ranked bars, heatmap and
  sparkline on d3-scale and d3-shape, with hover and keyboard read-outs and a
  screen-reader table behind each chart.
- **Languages** (`src/i18n`): English and Hebrew dictionaries with the same
  keys (a test enforces it, including placeholders). Hebrew sets `dir="rtl"`
  on the root; layout uses logical properties throughout, and left-to-right
  values inside Hebrew sentences are wrapped in directional isolates.
- **Accessibility**: keyboard-reachable controls, visible focus, labelled icon
  buttons, reduced motion (system setting and an in-app switch), a
  higher-contrast option, and a four-colour deck.

## 5. Testing

| Suite | Tests | What it covers |
|---|---|---|
| `tests/engine.test.ts` | 37 | deck, exhaustive hand ranking, side pots, action order, minimum raise, short all-ins, split pots and odd chips, timeouts, duplicate/stale/out-of-turn commands, hidden-card redaction, bot information isolation, a 4,000-hand fuzz with chip conservation |
| `tests/tournament.test.ts` | 15 | structures, seating, clock, pause/resume, complete tournaments up to 64 players, late entry, balancing rules, elimination ranking |
| `tests/platform.test.ts` | 39 | role authorization, club data isolation, membership flows, lifecycle transitions, registration and points, plan limits, branding gate, support, tenants, audit, notification preferences, scheduler and simulated activity |
| `tests/crm.test.ts` | 50 | the 26 membership, CRM and analytics tests named in the brief, plus variants, the five automations, club profile, retention and export, a service-level run of the demo journey, and three architecture tests |
| `tests/i18n.test.ts` | 5 | Hebrew covers every English message with the same placeholders; every key used in the source exists |
| `scripts/e2e.mjs` | 135 checks | Journeys A–E and a Hebrew/phone smoke run, in headless Chromium against the built file |

The analytics tests build their own data (for example 1,000 followers of whom
600 request, 480 are approved, 300 play and 180 return) and check the counts,
both kinds of percentage and the drop-off figures against hand-calculated
values.

## 6. Path to production

The detailed plan (topology, server-authoritative play, data model, API
boundary, scheduler, gradual migration) is in `PRODUCTION_ARCHITECTURE.md`.
In short:

What changes, in order of importance:

1. **Authoritative server.** Run `src/engine` and `src/platform/api.ts` in a
   Node.js service. Clients send commands (`submitCommand`) over WebSockets
   and receive their redacted event stream. The command/sequence/actionId
   contract and the redaction reducer already assume this split.
2. **Real identity.** Accounts, sessions, password and two-step verification;
   `actorId` comes from the session instead of a demo role switch.
3. **Persistence.** PostgreSQL for business data (the `DB` shape maps to
   tables almost one-to-one, with `clubId` as the tenant key and row-level
   checks), an append-only store for hand events and audit entries, Redis for
   table and timer state.
4. **Tournament workers.** The `Runtime` tick becomes scheduled jobs and one
   process per running tournament, with recovery from the event log.
5. **Notifications and jobs.** Delivery records already separate "who was
   eligible" from "what was delivered", so push, email or SMS become extra
   channels on the same record, each with its own consent. Scheduled
   announcements, reminders and the daily inactive check become queued jobs
   instead of a browser timer; their dedupe keys carry over unchanged.
6. **Analytics at scale.** The reports recompute from records on every
   request, which is fine for hundreds of members. A production service would
   keep the same definitions but run them as indexed queries or materialised
   views.
7. **Operations.** Real metrics behind the health screen, rate limiting,
   reconnection handling on the client, load testing of concurrent tables.
8. **Integrity.** Certified RNG, server-side shuffle audit, and the detection
   pipeline that the integrity screen currently only sketches.
9. **Legal.** Jurisdiction review, terms, privacy, age and location controls
   as counsel requires. The product must remain free of player-money features
   unless and until that is lawful and licensed where it operates.
