# Poker Club OS

An interactive prototype of a B2B platform for poker clubs: a player app, a club
management console with a full player CRM, and a platform administration area,
built around a working poker engine (Hold'em, Omaha, Omaha Hi/Lo, Short Deck;
no-limit, pot-limit and fixed-limit) and a multi-table tournament engine.

**v0.4** adds leagues and global rankings, referrals with QR codes, a personal
calendar, a retention engine with scheduling recommendations, club creation and
a CSV migration assistant, tournament templates and recurring schedules, a
delayed spectator/streamer feed, an integrity review queue (simulated signals),
provider-agnostic notification channels (demo adapters) and responsible-play
tools. See `docs/V04_REPORT.md` and `docs/V04_FEATURE_AUDIT.md`.

**This is a closed demonstration.** Every chip and point is virtual and has no
monetary value. There are no deposits, withdrawals, transfers, payouts or
payments of any kind, and every opponent is a clearly labelled simulated player.
Clubs, members, results, prices and service metrics are fictional demo data.

## Open it

The whole product is one self-contained file. Nothing needs to be installed.

```
dist/index.html      open this in any current browser
```

It runs entirely in the browser: there is no server. Permission checks,
notifications, automations and analytics all run in a service layer inside the
page (see `docs/ARCHITECTURE.md`). The only network request is for web fonts
(Inter, Archivo, Fraunces, Heebo from Google Fonts); without a connection the
app falls back to system fonts and works the same.

State is kept in the browser's local storage so a reload continues where you
were. "Reset demo data" in the role menu (top bar) restores the starting state.
Stored demo data older than eight hours is discarded so scheduled tournaments
are always in the near future.

## The demo identities

Pick an identity on the welcome screen, or switch at any time from the top bar.
There are no real accounts in the prototype; these six stand in for them.

| Identity | Who | Where they land |
|---|---|---|
| New player | Daniel Levy, a registered user with no club | Player app |
| Player | Alex Morgan, approved member of Midnight Poker Club and River Kings | Player app |
| Club owner | Michael Katz, owner of Midnight Poker Club | Club console |
| Owner of another club | Dana Marin, owner of River Kings | Her own club console |
| Tournament manager | Maya Shapiro, limited staff role at River Kings | Club console (fewer areas) |
| Platform administrator | Jordan Lee, platform staff | Platform administration |

Three fictional clubs are seeded: **Midnight Poker Club** (join by approval,
Professional plan, about 160 members and 220 followers), **River Kings**
(large, open to join, Enterprise plan, a public tournament already running)
and **The Final Table** (small, serif gold branding, Starter plan, simulated
staff who answer join requests). Every other member is a simulated account,
labelled BOT wherever it appears.

## A ten-minute demo for a club operator

1. **Player** → Home. "Play now" lists the Six-Max Sit & Go. Register; five
   simulated players take the other seats within a few seconds and the table
   opens. Play a few hands: fold/check/call, bet sizing presets and slider,
   large-bet confirmation, hand log, standings, sit out. Keys: F, C, R.
2. **Player** → Hand history → open any hand to step through it in the replayer.
   Profile shows statistics, badges and tournament history.
3. **Club owner** → New tournament. Pick a preset, edit a blind level, choose
   who can register, "In 2 min", review, publish.
4. **Club owner** → the tournament → Registrations → Add simulated players →
   Start now. The Live tab shows the clock, tables, standings and timeline.
   Set the demo clock to ×240 to run it to a winner in under a minute.
5. **Club owner** → CRM overview, Players, Analytics (see the next section).
6. **Platform administrator** → Clubs → a club: change its plan, override a
   limit, suspend and restore. Plans edits the placeholder pricing. Support has
   the ticket queue and the abuse reports.
7. Switch the language to Hebrew (**עב** in the top bar): the whole product turns
   right-to-left.

## The CRM demonstration

The same steps are run automatically by `npm run e2e -- --only=D`.

1. **New player** (Daniel) → Clubs → Midnight Poker Club → **Follow**. The
   follower count goes up by one. He can see the public page and the public
   tournament, nothing private.
2. Daniel → **Request to join**. The page shows "Request pending".
3. **Club owner** (Michael) → Membership requests → **Approve** Daniel. Daniel
   gets a notification, and the welcome rule writes to him in Messages.
4. Michael → Players → Daniel Levy → add the tag **Weekend Player**, write a
   private note.
5. Michael → Tournaments → New tournament → Deep stack, name it
   "Sunday Championship", set levels to 10 minutes and seats to 100, choose
   **Members, each approved by staff**, publish. It is private by default.
6. Daniel → Tournaments → Sunday Championship → **Request a seat**. Michael →
   the tournament → Registrations → **Approve**. Switch to **Owner of another
   club** and open the same tournament: "Private tournament".
7. Michael → Add simulated players → Start now. Daniel → open the table and
   play. Michael → demo clock ×240 until there is a winner.
8. Repeat with a second tournament. Daniel's profile now says **Returning
   participant**; his membership status is still "Approved".
9. Michael → Announcements → audience "Members and followers" → publish. The
   delivery figures appear under it. Daniel is notified, unless he turns the
   club's announcements off (club page → ⋯ → Club preferences), in which case
   he is counted as opted out.
10. Daniel → club page → **Contact organizer** → write. Michael → Inbox →
    answer, assign, add a staff note, resolve.
11. Michael → Tags and segments → New segment → Tag is Weekend Player **and**
    Membership is Approved. The preview counts the people; "View players"
    opens exactly them.
12. Michael → Analytics → Conversion funnel. Choose a period and an observation
    window, then select the **Returning participants** bar: the people behind
    it are listed, and can be tagged, assigned, saved as a segment or written
    to.
13. **Owner of another club** (Dana) → her console shows River Kings only.
    Every Midnight console address refuses her.

## Working on the code

```
npm install          # see the note below
npm run build        # writes dist/index.html and dist/artifact.html (v0.3 design)
node scripts/build.mjs --design=v2   # the same app in the original v0.2 look
npm run dev          # rebuilds on change and serves http://localhost:5173
npm run typecheck    # TypeScript, strict
npm test             # 151 unit and integration tests (node:test)
npm run e2e          # six browser journeys in headless Chromium (needs a build first)
```

`npm run e2e -- --only=D` runs one journey: A (new player), B (club owner),
C (platform administrator), D (the CRM demonstration), E (access control and
club isolation) or S (Hebrew, phone layout, persistence). `--shots` saves
screenshots to `scratch/e2e/`. The full run takes about ten minutes.

### Note on the toolchain

This prototype was built in a sandbox with no access to the npm registry, using
packages that were already present on the machine. Three consequences:

- **No Vite, Motion or Recharts.** The build is a short script
  (`scripts/build.mjs`) that calls esbuild and Tailwind CSS v4 directly and
  inlines everything into one HTML file. Animations are CSS. Charts are small
  SVG components on d3-scale and d3-shape. Icons are Lucide, via react-icons.
- **React types are a local shim.** `@types/react` was not available, so
  `types/react-shim.d.ts` declares the subset of React's types the app uses.
  With registry access, install `@types/react` and `@types/react-dom`, delete
  the shim and expect some stricter DOM-attribute errors to fix.
- **`npm install` from `package.json` has not been run here.** The listed
  versions are the ones the build actually used, but a clean install was not
  possible to verify in this environment.

## Layout

```
src/engine/          rules engine and tournament engine (no UI, no browser APIs)
src/platform/        the service layer:
  types.ts             domain model
  permissions.ts       roles and the 22 permissions
  core.ts              ids, audit, notifications and delivery records
  api.ts               clubs, follows, memberships, tournaments and access, announcements, tenants
  crm.ts               player database, profiles, tags, notes, segments, invitation links, export
  messaging.ts         player-to-club conversations, blocking, reports
  automation.ts        the five automation rules
  analytics.ts         funnel, KPIs, retention, acquisition, engagement (computed from records)
  runtime.ts, store.ts scheduler, tables, storage
src/app/             session, routing, shells (v2 + v3), design switch (design.ts, variants.ts), hooks
src/ui/              design-system primitives, overlays, charts, club identity
src/styles/          app.css (v0.2 look) and app-v3.css (v0.3 look); both define the same tokens
src/table/           the poker table: stage, cards, chips, action bar
src/player/          player screens (club page, clubs, lobby, messages, ...)
src/console/         club management console
src/console/crm/     CRM screens: overview, players, profile, requests, segments, inbox,
                     notifications, analytics, automation, settings
src/platform-admin/  platform administration
src/i18n/            English and Hebrew messages
tests/               engine, tournament, platform, CRM and translation tests
scripts/             build, dev server, end-to-end journeys, translation check
docs/                audit, architecture, completion report, v0.3 design system and redesign report, screenshots
```

## Read next

- `docs/DESIGN_V3.md` describes the v0.3 design system, the navigation, the
  v2/v3 switch and how to roll the look back. `docs/REDESIGN_REPORT_V3.md` is
  the delivery report for the redesign (changed files, tests, screenshots).
- `docs/COMPLETION_REPORT.md` states plainly what works, what is simulated,
  what is partial, what is missing, and what production would need. It also
  holds the test results and the list of outstanding issues.
- `docs/ARCHITECTURE.md` explains how the pieces fit, the data model and
  permission rules, and how this maps to a production deployment.
- `docs/CRM_AUDIT.md` is the audit of the application as it stood before the
  CRM work, with the authorization problems that were fixed first.

## Boundary

Poker Club OS is a product prototype, not a gambling service. Before any
commercial launch, the legal and regulatory position in each market has to be
reviewed by qualified counsel. Product names of other poker software are not
used or imitated anywhere in the interface.
