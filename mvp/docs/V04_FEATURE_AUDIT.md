# Poker Club OS v0.4 — feature gap audit

Milestone A deliverable. Every capability named in the v0.4 brief is classified against the
code as it stands on `feature/v0.4-features`, using the brief's five labels:

| Label | Meaning here |
|---|---|
| **IMPLEMENTED AND TESTED** | In the build, exercised by an executed unit test and/or e2e check named in the row. |
| **UNVERIFIED** | In the build, works in manual use, but no automated check covers it. |
| **PARTIAL** | Part of the capability exists; the missing part is stated. |
| **DEMO** | Works end to end on simulated data only, by design, and is labelled as such in the UI. |
| **MISSING** | Not in the build. |

Test names refer to `tests/*.test.ts` (node:test) and `scripts/e2e.mjs` journeys A–F and S
(Playwright). Counts are from the final run recorded in `V04_REPORT.md`.

## 1. State before v0.4 (what was preserved)

| Area | Status | Notes |
|---|---|---|
| Hold'em engine, tournament clock, seating, bots, hand history | IMPLEMENTED AND TESTED | `engine`, `tournament`, `platform`; journeys A, C |
| Club console, wizard, tournament control, branding, roles, audit | IMPLEMENTED AND TESTED | journeys B, E |
| CRM (players, requests, tags/segments, inbox, announcements, analytics, automation, settings) | IMPLEMENTED AND TESTED | `crm` (50), journey D |
| v0.3 design (graphite & ember), per-tournament table branding, club table presets | IMPLEMENTED AND TESTED | `table-branding`; journeys B, S |
| Platform console (tenants, plans, billing *demo*, health *demo*, support) | DEMO / UNVERIFIED | Billing and health are demo data by design (no money anywhere) |
| Integrity review queue | was DEMO with fabricated cases | replaced in v0.4, see §9 |

Nothing in this list was rebuilt or replaced. v0.4 adds modules beside them and touches shared
files only where a feature needed a field (`types.ts`, `seed.ts`, routers, navigation).

## 2. Multi-variant poker (Milestone B)

| Capability | Status | Evidence |
|---|---|---|
| Variant registry (NLHE, PLHE, FLHE, Short Deck, PLO4/5/6, PLO8, FLO, FLO8) | IMPLEMENTED AND TESTED | `variants` (24) |
| Omaha exactly-two-hole-cards rule | IMPLEMENTED AND TESTED | `variants`: hand evaluation cases |
| Pot-limit maximum (stack vs. pot + call) | IMPLEMENTED AND TESTED | `variants` |
| Fixed-limit small/big bet, cap of four bets | IMPLEMENTED AND TESTED | `variants` |
| Short deck (36 cards; flush > full house; A-6-7-8-9 straight) — documented convention | IMPLEMENTED AND TESTED | `variants`, `engine/variants.ts` header comment |
| Hi/Lo (8 or better) split, quartering, odd chip | IMPLEMENTED AND TESTED | `variants` showdown cases |
| Game selection cards in the wizard; unsupported combos blocked (`game_not_available`, table size cap) | IMPLEMENTED AND TESTED | `competition`/`platform` draft validation; journey B |
| Stud, draw, mixed games, run-it-twice and other rule modifiers | MISSING (listed as planned in the registry, blocked in the UI) | `RULE_MODIFIERS` are typed and shown as "planned"; never selectable |

## 3. Formats, scheduling, calendar (Milestones B, D, F)

| Capability | Status | Evidence |
|---|---|---|
| Templates (save from wizard, start from template) | IMPLEMENTED AND TESTED | `scheduling` (4); journey F |
| Recurring schedules in club time, DST-safe, idempotent publishing, pause/delete | IMPLEMENTED AND TESTED | `scheduling` incl. a DST-crossing case; journey F |
| Series / seasons | IMPLEMENTED AND TESTED | leagues, `competition` (11) |
| Personal calendar (month / week / list), registered + followed clubs + league dates | IMPLEMENTED AND TESTED | `calendar` (5); journey F |
| Personal reminders (1 h / 24 h) delivered in-app by the tick | IMPLEMENTED AND TESTED | `calendar` |
| `.ics` export | IMPLEMENTED AND TESTED | `calendar` (format), journey F (button) |
| Timezone / DST handling for schedules and recommendations | IMPLEMENTED AND TESTED | `scheduling`, `retention` |
| Bounties, satellites, shootouts and other new formats | MISSING | Not started; presets remain turbo / regular / deep / sit & go |

## 4. Competition layer (Milestone C)

| Capability | Status | Evidence |
|---|---|---|
| Global leaderboard with categories, filters, weighted score, min eligibility | IMPLEMENTED AND TESTED | `competition`; journey F (Rankings loads) |
| Fairness: bots, demo-seeded results (unless opted in), cancelled and invalidated results excluded | IMPLEMENTED AND TESTED | `competition` |
| Public profiles with visibility control | IMPLEMENTED AND TESTED | `competition` (private profiles drop off the board) |
| Club leaderboards (all-time / monthly / season), #1, top 3, previous champions | IMPLEMENTED AND TESTED | `competition`; UNVERIFIED for the "previous champions" rendering (no e2e) |
| Leagues & seasons: configurable points, presets, versioned rules, frozen history | IMPLEMENTED AND TESTED | `competition` |
| Ranks/tiers with original emblems, achievements engine | IMPLEMENTED AND TESTED | `competition` |
| Streaks | PARTIAL | Final-table and cash streak data is computed in player stats; no dedicated streak achievements |
| Profile tabs (Overview / Statistics / History / Rankings / Achievements / Seasons) | IMPLEMENTED (UNVERIFIED by e2e beyond load) | `src/player/Profile.tsx` |

## 5. Growth (Milestone D)

| Capability | Status | Evidence |
|---|---|---|
| Personal referral links with club / referrer / campaign; journey opened → requested → approved → played → returning | IMPLEMENTED AND TESTED | `referral` (3); journey F |
| CRM attribution, dashboard, drill-down to players, referrer on profile and requests | IMPLEMENTED AND TESTED | `referral`; journey F |
| Non-monetary recognition (achievements `referral_first`, `referral_five`) | IMPLEMENTED AND TESTED | `referral` |
| Self-referral ignored; approval never bypassed | IMPLEMENTED AND TESTED | `referral` |
| QR codes (own encoder, versions 1–9, EC-M) for club and personal links | IMPLEMENTED AND TESTED | `qr` (2); journey F (card rendered); decoding verified out-of-band with OpenCV during development |
| Club discovery, social links, invite links by source | IMPLEMENTED (pre-v0.4) | journeys A, D |
| Link previews / Open Graph when sharing | MISSING | Needs a server to render per-link pages |

## 6. Retention engine (Milestone E)

| Capability | Status | Evidence |
|---|---|---|
| Inactivity alerts 7 / 14 / 30 days → exact built-in segment | IMPLEMENTED AND TESTED | `retention` (6); journey F |
| Daily staff alert when someone crosses a bucket | IMPLEMENTED AND TESTED | `retention` |
| Segments: VIP, Hold'em, Omaha, league participants, referred members; new rule fields | IMPLEMENTED AND TESTED | `retention` |
| Player preferences (derived, "How they play") | IMPLEMENTED AND TESTED | `retention` |
| Activity heatmap + scheduling recommendations + USE RECOMMENDED TIME in the wizard | IMPLEMENTED AND TESTED | `retention`; journey F |
| Weekly report (copy as text, send to staff inboxes) | IMPLEMENTED AND TESTED (send: UNVERIFIED by e2e) | `retention` |
| Campaign audience / consent | IMPLEMENTED (pre-v0.4: segment audiences, per-person preferences, club opt-outs) | `crm` tests |

## 7. Notifications (Milestone H)

| Capability | Status | Evidence |
|---|---|---|
| In-app channel | IMPLEMENTED AND TESTED | `crm`, `channels` |
| Provider-agnostic adapter registry | IMPLEMENTED AND TESTED | `channels` (3) |
| Email / SMS / WhatsApp / push | DEMO | demo adapters write `simulated` outbox rows; UI labels them; **no claim of delivery anywhere** |
| Delivery statistics | IMPLEMENTED AND TESTED (honest) | `channels`: simulated never counts as delivered |

## 8. Operations (Milestone F)

| Capability | Status | Evidence |
|---|---|---|
| Multi-club overview for staff | IMPLEMENTED (UNVERIFIED: no e2e beyond load) | `src/player/StaffOverview.tsx`, QC sweep |
| 5-minute club creation wizard | IMPLEMENTED AND TESTED | `migration` (club creation, 2); journey F |
| Migration assistant (CSV → records, attach on approval, no fake accounts) | IMPLEMENTED AND TESTED | `migration` (2); journey F |
| Tournament history import | MISSING | Only member lists import; results would need a trusted source |
| Live ops dashboard | PARTIAL | Tournament control (pre-v0.4) plus the staff overview's live/next rows; no cross-club live table grid |

## 9. Integrity, spectating, responsible play (Milestones G, H)

| Capability | Status | Evidence |
|---|---|---|
| Integrity cases derived from history (bust pattern, co-finish, win rate), review workflow, audit | DEMO + TESTED | `integrity` (2); journey C, F — **signals come from simulated play and say so** |
| Spectator mode with a real delayed-state buffer (≥ 30 s) | IMPLEMENTED AND TESTED | `spectator` (3); journey F (buffer, then frame) |
| Streamer mode (all cards, ≥ 60 s, staff only) | IMPLEMENTED AND TESTED | `spectator` |
| Broadcast overlay layout | IMPLEMENTED (UNVERIFIED) | green-screen background, exit button |
| Responsible play: time reminder, self-set break blocking registration | IMPLEMENTED AND TESTED | `channels` (responsible play case) |
| Deposit/loss limits | not applicable | there is no money in the product; demo points only |
| Hand replayer: street jumps, speed, keyboard, copy as text | IMPLEMENTED (UNVERIFIED beyond journey A's step-through) | `src/player/Hands.tsx` |

## 10. White-label branding

| Capability | Status | Evidence |
|---|---|---|
| Tournament → Club inheritance of table branding | IMPLEMENTED AND TESTED (v0.3) | `table-branding` |
| Club → Platform defaults (theme catalogue, accent) | IMPLEMENTED (UNVERIFIED) | `platform/table-branding.ts` THEMES as platform defaults |
| Platform-level override of club branding | MISSING | No platform branding editor |

## 11. Production multiplayer infrastructure

| Capability | Status | Evidence |
|---|---|---|
| Server-authoritative plan, data model, API boundary, migration path | IMPLEMENTED (document) | `PRODUCTION_ARCHITECTURE.md` |
| Auth, PostgreSQL, WebSockets, deployment | MISSING (by scope) | The prototype runs entirely in the browser; see the plan |

## 12. Cross-cutting rules checked in code

- No real-money features: every balance is demo points (`platform.test`, `crm.test`).
- Access codes never bypass account-level access (journey E).
- Opponents' hidden cards never reach the client: `viewOf` redaction (engine tests), spectator
  public frames (`spectator`), `viewOfAll` only inside the delayed streamer path.
- Computer-controlled opponents are labelled BOT everywhere they appear (journeys A, C, F).
- Simulated functionality is labelled: demo bar, demo history tags, channel summary, integrity
  banner, recurring-schedule note.
- No provider secrets in the bundle: adapters are a registry with demo implementations;
  `channels.ts` documents the server-side registration point.
