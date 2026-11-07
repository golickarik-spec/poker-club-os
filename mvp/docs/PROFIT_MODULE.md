# Poker Club OS — Profit Module ("ClubHouse" business model)

> How the platform makes money, and — for each revenue stream — **where** it plugs
> into the code that exists today and **how** to build it.
>
> **Important honesty note:** the prototype has *no money anywhere*. Every balance is
> demo points, and all prices rendered in the UI are placeholders in an unnamed
> currency (`money()` in `src/shared/plans.tsx` prints `¤`). The billing screens are
> labelled DEMO by design. Turning any of this into real revenue requires a payment
> provider, the server split described in `docs/PRODUCTION_ARCHITECTURE.md`, and the
> legal gate in `docs/ARCHITECTURE.md` §6.9. This document describes the target model
> and the smallest honest path to it.

---

## 0. Strategic priority

**The single most important factor right now is acquiring club owners — at the
highest possible volume.** Every pricing and packaging decision below should be read
through that lens: the subscription floor is deliberately low, the first club is cheap,
and the growth/recognition features (sponsored promotions, "Top Clubs") exist to pull
*more* club owners onto the platform, not to squeeze the ones already here.

Revenue is a second-order goal. Do not add friction (hard paywalls, aggressive upsell
modals) that would slow owner sign-ups during this phase.

---

## 1. The revenue streams at a glance

| # | Stream | Who pays | Model | Built today? |
|---|---|---|---|---|
| 1 | **Subscriptions** (tiered) | Club owners | Recurring monthly | Scaffold exists (DEMO) |
| 2 | **Sponsored promotions** | Club owners | Pay-per-campaign / CPM | Not built |
| 3 | **White-label** | Organizations | ₪2,500 / $1,000 per month | Branding exists; licensing/billing not built |
| 4 | **Feature upsells** (à-la-carte) | Club owners | One-off or recurring add-on | Entitlement gate exists (1 feature) |
| 5 | **Diamonds** (virtual currency) | Club owners **and** players | Consumable top-up | Not built (demo points only) |
| 6 | **Game development & rental** | Other companies | B2B contract / engine license | Engine is reusable; no licensing layer |
| 7 | **"Top Clubs" discovery** | — (growth, not direct revenue) | — | Leaderboards exist; club ranking + country filter not built |

The rest of this document takes each in turn.

---

## 2. Subscription model (primary revenue)

### Concept & pricing

Tiered monthly rental of the software, priced per the number of clubs an owner runs and
the depth of tooling they get:

| Tier | Price | What it unlocks |
|---|---|---|
| **Starter club** | **$20 / month** | A single club. |
| **Growth** | **$100 / month** | Open and run **up to 5 clubs** in parallel. |
| **Pro** | **$200 / month** | Open and manage **up to 10 clubs**, **plus the full CRM system**. |

> `קלאב עצמי` ("self-hosted / self-managed club") is named in the brief but not yet
> specified. Treat it as a **TODO**: decide whether it is a free self-service tier, a
> one-off license, or a reduced-support plan, then add it as a fourth `PlanId`.

### Where it lives today

The subscription scaffold already exists and is the natural home for this:

- **Types** — `src/platform/types.ts`
  - `PlanId = 'starter' | 'professional' | 'enterprise'`
  - `interface Plan { model, baseFee, perActiveFee, includedActive, limits, customBranding, reporting, support }`
  - `interface PlanLimits { members, monthlyActive, concurrentTables, tournamentsPerMonth, adminSeats }`
  - `interface Invoice { ... base, usage, activePlayers, total, status }`
  - Each `Club` carries `planId` and `limitOverrides: Partial<PlanLimits>`.
- **Plan logic** — `src/platform/api.ts`
  - `effectiveLimits(db, club)` = the plan's limits **plus** per-club overrides.
  - `clubUsage(db, clubId)` = current members / monthly-active / tables / tournaments / admin seats.
  - `invoicePreview(db, clubId)` = base + usage → total for the current period.
  - Limits are **enforced** at the service layer: see `fail('club_full', …)` when adding
    members and `fail('plan_feature', …)` for feature gating (today only custom branding,
    `api.ts:614`).
- **Seed data** — `src/platform/seed.ts` (the three demo plans).
- **UI (club side)** — `src/console/Subscription.tsx`: current plan, usage meters, invoice
  preview, plan comparison, and "request change" (which opens a support ticket — no
  self-serve checkout yet).
- **UI (platform side)** — `src/platform-admin/Plans.tsx` (edit plans) and
  `src/platform-admin/Billing.tsx` (all clubs' invoices, demo).
- **Shared components** — `src/shared/plans.tsx` (`UsageMeters`, `InvoicePreview`,
  `planPriceText`, `money`, `LIMIT_KEYS`).

### How to implement

The model in the brief is **per-*number-of-clubs*** — which the current schema does
**not** express, because `planId` lives on *each* `Club` and limits count members/tables
*within* one club. Two changes are needed:

1. **Move the subscription up to the owner/account level.** A plan should belong to the
   **owner (user/organization)**, not to a single club. Add an `ownerSubscription`
   concept keyed by owner id, with:
   - `maxClubs` (1 / 5 / 10 for the three tiers),
   - `crmEnabled` (false for Starter & Growth, true for Pro),
   - the existing per-club `PlanLimits` kept for intra-club caps.
   Enforce `maxClubs` in the club-creation path (the 5-minute wizard /
   `platform/migration.ts` club creation and `api.ts` create-club): `fail('plan_clubs_full', …)`
   when the owner is at their cap, exactly mirroring the existing `fail('club_full', …)`.
2. **Rename / re-point the three tiers** to Starter / Growth / Pro and set real prices
   (`baseFee`) once a currency and payment provider exist. Gate the CRM console
   (`src/console/crm/*`) behind `crmEnabled` with `requirePermission`-style checks in
   `permissions.ts` so the CRM routes render the "no access" page for non-Pro owners.

**Billing engine (real money):** today `invoicePreview` computes totals but nothing
charges. On the server (see `PRODUCTION_ARCHITECTURE.md`), wire the existing `Invoice`
shape to a provider (Stripe / Paddle / Lemon Squeezy for SaaS; a local PSP if the market
requires ILS). The `Invoice.status` field (`paid | due | draft`) is already the state
machine you need. Keep `invoicePreview` as the source of truth for the amount; the
provider webhook flips `status` and stamps `issuedAt`.

**Keep the demo honest until then:** leave the `billing.placeholder_note` warning and the
`¤` currency in place so nobody mistakes the prototype for a live biller.

---

## 3. Sponsored promotions

### Concept

Club owners pay to **promote their tournaments** to end players across the platform —
boosting a tournament in discovery, the player home feed, and the "Top Clubs" surfaces so
it reaches players beyond the club's own followers. This is a direct acquisition tool for
owners and a high-margin revenue line for the platform.

### Where it would live

- **New service module** — `src/platform/promotions.ts` (sits beside `automation.ts` /
  `channels.ts`, follows the same shape: `requirePermission` → validate → mutate →
  `audit`/`logEvent`). Owner-only permission, add e.g. `promotions.manage` to
  `permissions.ts` (owner & manager).
- **Data** — a `promotions` table in `DB` (`types.ts`): `{ id, clubId, tournamentId,
  budget, startsAt, endsAt, status, impressions, clicks }`.
- **Delivery** — the discovery / player-home surfaces (`src/player/*`) read an
  `activePromotions(db, { playerId })` selector that interleaves promoted tournaments with
  organic ones, clearly **labelled "Sponsored"** (a hard requirement — never disguise paid
  placement).
- **Pacing & accounting** — the `Runtime` tick (`src/platform/runtime.ts`, 250 ms /
  once-a-second workers) is where impression pacing and budget burn-down belong, exactly
  like the scheduled-announcement and automation jobs already running there.

### How to implement

1. Start with the simplest model: **flat fee per promoted tournament** for a fixed window
   (e.g. "featured for 7 days"). This needs no ad auction and no CPM accounting — just a
   `status` and a date window, which the existing lifecycle/scheduler patterns already cover.
2. Record `impressions` / `clicks` for an honest stats panel (reuse the delivery-record
   pattern from `core.deliver`: who was eligible vs. what actually happened).
3. Charge against **Diamonds** (§6) for the first version so you don't need a second
   payment integration — the owner spends diamonds to light up a promotion. Later, add a
   cash/CPM path once the billing engine exists.
4. Respect player consent and responsible-play rules already in the product: a self-set
   break (`channels.ts` responsible-play case) must suppress promotions to that player.

---

## 4. White-label

### Concept & pricing

Organizations that want to ship **their own** branded version of the platform pay
**₪2,500 / $1,000 per month**, which **includes every feature** (no tier caps, no upsells).

### Where it lives today

The *branding* half already exists:

- Per-tournament table branding → club inheritance (`src/platform/table-branding.ts`,
  tested, v0.3).
- Club → platform theme defaults (`THEMES` in `platform/table-branding.ts`).
- A club's accent colour is a CSS variable set on the club's scope, so branding reaches
  every screen (`src/ui`).
- Feature-gating precedent: `plan.customBranding` blocks logo/cover upload for low tiers
  (`api.ts:614`).

What is **missing** (per `V04_FEATURE_AUDIT.md` §10): a **platform-level branding editor**
and any **licensing / white-label tenancy** concept.

### How to implement

1. **Model it as a plan, not a one-off.** Add a fourth plan tier `whitelabel` (or an
   `isWhiteLabel` flag on `ownerSubscription`) priced at the fixed monthly fee, with
   **all `PlanLimits` effectively uncapped** and **every feature-gate boolean true**
   (`customBranding`, `crmEnabled`, and any upsell flags from §5). Because feature gating
   already routes through `effectiveLimits` and `fail('plan_feature', …)`, "include
   everything" is just "all flags on, limits = ∞".
2. **White-label tenancy on the server.** Full white-label (custom domain, the
   organization's logo on the login/shell, their name instead of "Poker Club OS") needs the
   server split: a tenant row that carries brand assets and a domain, resolved at request
   time. Map this onto the `clubId`-as-tenant-key model already described in
   `ARCHITECTURE.md` §3.6 — add an `organizationId` above `clubId`.
3. **Platform branding editor** — build the missing admin screen under
   `src/platform-admin/` to set an organization's theme catalogue, accent, and logo, which
   then become that tenant's defaults (the `THEMES` plumbing already exists to consume them).

---

## 5. Feature upsells (à-la-carte)

### Concept

Individual features that are **not** bundled into every subscription can be purchased
separately — so a Starter owner can buy one advanced capability without jumping to Pro.

### Where it lives today

The entitlement pattern is already proven — there is exactly **one** feature gate in the
code and it is the template for all of them:

```ts
// src/platform/api.ts:614
if (usesImage && !db.plans[club.planId].customBranding) {
  fail('plan_feature', 'Uploading your own logo and cover is part of the Professional plan and above.');
}
```

`Plan.reporting` (`basic | advanced | full`) and `Plan.support`
(`standard | priority | dedicated`) are further examples of capability levels already on
the plan.

### How to implement

1. **Generalise the gate into an entitlement set.** Add `entitlements: Set<string>` (or a
   `Record<string, boolean>`) resolved from *plan defaults + per-owner add-on purchases*,
   living next to `effectiveLimits` in `api.ts` — e.g. `entitlementsOf(db, club)`. Replace
   the single `customBranding` check with `requireEntitlement(db, club, 'branding.upload')`.
2. **A catalogue of buyable features** in `seed.ts` / a new `catalog` table: id, title,
   price (or diamond cost), recurring-vs-one-off.
3. **Purchase flow:** cheapest first version is to **spend Diamonds** (§6) to toggle an
   entitlement on; a cash path comes with the billing engine. Record the purchase and
   `audit` it.
4. **UI:** an "Add-ons" panel in `src/console/Subscription.tsx` reusing the plan-comparison
   card layout; each locked feature across the console shows an inline "unlock" affordance
   rather than a hard wall (remember the strategic priority — don't frustrate owners).

---

## 6. Diamonds (virtual currency)

### Concept

A top-up consumable currency that sits **alongside** the monthly subscription:

- **Club owners** buy diamonds to redeem special in-app features (power the first versions
  of §3 sponsored promotions and §5 upsells).
- **Players** buy diamonds for player-side perks — e.g. **extra decision time** at the
  table, cosmetic items, etc.

Diamonds are a *platform* currency (real money in → diamonds), **distinct from demo chips**.
This separation must stay crisp: diamonds buy *software features and convenience*, never
anything that looks like gambling value. **No diamond ever converts to chips, winnings, or
cash-out** — keep the product free of player-money features (see the cross-cutting rule in
`V04_FEATURE_AUDIT.md` §12 and `ARCHITECTURE.md` §6.9).

### Where it would live

- **Data** — a `wallets` concept in `DB`: `{ ownerId|userId, diamonds }`, plus a
  `diamondLedger` append-only table (purchases, spends) following the audit/event-log
  pattern already used for notifications and audit entries.
- **Service** — `src/platform/wallet.ts` (new), same guarded-function shape. Spends go
  through it so every redemption is permission-checked and logged.
- **Player perk hook** — the table turn timer lives in `TableDriver`
  (`runtime.ts`) / the engine's timeout handling (`engine`, "timeouts: check if free,
  otherwise fold"). "Extra decision time" = a wallet-funded extension applied there. Note
  the engine is pure and server-authoritative by design, so the *grant* must be validated
  server-side (a client must not be able to award itself time).
- **UI** — a diamond balance in the shells (`src/app/shells*.tsx`) and a top-up screen.

### How to implement

1. Ship the **ledger and balance first** (no purchase), seeded with demo diamonds, so the
   spend paths (promotions, upsells, extra time) can be built and tested against a balance
   without any payment integration — mirrors how the whole product runs on demo data today.
2. Add the **purchase** step last, through the same provider as subscriptions.
3. Enforce every spend in the service layer (`fail('insufficient_diamonds', …)`), never in
   the UI.
4. **Guard against pay-to-win perception:** keep player perks strictly *convenience /
   cosmetic* (time, themes), never anything affecting hand outcomes or chip counts, and
   label them clearly. Document the list and get it reviewed against the responsible-play
   and no-money rules before launch.

---

## 7. Game development & rental (B2B)

### Concept

License or rent the **poker/tournament engine and platform** to other companies.

### Why this is viable here

The engine is already a clean, reusable, UI-free asset — the strongest foundation for a
B2B license:

- `src/engine` imports nothing from the UI or browser APIs (`ARCHITECTURE.md` §1).
- Cards are integers, tables/hands are plain JSON → portable and embeddable.
- Event-sourced with per-viewer redaction → the right shape for a server/SDK others embed.
- Multi-variant (NLHE / PLO / Short Deck / Hi-Lo, `engine/variants.ts`) and a full
  tournament engine with structures, seating, balancing (`engine/tournament.ts`).

### How to approach it

This is a **commercial / packaging** effort more than a code feature:

1. Decide the product: **(a)** an embeddable engine SDK (npm package of `src/engine`), or
   **(b)** a hosted multi-tenant white-label (which is §4 at organization scale).
2. For (a): extract `src/engine` into a versioned package with a stable public API and a
   license key check; the engine's command/sequence/`actionId` contract is already the
   integration surface.
3. For (b): reuse the white-label tenancy from §4.
4. Billing is a **contract** (per-seat, per-tournament, or flat license), handled outside
   the in-app billing engine initially — invoices by hand, then formalised.

No prototype code is required to start selling this; it is a go-to-market decision backed
by the existing engine.

---

## 8. "Top Clubs" discovery (growth surface)

### Concept

A ranked showcase of the **strongest clubs** on the platform — by rating, by number of
players, by number/size of tournaments — with the ability to browse all of a club's
tournaments and **filter by country**. This is primarily a **club-owner acquisition and
retention** surface (visibility is the reward), not a direct revenue line — but it is the
natural place to surface §3 sponsored placements.

### Where it lives today

The scoring machinery already exists:

- `src/platform/competition.ts`: `globalLeaderboard(...)` and `clubLeaderboard(...)` share
  one weighted-score definition; fairness rules exclude bots, demo-seeded, cancelled and
  invalidated results.
- Club leaderboards (all-time / monthly / season), #1, top-3, previous champions are built
  and tested (`V04_FEATURE_AUDIT.md` §4).

What's **missing** for *clubs-as-entities* ranking:

- There is **no club-level score** (today's leaderboards rank *players*, optionally scoped
  to a club via `clubIds`). A `clubRankings(db, { by })` selector needs adding.
- **Clubs have no `country` field** (checked: `types.ts` has none) — the country filter
  requires adding `country` to the `Club` profile and to the club wizard/profile editor.

### How to implement

1. **Add `country` to `Club`** (`types.ts`, seed, club profile UI in `src/console/Branding.tsx`
   / the club wizard).
2. **New selector** `clubRankings(db, { by: 'rating' | 'players' | 'tournaments', country? })`
   in `competition.ts`, reusing the existing scoring and the "exclude demo/bots" fairness
   rules. Derive club "rating" from its members' leaderboard scores or its tournament
   volume — pick one definition and test it against hand-calculated values like the existing
   analytics tests do.
3. **New player-facing screen** under `src/player/` (e.g. `TopClubs.tsx`): ranked list,
   the three ranking modes, a country filter, and a drill-down into each club's tournaments
   (the public club page + tournament list already exist). Mark sponsored entries clearly.
4. This screen is the shop window for §0's priority — make joining/opening a club one click
   from here.

---

## 9. Build order (recommended)

Sequenced to serve the strategic priority (owners first) and to reuse each stream's
infrastructure in the next:

1. **Owner-level subscription + `maxClubs`** (§2) — the core model; everything else hangs off it.
2. **Diamonds ledger & balance** (§6, demo first) — the currency that powers §3 and §5 cheaply.
3. **Generalised entitlements** (§5) — turn the one existing gate into a reusable system.
4. **Top Clubs discovery** (§8) — low-risk growth surface, pure additive feature.
5. **Sponsored promotions** (§3) — monetises §8, paid in diamonds.
6. **Real billing engine** (server + payment provider) — flips §2/§5/§6 from demo to revenue.
7. **White-label tenancy + platform branding editor** (§4) — needs the server and billing.
8. **Engine SDK / B2B licensing** (§7) — commercial track, parallel to all of the above.

## 10. Hard constraints (do not violate)

- **No real-money gameplay.** Diamonds and demo chips never convert to cash or winnings.
  Keep the §12 cross-cutting rule in `V04_FEATURE_AUDIT.md` intact.
- **No fake "delivered" / "paid" claims.** Keep demo labels until a real provider is wired.
- **Legal gate before charging.** PII, marketing consent, and gambling-law review are a
  hard launch gate (`BILLING_ESTIMATE.md` §5, `ARCHITECTURE.md` §6.9).
- **Enforce on the server, label in the UI.** Every limit, entitlement, and spend is checked
  in the service layer via `fail(...)` / `requirePermission(...)`; the UI only reflects it.
