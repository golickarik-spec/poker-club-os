# 01 — Product Overview

> **Audience: business / product.** This document explains what Poker Club OS is, who uses it,
> how it makes money, and the strategy behind the roadmap. Engineering readers can skim it for
> context and move to `03-ARCHITECTURE-AND-SERVICES.md`.

---

## 1. What Poker Club OS is

Poker Club OS is a **B2B SaaS platform for running poker clubs**. Clubs use it to run
tournaments, manage their members, grow their community, and compete on cross-club
leaderboards. It is **virtual-chips-only** — the chips have no monetary value, there is no
wagering, deposit, or payout anywhere in the product, and that constraint is enforced in code
and in a build-time test. In production it is a **subscription business for club operators**,
not a gambling product.

The whole product is one responsive web application that will ship as a website **and** as
native iOS/Android apps from the same codebase (see `05-MOBILE.md`).

## 2. Who uses it — the three experiences

| Experience | Who | What they do |
|---|---|---|
| **Player app** | End players | Discover clubs, follow and join, register for and play tournaments, watch live tables (delayed), track stats, climb rankings, earn achievements, manage a personal calendar |
| **Club console** | Club owners & staff | Create and run tournaments, manage members and requests, run a full CRM (tags, 14 built-in segments, notes, inbox, announcements, automation, privacy/data-deletion controls), read analytics, brand their club, manage their subscription |
| **Platform administration** | The platform operator (you) | Manage tenants (clubs), plans, billing, platform health, and support |

Five club roles (Owner, Manager, Tournament manager, Support agent, Player) with 22 granular
permissions govern what each staff member can do. Platform administrators have **no** club-level
permissions — tenant isolation is a first-class rule.

## 3. What it does today (0.4.0), in one paragraph

A complete, well-tested **prototype**: a full Texas Hold'em engine with 10 game variants
(NLHE, Omaha, Short Deck, Hi/Lo, limit/pot-limit), a tournament engine (structures, seating,
balancing, late registration, pause/resume), a club console with a deep CRM and analytics, a
competition layer (global and club leaderboards, leagues, tiers, achievements), growth tooling
(referral links, QR codes, a personal calendar), a retention engine (inactivity alerts,
segments, scheduling recommendations), notifications, spectator/streamer modes with real
delayed buffers, and an integrity review workflow. It runs entirely in one browser tab on
simulated data. See `02-FEATURES.md` for the full inventory and honest status of each item.

## 4. The ClubHouse business model

The platform's revenue comes from **seven streams**. The detailed implementation of each — the
pricing, the data model, and which service owns it — is in `04-PROFIT-MODULE.md`. At a glance:

| # | Stream | Who pays | Model |
|---|---|---|---|
| 1 | **Subscriptions** (tiered) | Club owners | Recurring monthly, priced by number of clubs + tooling depth |
| 2 | **Sponsored promotions** | Club owners | Pay to boost a tournament to more players (Diamond-funded first) |
| 3 | **White-label** | Organizations | ₪2,500 / $1,000 per month — their own branded platform, all features on |
| 4 | **Feature upsells** | Club owners | À-la-carte unlocks of features not bundled in their tier |
| 5 | **Diamonds** | Owners **and** players | A top-up virtual currency for convenience features (see guardrails) |
| 6 | **Game dev & engine rental** | Other companies | B2B license of the reusable poker/tournament engine |
| 7 | **"Top Clubs" discovery** | — (growth, not direct revenue) | Visibility surface that pulls in more owners |

### Subscription tiers (headline pricing)

| Tier | Price | Unlocks |
|---|---|---|
| **Starter** | **$20 / month** | A single club |
| **Growth** | **$100 / month** | Up to **5** clubs in parallel |
| **Pro** | **$200 / month** | Up to **10** clubs **+ the full CRM system** |

> `קלאב עצמי` ("self-managed club") from the original brief is an open tier decision — treated
> as a TODO in `04-PROFIT-MODULE.md`.

### The money guardrails (stated once here, enforced everywhere)

- **No real-money gameplay.** Chips are virtual; nothing deposits, wagers, or pays out.
- **Player Diamonds are cosmetic / convenience only** (e.g. extra decision time, themes). A
  Diamond never affects chips, outcomes, or converts to cash.
- **Real money is gated** behind legal review (per market) and the app-store social-casino /
  age-gating review. Both are hard launch blockers.

## 5. Strategy — the one thing that matters now

> **The single most important factor right now is acquiring club owners — at the highest
> possible volume.**

Every packaging decision follows from this: the subscription floor is deliberately low
($20), the first club is cheap, and the growth/recognition features (sponsored promotions,
"Top Clubs", referrals) exist to pull **more** owners onto the platform rather than to squeeze
the ones already here. Revenue is a second-order goal during this phase — the plan avoids
adding friction (hard paywalls, aggressive upsell walls) that would slow owner sign-ups.

Positioning: a club owner can stand up a fully-branded, tournament-ready club in minutes
(the 5-minute creation wizard and CSV member migration already exist), compete for visibility
on public leaderboards, and grow their player base with built-in referral and retention tools
— for the price of a streaming subscription.

## 6. From prototype to product — the shape of the work

The prototype was deliberately built to grow into a client/server system **without a rewrite**.
The production build is a **7-phase migration** where every phase leaves a working system,
plus a profit-module phase. In brief:

1. Extract the API · 2. Persist to a database · 3. Move tables to a server-authoritative service ·
4. Real auth & tenancy · 5. Background workers & real notification channels · 6. Deploy on AWS ·
7. Ship web + native apps — with the **profit module** (owner subscriptions, entitlements, the
Diamonds ledger, then real billing once legal clears) slotted in alongside.

The full sequence, dependencies, effort, and verification are in `08-ROADMAP.md`. The
engineering detail starts in `03-ARCHITECTURE-AND-SERVICES.md`.

## 7. The gates that are not engineering

Two things sit on the critical path to any commercial launch and are **owned outside
engineering**:

- **Legal / counsel.** PII handling in the CRM, marketing-message consent, and per-market
  gambling-law review (even for virtual chips) must clear before real money is taken.
- **App-store policy.** A poker app — even virtual-chips-only — is reviewed as a
  "social casino" / gambling-category app by both app stores, implying age-gating, possible
  regional restrictions, and extra review scrutiny.

Both should be opened **early**, in parallel with the engineering phases, because they gate the
revenue switch, not the build.
