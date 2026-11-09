# 02 — Feature Inventory

> **Audience: all.** The complete, consolidated list of what Poker Club OS does, grouped by
> area, with honest status. Status vocabulary (from `00-INDEX.md`): **IMPLEMENTED** (built +
> tested), **DEMO** (works on simulated data by design, labelled in UI), **PARTIAL** (part
> exists; gap named), **MISSING** (not built).
>
> This is the superset of `mvp/docs/V04_FEATURE_AUDIT.md`, `mvp/docs/V04_REPORT.md`, `mvp/docs/COMPLETION_REPORT.md`, and
> the design docs. Test counts are the 0.4.0 run: **220 unit / 165 e2e**.

---

## 1. Poker engine (`mvp/src/engine`)

Pure TypeScript, no UI or browser APIs. Event-sourced: every hand is an ordered log of events
(`start`, `post`, `hole`, `turn`, `action`, `collect`, `show`, `showdown`, `award`, `end`),
and everything the UI shows is derived by a reducer from that log. Per-viewer redaction
(`redactEvent` / `view.ts`) means a client only ever receives its own cards — the contract is
already shaped for a server/WebSocket split.

| Capability | Status | Notes |
|---|---|---|
| Hold'em rules (blinds, betting, min-raise, short all-ins, side pots, split pots, odd chips) | IMPLEMENTED | `engine.test.ts` (37), incl. a 4,000-hand chip-conservation fuzz |
| Hand evaluation (5–7 cards → one integer) | IMPLEMENTED | Checked against all 2,598,960 five-card hands |
| **10 game variants** — NLHE, PLHE, FLHE, Short Deck, PLO4/5/6, PLO8, FLO, FLO8 | IMPLEMENTED | `variants.test.ts` (24) |
| Omaha exactly-two-hole-cards; pot-limit maths; fixed-limit small/big bet + 4-bet cap | IMPLEMENTED | `variants.test.ts` |
| Short deck (36 cards; flush > full house; A-6-7-8-9 straight) | IMPLEMENTED | Documented convention |
| Hi/Lo (8-or-better) split, quartering, odd chip | IMPLEMENTED | `variants.test.ts` showdown cases |
| Command validation (seat/hand/seq/actionId idempotency) | IMPLEMENTED | Guards double-clicks, stale/out-of-order/duplicate actions |
| CSPRNG shuffle (Fisher–Yates over `crypto.getRandomValues`, no modulo bias) | IMPLEMENTED | Seeded RNG in tests; **not** certified, never claimed to be |
| Simulated opponents (5 styles, Monte-Carlo equity, information-isolated) | IMPLEMENTED | Test asserts a bot sees no other player's cards |
| Omaha bot strategy | PARTIAL / DEMO | Simplified for Omaha variants |
| Stud, draw, mixed games, run-it-twice | MISSING | Typed in the registry, shown as "planned", blocked in the UI |

## 2. Tournament engine (`mvp/src/engine/tournament.ts`, `structure.ts`)

Time is injected (`advanceClock`), so a whole tournament runs in milliseconds in tests and the
demo runs at ×1–×240.

| Capability | Status |
|---|---|
| Structures (Turbo / Regular / Deep / Sit & Go presets, wizard editor, validation, duration estimate) | IMPLEMENTED |
| Random seating across the minimum number of tables | IMPLEMENTED |
| One "driven" table paced for a viewer; all other tables play instantly in the background | IMPLEMENTED |
| Table balancing (break idle tables, move the next big blind, never mid-hand) | IMPLEMENTED |
| Late registration (full stack while window open); pause/resume | IMPLEMENTED |
| Eliminations ranked by starting stack on same-hand busts; results (order, knockouts, duration) | IMPLEMENTED |
| Lifecycle: DRAFT → SCHEDULED → REGISTRATION_OPEN → … → RUNNING ⇄ PAUSED → COMPLETED (+ CANCELLED) | IMPLEMENTED |
| New formats: bounties, satellites, shootouts, multi-day, rebuy/re-entry/add-on | MISSING |
| Tournament history import (results from a trusted external source) | MISSING |

Covered by `tournament.test.ts` (15): complete tournaments up to 64 players, late entry,
balancing, elimination ranking.

## 3. CRM & community (club console, `mvp/src/console/crm`)

The richest part of the product. One row per person who has any relationship with a club,
built on demand so a figure and its underlying list can never disagree.

| Area | Status | Detail |
|---|---|---|
| Player database (search, filters on status/tags/lifecycle/activity/tournaments/assignment/segment, 7 sort orders, bulk actions) | IMPLEMENTED | Search by name / username / user id / member id |
| Tags (9 colours), notes (authored, versioned), staff assignment | IMPLEMENTED | Club-private `crm` store |
| Segments — dynamic (rule builder: status, activity, tournaments played, game family, source, referral, league, VIP, …; all/any) and static; **14 built-in system segments** (`SYSTEM_SEGMENTS`) | IMPLEMENTED | Re-evaluated live; system segments listed in §7 |
| Inbox / messaging (one conversation per player+club, internal notes, assign, resolve, unread counts, rate limits, blocking, abuse reports) | IMPLEMENTED | `messaging.ts` |
| Announcements + delivery records (eligible vs delivered vs opted-out, read tracking) | IMPLEMENTED | `core.deliver` |
| Automation — **5 rules** (welcome, reminder, new public tournament, membership request, inactive tagging), each with a dedupe key | IMPLEMENTED | Fires once even if triggered twice |
| Personal-data deletion ("forget player", `crm.forgetPlayer`), data retention (`applyRetention`, days), per-club channel opt-out, CSV/JSON export | IMPLEMENTED | Privacy/GDPR-shaped controls in CRM settings + player profile |
| CRM settings, member numbering, sources | IMPLEMENTED | — |
| **The 12 console CRM screens** (overview, players, player profile, requests, segments, inbox, notifications, analytics, automation, referrals, migration, settings) | IMPLEMENTED | `crm.test.ts` (50), journey D (54 checks) |

## 4. Analytics (`mvp/src/platform/analytics.ts`)

Stores nothing; every figure recomputes from two sources (tournament participation + the CRM
event log).

| Capability | Status |
|---|---|
| Conversion funnel (New followers → Requests → Approved → First-time → Returning), with observation window and previous-period comparison, each stage drillable | IMPLEMENTED |
| 4 KPI cards (follower→member, member→player, repeat participation, tournaments per active player) | IMPLEMENTED |
| Retention (7/30/90-day return rates, monthly cohorts) | IMPLEMENTED |
| Acquisition sources (no fingerprinting; "Unknown" bucket) | IMPLEMENTED |
| Engagement (DAU/WAU/MAU) | IMPLEMENTED |

Analytics tests build known data (e.g. 1,000 followers → 600 request → 480 approved → 300 play
→ 180 return) and check counts and percentages against hand-calculated values.

## 5. Competition layer (`mvp/src/platform/competition.ts`)

| Capability | Status |
|---|---|
| Global leaderboard (categories, filters, weighted score, min eligibility, season/month windows) | IMPLEMENTED |
| Fairness exclusions (bots, demo-seeded unless opted in, cancelled/invalidated results) | IMPLEMENTED |
| Public profiles with visibility control (private profiles drop off the board) | IMPLEMENTED |
| Club leaderboards (all-time / monthly / season, #1, top 3, previous champions) | IMPLEMENTED (previous-champions UI UNVERIFIED by e2e) |
| Leagues & seasons (configurable points, presets, versioned rules, frozen history, best-N) | IMPLEMENTED |
| Ranks / tiers with original emblems; achievements engine | IMPLEMENTED |
| Profile tabs (Overview / Statistics / History / Rankings / Achievements / Seasons) | IMPLEMENTED (load-verified) |
| Streak achievements | PARTIAL — streak data computed, no dedicated achievements |

Covered by `competition.test.ts` (11).

## 6. Growth (`referral`, `qr`, `calendar`)

| Capability | Status |
|---|---|
| Personal referral links (club / referrer / campaign); attributed journey opened→requested→approved→played→returning | IMPLEMENTED |
| CRM attribution dashboard, drill-down to players, referrer on profile and requests | IMPLEMENTED |
| Non-monetary recognition (`referral_first`, `referral_five` achievements); self-referral ignored; approval never bypassed | IMPLEMENTED |
| QR codes (own encoder, versions 1–9, EC-M) for club and personal links | IMPLEMENTED (decoding verified out-of-band with OpenCV) |
| Personal calendar (month / week / list), reminders (1 h / 24 h), `.ics` export | IMPLEMENTED |
| Club discovery, social links, invite links by source | IMPLEMENTED (pre-0.4) |
| Link previews / Open Graph when sharing | MISSING — needs a server to render per-link pages |

Covered by `referral.test.ts` (3), `qr.test.ts` (2), `calendar.test.ts` (5).

## 7. Retention engine (`mvp/src/platform/retention.ts`)

| Capability | Status |
|---|---|
| Inactivity alerts (7 / 14 / 30 days) → exact built-in segments; daily staff alert on bucket crossing | IMPLEMENTED |
| The 14 built-in system segments (`SYSTEM_SEGMENTS`): new members, active, inactive, regulars, winners, followers, at-risk 7, at-risk 14, inactive 30, VIP, Hold'em, Omaha, league players, referred | IMPLEMENTED |
| Derived player preferences ("how they play") | IMPLEMENTED |
| Activity heatmap + scheduling recommendations + "use recommended time" in the wizard | IMPLEMENTED |
| Weekly report (copy as text, send to staff inboxes) | IMPLEMENTED (send UNVERIFIED by e2e) |

Covered by `retention.test.ts` (6).

## 8. Notifications & channels (`mvp/src/platform/channels.ts`)

| Capability | Status |
|---|---|
| In-app channel | IMPLEMENTED |
| Provider-agnostic adapter registry (`registerAdapter`) | IMPLEMENTED |
| Email / SMS / WhatsApp / push | **DEMO** — demo adapters write `simulated` outbox rows; UI labels them; no delivery claimed |
| Delivery statistics (honest: simulated never counts as delivered) | IMPLEMENTED |
| Responsible play (table-time reminder, self-set break blocking registration) | IMPLEMENTED |

Covered by `channels.test.ts` (3).

## 9. Operations (club creation, migration, scheduling)

| Capability | Status |
|---|---|
| 5-minute club creation wizard (owner = creator) | IMPLEMENTED |
| Migration assistant (CSV → records, EN/HE header synonyms, manual mapping, row-level problems, auto-attach on approval by email, batch undo — **no fake accounts**) | IMPLEMENTED |
| Templates (save from wizard, start from template) | IMPLEMENTED |
| Recurring schedules (club-local time, DST-safe, lead window, pause/delete, idempotent publishing) | IMPLEMENTED (incl. a DST-crossing test) |
| Multi-club staff overview | IMPLEMENTED (load-verified) |
| Live-ops cross-club table grid | PARTIAL — tournament control + live/next rows exist; no unified grid |

Covered by `migration.test.ts` (4), `scheduling.test.ts` (4).

> **Note:** the 0.4 prototype caps self-service club creation at **3 clubs per owner**. The
> production subscription model replaces this with the plan-driven `maxClubs` (1 / 5 / 10) —
> see `04-PROFIT-MODULE.md`.

## 10. Integrity & spectating (`integrity`, `runtime` feeds)

| Capability | Status |
|---|---|
| Integrity cases from history (bust pattern, co-finish, win rate vs field), review workflow, notes, audit | **DEMO + TESTED** — signals come from simulated play and say so |
| Spectator mode with a real delayed buffer (≥ 30 s), no hidden cards | IMPLEMENTED |
| Streamer mode (all cards, ≥ 60 s, staff only) | IMPLEMENTED |
| Broadcast overlay layout | IMPLEMENTED (UNVERIFIED) |
| Hand replayer (street jumps, speed, keyboard, copy as text) | IMPLEMENTED (UNVERIFIED beyond journey A step-through) |

Covered by `spectator.test.ts` (3), `integrity.test.ts` (2).

## 11. Design system (`mvp/src/ui`, `mvp/src/styles`, `mvp/src/table`)

| Capability | Status |
|---|---|
| **Graphite & ember** token system (`--color-bg #0c0f13`, ember `#ff8a3d`, gold `#e3c27a`, radii 4–14px, status colours) | IMPLEMENTED |
| Dual look (v2 / v3) selected at build time (`--design=v2\|v3`, default v3); `variants.ts` is the only chooser | IMPLEMENTED |
| Typography (Inter UI, Archivo display, Fraunces for serif clubs, Heebo for Hebrew) | IMPLEMENTED (fonts from Google CDN at runtime) |
| Table rendering (stadium outline, CSS/SVG cards & chips, felt themes, timer ring, per-tournament branding) | IMPLEMENTED |
| Club accent as a live CSS variable reaching every screen; per-tournament table branding (logo source, opacity 4–35%, scale 50–140%, 5 felt themes, custom colour pickers, up to 8 club presets) | IMPLEMENTED |
| Charts (line, bar, ranked bars, heatmap, sparkline) with keyboard read-outs and a screen-reader table | IMPLEMENTED |
| Internationalization (English + Hebrew, same keys enforced by test, RTL via logical properties) | IMPLEMENTED |
| Accessibility (keyboard reach, visible focus, labelled icon buttons, reduced motion, high-contrast, four-colour deck) | IMPLEMENTED |
| Light mode | MISSING — tokens ready, not implemented |

## 12. Platform administration (`mvp/src/platform-admin`)

| Capability | Status |
|---|---|
| Tenants (clubs), plans editor, support tickets | IMPLEMENTED |
| Billing (invoices, usage, totals) | **DEMO** — placeholder `¤` currency, no money moves |
| Platform health | **DEMO** — simulated metrics |
| Platform-level branding override of clubs / white-label branding editor | MISSING |

## 13. Cross-cutting rules enforced in code

- **No real-money gameplay** — every chip balance is demo points; a build-time guard fails on
  money code paths (`platform.test`, `crm.test`). In production this guard is **rescoped to
  gameplay code** (engine / table / chip paths) so the legal-gated subscription billing module can
  exist beside it without weakening it — see `03` §8 and `04` §4.
- **Opponents' hidden cards never reach the client** — `viewOf` redaction; `viewOfAll` only on
  the server-side streamer path.
- **Access codes never bypass account-level access** (journey E).
- **Bots are labelled BOT everywhere**; **simulated functionality is labelled** (demo bar, demo
  history tags, channel summary, integrity banner, recurring-schedule note).
- **No provider secrets in the bundle** — channel adapters are a registry with demo
  implementations; the server-side registration point is documented.
- **Tenant isolation** — three architecture tests fail the build if any file outside
  `mvp/src/platform` reads the CRM store, conversations, unguarded calculations, or a tournament's
  access code.

## 14. What production adds to these features

The features above are feature-complete as a prototype. Production does not add new *features*
so much as make them **real**: a server so the permission checks protect against a hostile
client, a database so data survives, real accounts, real notification delivery, and the
monetization in `04-PROFIT-MODULE.md`. The handful of MISSING items that need a server
(link previews/OG, platform branding editor, cross-club live grid, tournament history import)
are called out in `08-ROADMAP.md`.

Production also adds the **store / legal compliance surface the prototype has no mechanism for
today** (all MISSING, built in the auth work — `03` §5, `08` Phase 4):

| Capability | Status | Note |
|---|---|---|
| In-app **account self-deletion** | MISSING | Apple requirement; distinct from club-side `crm.forgetPlayer`, which only removes a player from one club's CRM |
| **Age gate** at registration (17+/18+) | MISSING | Stores require it for a poker app even with virtual chips (`05` §5) |
| **ToS / privacy consent capture** at registration (versioned, timestamped) | MISSING | Technical half of the legal gate; documents are counsel's |
| **One account per verified email/phone** | PARTIAL | Code-enforced uniqueness exists for memberships/tags; verified-identity uniqueness for *accounts* needs the real auth layer — protects leaderboard/league integrity |
| **Sender-domain email auth** (SPF/DKIM/DMARC) | MISSING | So real delivery isn't spam-filed (`08` Phase 5) |

Also note: **player disconnect/timeout handling** (server auto-fold/sit-out) is required for real
multiplayer and is scheduled in `08` Phase 3 (not Phase 6).
