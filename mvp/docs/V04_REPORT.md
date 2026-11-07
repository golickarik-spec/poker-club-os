# Poker Club OS v0.4 — master feature expansion report

Branch `feature/v0.4-features`, tagged `v0.4.0`. Built on the approved v0.3 state
(`feature/v0.3-redesign` @ `95edbd6`, tag `v0.3.0`); the v0.2 and v0.3 backups are untouched.

Sections A–H below are given per milestone, as the brief asks. The feature classification
(IMPLEMENTED AND TESTED / UNVERIFIED / PARTIAL / DEMO / MISSING) is in `V04_FEATURE_AUDIT.md`;
the production plan is in `PRODUCTION_ARCHITECTURE.md`.

## Final test run (executed on the final build)

| Suite | Result |
|---|---|
| Unit — engine, variants, tournament, table branding, i18n, QR | 90 / 90 |
| Unit — competition, referral, calendar, retention, migration, scheduling, spectator, integrity, channels | 41 / 41 |
| Unit — platform (runtime, scheduler, notifications, permissions) | 39 / 39 |
| Unit — CRM (incl. architecture tests) | 50 / 50 |
| **Unit total** | **220 / 220** |
| E2E A — player joins, plays real hands, reviews | 15 / 15 |
| E2E B — owner creates club content, branding, roles | 19 / 19 |
| E2E C — platform admin | 14 / 14 |
| E2E D — CRM demo | 54 / 54 |
| E2E E — access rules (codes never bypass membership) | 23 / 23 |
| E2E F — v0.4 journeys | 28 / 28 |
| E2E S — smoke: phone widths, Hebrew, reload | 12 / 12 |
| **E2E total** | **165 / 165** |
| Responsive QC sweep (37 screens × EN/HE × 1440/1280/768/390/360) | 0 screens flagged |
| `tsc --noEmit` (strict, no unused locals) | clean |
| i18n key check | 0 missing in EN, 0 in HE |

Commands: `node --import tsx --test tests/*.test.ts` (run in four chunks because the CRM
suite alone takes ~2.5 min), `node scripts/build.mjs --design=v3 && node scripts/e2e.mjs --only=X`,
`node scratch/qc.mjs --w=1440,1280,768,390,360 --lang=en,he`.

## Git history (newest first)

| Commit | Content |
|---|---|
| `adefd7c` | v0.4.0 docs: audit, architecture plan, this report; tag `v0.4.0` |
| `55f44c1` | QA: e2e journey F, smoke routes, mobile fixes |
| `8fa2176` | H: channel adapters, responsible play, replayer |
| `3d5a315` | G: delayed spectator/streamer feed, integrity cases |
| `c42984d` | F (2/2): templates and recurring schedules |
| `8b015c2` | F (1/2): club creation wizard, multi-club overview, migration assistant |
| `3bed945` | E: retention engine |
| `0d51707` | D: referrals, QR codes, personal calendar |
| `10bf631` | C (UI): rankings, profile tabs, leagues UI, demo seasons |
| `705fc1e` | C (logic): performance scoring, leaderboards, tiers, leagues, achievements |
| `6c04f5e` | B (integration): game choice in tournaments; tables deal and render any variant |
| `399882e` | B (engine): variant registry, Omaha / Short Deck / pot-limit / fixed-limit / Hi-Lo |

Visual and business-logic work are in separate commits where a milestone had both (B, C).
Every commit is revertible on its own: `git revert <id>`; the schema bump (v6 → v7) means a
revert past `0d51707` reseeds the demo on next load, which is the intended behaviour.

**Rollback:** `git checkout feature/v0.3-redesign` (or tag `v0.3.0`) and
`node scripts/build.mjs --design=v3` reproduces the approved v0.3 build exactly;
`backup/v0.2-original-design` still holds v0.2.

---

## Milestone A — audit and infrastructure plan

**A. Features implemented.** Feature gap audit (`V04_FEATURE_AUDIT.md`), production
architecture plan (`PRODUCTION_ARCHITECTURE.md`), this report.
**B. Code changes.** Docs only. **C. Reused.** The existing `ARCHITECTURE.md` section 3
(service layer shape) is the basis of the API boundary. **D. Tests.** The architecture test
in `tests/crm.test.ts` enforces the boundary the plan relies on (screens never read private
stores or unguarded calculations) — it caught two v0.4 screens during development and both
were fixed to go through guarded functions. **E. Demo.** n/a. **F. Limitations.** The plan is
a document; no server exists (MISSING by scope). **G. Production dependencies.** Node service,
PostgreSQL, Redis, auth provider, channel providers. **H. Version control.** Docs commits.

## Milestone B — multi-variant poker

**A.** Variant registry with 10 implemented games (NLHE, PLHE, FLHE, Short Deck, PLO4/5/6,
PLO8, FLO, FLO8) and typed rule modifiers marked *planned*; Omaha exactly-two rule;
pot-limit maths; fixed-limit bets and cap; short deck 36-card ranking (documented convention:
flush beats full house, A-6-7-8-9 lowest straight); Hi/Lo 8-or-better with quartering and odd
chips; game selection cards in the wizard; unsupported combinations blocked (table size
capped by the deck); tables deal and render N hole cards; equities and hand names per
variant. Seeded Omaha and short-deck tournaments and Omaha history in two demo clubs.
**B.** `src/engine/variants.ts`, `hands.ts`, `evaluator.ts`, `cards.ts`, `holdem.ts`,
`view.ts`, `bots.ts`, `equity.ts`; `platform/api.ts` (draft validation), `runtime.ts`;
`console/GamePicker.tsx`, `Wizard.tsx`; `table/*` (card scale, action bar for fixed-limit).
**C. Reused.** The Hold'em hand machine, action/legal-actions model, showdown awards and the
v0.3 table stage; nothing was replaced. **D. Tests.** `variants` 24, updated `engine`.
**E. Demo.** Console → New tournament → choose "Pot-Limit Omaha" → publish → watch a table;
or open the seeded "Short Deck Showdown". **F. Limitations.** Stud/draw/mixed and run-it-twice
MISSING (blocked in UI); bots play Omaha with a simplified preflop model (DEMO quality).
**G.** None beyond the engine moving server-side. **H.** `399882e`, `6c04f5e`.

## Milestone C — competition layer

**A.** Performance score (field-size weighted, win/final-table bonus, sit & go factor);
global leaderboard with categories, season/month windows, game and club filters, minimum
eligibility, public-profile visibility; fairness: bots, cancelled and invalidated results
excluded, demo history opt-in; club leaderboards (all-time / monthly / season, #1, top 3,
previous champions); leagues with scoring presets, versioned rules, best-N, participation
points, completion that freezes standings and awards; tiers with original emblems;
achievements engine; profile with six tabs. **B.** `platform/competition.ts`, `types.ts`
(League, achievements, schema v6), `seed.ts` (staff in results, seeded seasons),
`player/Rankings.tsx`, `Profile.tsx`, `LeaguePage.tsx`, `console/Leagues.tsx`,
`shared/competition.tsx`. **C. Reused.** Results store, club ranking (v0.3) kept as the
"Clubs" tab, identity/avatar components. **D.** `competition` 11; e2e F loads rankings.
**E. Demo.** Rankings → Global (toggle demo history), Leagues → "Summer Championship"
(completed, frozen) and "Autumn League" (active); Console → Leagues → complete a season.
**F.** Streak achievements PARTIAL; previous-champions UI UNVERIFIED by e2e.
**G.** None. **H.** `705fc1e` (logic), `10bf631` (UI).

## Milestone D — community and growth

**A.** Personal referral links per member and campaign; attributed journey; dashboard with
funnel KPIs, per-referrer table, drill-down and recent journeys; referrer on CRM profile and
membership requests; non-monetary recognition; self-referral ignored; approval never
bypassed. QR encoder and QR cards for club and personal links, plus per-link QR in CRM
settings. Personal calendar (month / week / list, `.ics` export, reminders 1 h / 24 h via
the tick). **B.** `platform/crm.ts` (referral section), `api.ts` (openInvite, awards),
`calendar.ts`, `automation.ts` (personal reminders), `ui/qr.ts`, `shared/qr.tsx`,
`player/InviteDialog.tsx`, `Calendar.tsx`, `console/crm/Referrals.tsx`, `Requests.tsx`,
`PlayerProfile.tsx`, `CrmSettings.tsx`; schema v7 (`db.reminders`). **C. Reused.** Invite
links, CRM profiles/events (first-touch attribution), notifications, Dialog/Menu/Badge.
**D.** `referral` 3, `qr` 2, `calendar` 5; e2e F (invite + QR, calendar, dashboard). QR output
was additionally decoded with OpenCV during development for versions 1–9. **E. Demo.** Club
page → ⋯ → Invite a friend; Calendar; Console → CRM → Referrals. **F.** Link previews /
OG pages MISSING (needs a server). **G.** A public join domain for the links. **H.** `0d51707`.

## Milestone E — retention engine

**A.** Inactivity alerts 7–13 / 14–29 / 30+ days, each tied to a built-in segment with
identical membership; daily staff alert; new segment fields (game family, league, referred)
and built-in segments (VIP regulars, Hold'em, Omaha, league participants, referred members);
derived player preferences; activity heatmap in club time with three scheduling
recommendations (a slot needs ≥ 2 tournaments) and a shortcut into the wizard; "Use
recommended time" in the wizard; weekly report with copy-as-text and send-to-staff.
**B.** `platform/retention.ts`, `crm.ts` (fields, segments), `analytics.ts` (variant on
participations), `console/crm/RetentionAlerts.tsx`, `Scheduling.tsx`, `Overview.tsx`,
`PlayerProfile.tsx`, `Segments.tsx`, `Wizard.tsx`, `app/format.ts` (`dateTimeIn`).
**C. Reused.** Segment engine, participation index, Heatmap/StatTile charts, announcement
audiences. **D.** `retention` 6; e2e F (alerts → players, slot → wizard, use recommended).
**E. Demo.** Console → CRM overview (alerts); Analytics → Best times; New tournament →
Schedule step. **F.** Weekly "send to staff" UNVERIFIED by e2e. **G.** None. **H.** `3bed945`.

## Milestone F — operations

**A.** Self-service club creation (owner = creator, Starter plan, CRM scaffolding, three clubs
per owner) with a four-step wizard and optional first tournament; staff overview across clubs
(live, pending, unread, at-risk, next); migration assistant (CSV with quoted fields and
EN/HE header synonyms, manual mapping, row-level problems, commit of clean rows as records,
auto-attach on approval by email carrying member number, tags and original joining date;
manual attach; delete; batch undo); templates and recurring schedules (club-local, DST-safe,
lead window, pause/resume, idempotent). **B.** `platform/api.ts` (`buildClub`, `createClub`,
`setBreak`), `migration.ts`, `scheduling.ts`, `automation.ts` (runSchedules),
`player/ClubWizard.tsx`, `StaffOverview.tsx`, `console/crm/Migration.tsx`,
`console/Recurring.tsx`, `Tournaments.tsx`, `Wizard.tsx`. **C. Reused.** Tenant provisioning
(now shared with `createClub`), branding pickers, wizard drafts, tournament creation and
publishing. **D.** `migration` 4, `scheduling` 4 (incl. the 25 Oct 2026 DST change); e2e F.
**E. Demo.** My clubs → Open a club; Console → CRM settings → Migration assistant (paste the
sample); Tournaments → Templates & recurring → resume "Thursday nights". **F.** Tournament
history import MISSING; live-ops cross-club table grid PARTIAL; demo schedule ships paused so
tests stay deterministic. **G.** Server scheduler for recurring publishing. **H.** `8b015c2`,
`c42984d`.

## Milestone G — integrity and spectating

**A.** Delayed spectator feed: per-table ring buffer of public and full snapshots; spectators
get frames ≥ 30 s old with no hidden cards; streamer mode (every hand face up) only for
tournament staff and only from frames ≥ 60 s old; spectator screen with delay selector,
overlay layout and table picker; entry points from the lobby and tournament control.
Integrity cases computed from simulated results (eliminations of each other, co-finishes,
win rate vs field) with review workflow, notes and audit; platform queue and per-club "Fair
play" page; everything labelled simulated. **B.** `platform/runtime.ts` (`feeds`,
`spectate`), `engine/view.ts` (`viewOfAll`, server-only), `platform/integrity.ts`,
`platform-admin/Integrity.tsx` (rewritten from fabricated cases), `table/SpectatorScreen.tsx`,
`console/TournamentControl.tsx`, `player/Lobby.tsx`. **C. Reused.** `viewOf` redaction,
TableStage, lobby table grid, audit. **D.** `spectator` 3, `integrity` 2; e2e C, F (buffer,
then a frame behind live). **E. Demo.** Tournament lobby of "River Kings Daily Turbo" → Watch
delayed (wait 30 s); as owner → Streamer view; Console → Fair play → open a case.
**F.** Integrity is DEMO: signals derive from simulated play; broadcast overlay UNVERIFIED.
**G.** Delayed channel on the realtime gateway; certified RNG. **H.** `3d5a315`.

## Milestone H — channels, responsible play, replayer

**A.** Provider-agnostic channel adapters (in-app real; email/SMS/WhatsApp/push demo
adapters that record `simulated` outbox rows and are never counted as delivered), per-user
channel switches labelled as demo, honest channel summary in the notifications centre;
responsible play (table time reminder, self-set break blocking registration, audited);
replayer street jumps, speed, keyboard, copy as text. **B.** `platform/channels.ts`,
`core.ts` (fan-out), `api.ts`, `types.ts`, `player/Settings.tsx`, `Hands.tsx`,
`table/TableScreen.tsx`, `console/crm/NotificationsCenter.tsx`. **C. Reused.** `notify`,
delivery batches, settings. **D.** `channels` 3. **E. Demo.** Settings → Other channels /
Playing well; Hand history → open a hand. **F.** External channels DEMO by design; deposit
limits n/a (no money). **G.** Real adapters registered server-side with provider secrets.
**H.** `8fa2176`.

## Demonstrations 1–9 (brief §29)

1. Variant tournament: Console → New tournament → PLO → publish → table deals four cards.
2. League season: Rankings → Leagues → Summer Championship (frozen) / Console → Leagues.
3. Global leaderboard with fairness toggles: Rankings → Global.
4. Referral journey: Invite a friend → copy link → as New player open the link → request →
   as owner approve → Referrals dashboard moves the person to "Approved".
5. Retention alert → segment → announcement: CRM overview → "Message segment".
6. Heatmap → recommended time → wizard: Analytics → Best times → Schedule a tournament then.
7. Migration: CRM settings → Migration assistant → sample CSV → import → approve a matching
   person → record attached (tests cover the attach; the demo shows the waiting record).
8. Spectator with delay: lobby → Watch delayed → buffering → frame 30 s behind live.
9. Club creation in five minutes: My clubs → Open a club → four steps → console.

## Known limitations (consolidated)

- No server: every "worker" is the page's housekeeping tick; multi-device play is not possible.
- Integrity signals, external channels, billing and health are demo/simulated and labelled.
- Omaha bots are simplified; stud/draw/mixed games are blocked, not hidden.
- Tournament history import, OG link previews, platform-level branding overrides: missing.
- Demo scheduling shows times in the viewer's browser timezone except where the club's time
  is stated explicitly (best times, recurring previews).
