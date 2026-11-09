# 04 — Profit Module (ClubHouse monetization, mapped onto the services)

> **Audience: all.** How Poker Club OS makes money, and for each stream: where it lives in the
> service split (`03-ARCHITECTURE-AND-SERVICES.md`), what data it needs, and how to build it.
> This expands `mvp/docs/PROFIT_MODULE.md` with the production decisions from this plan.
>
> **Billing lives inside the API service** (decision #4, `00-INDEX.md`). There is no separate
> billing service: provider-hosted checkout keeps card data off our servers (PCI SAQ-A), so no
> isolation is warranted. Guardrails: signed webhooks, provider secrets in Secrets Manager,
> never store card numbers.

---

## 0. The honest starting point

The prototype has **no money anywhere**. Every balance is demo points; all prices render in a
placeholder currency (`money()` prints `¤` in `mvp/src/shared/plans.tsx`); the billing screens are
labelled DEMO. Turning any of this into revenue requires the server split, a payment provider,
and the legal + app-store gates. This document describes the target and the smallest honest
path to it.

## 1. Strategic frame

> **Acquire club owners at volume first.** Pricing is deliberately low at the floor; growth and
> recognition features exist to pull in more owners. Do not add friction that slows sign-ups.

## 2. The streams and which service owns them

| # | Stream | Owner service | New data | Build phase (see 08) |
|---|---|---|---|---|
| 1 | Subscriptions | API (billing module) | `owner_subscriptions`, `plans`, `invoices` | Profit phase, then real billing after legal |
| 2 | Sponsored promotions | API + Scheduler + Client | `promotions` | **Deferred** — needs a Diamond-spend mechanism (or a cash path) first |
| 3 | White-label | API (as a plan) + platform tenancy | plan flags, `organizations` | After AWS + billing |
| 4 | Feature upsells | API (entitlements) | `entitlements`, `catalog` | Entitlement resolution in profit phase; *buying* add-ons deferred (needs a spend path) |
| 5 | Diamonds | API (billing module) | `diamond_balances`, `diamond_ledger` | Profit phase: **balance + ledger only, no spend paths**; spend features and real-money top-ups later |
| 6 | Engine / B2B rental | commercial (engine as SDK) | license keys | Parallel commercial track |
| 7 | "Top Clubs" discovery | API + Client | `country` on `Club`, club ranking | Growth surface, any time after persist |

---

## 3. Subscriptions (primary revenue)

### Pricing

| Tier | Price | Unlocks |
|---|---|---|
| **Starter** | $20 / mo | 1 club |
| **Growth** | $100 / mo | up to **5** clubs |
| **Pro** | $200 / mo | up to **10** clubs **+ full CRM** |

> `קלאב עצמי` ("self-managed club") is an **open tier decision** — free self-service, a one-off
> license, or a reduced-support plan. Add it as a fourth `PlanId` once decided.

### What exists today

- **Types** (`mvp/src/platform/types.ts`): `PlanId = 'starter' | 'professional' | 'enterprise'`;
  `Plan { model, baseFee, perActiveFee, includedActive, limits, customBranding, reporting,
  support }`; `PlanLimits { members, monthlyActive, concurrentTables, tournamentsPerMonth,
  adminSeats }`; `Invoice { base, usage, activePlayers, total, status: 'paid'|'due'|'draft' }`.
  Each `Club` has `planId` and `limitOverrides`.
- **Logic** (`mvp/src/platform/api.ts`): `effectiveLimits` (plan + overrides), `clubUsage`,
  `invoicePreview`; limits enforced via `fail('club_full', …)` and the single feature gate
  `fail('plan_feature', …)` at `api.ts:614`.
- **UI**: `mvp/src/console/Subscription.tsx`, `mvp/src/platform-admin/Billing.tsx`,
  `mvp/src/shared/plans.tsx`.

### How to implement

The brief prices **per number of clubs**, but today `planId` lives on each `Club` and limits
count *within* one club. Two changes:

1. **Move the subscription to the owner/account level.** Add `owner_subscriptions` keyed by
   owner id, carrying `maxClubs` (1 / 5 / 10), `crmEnabled` (Pro only), and the price. Enforce
   `maxClubs` in the club-creation path (`migration.ts` club creation / `api.ts` create-club)
   with `fail('plan_clubs_full', …)`, mirroring the existing `fail('club_full', …)`. **This
   replaces the prototype's hard-coded 3-clubs-per-owner cap.**
   - **Existing per-club limits must not become undefined.** Today `PlanLimits` (members,
     monthlyActive, concurrentTables, tournamentsPerMonth, adminSeats) live on each `Club` via
     `planId` + `limitOverrides`. When the *subscription* moves up to the owner, decide and
     document how the owner tier maps onto per-club limits: either **(a)** the owner tier sets a
     default `PlanLimits` applied to each of the owner's clubs, or **(b)** per-club limits stay
     independent and only `maxClubs` + `crmEnabled` move to the owner level. Pick one so an owner
     changing plans has defined behaviour for member/table caps — not just club count.
2. **Rename tiers** to Starter / Growth / Pro and set real `baseFee` once a provider exists.
   Gate the CRM console routes behind `crmEnabled` via `permissions.ts`-style checks so non-Pro
   owners get the "no access" page.

### Real billing engine (API service)

`invoicePreview` already computes the amount and `Invoice.status` is already the state machine.
Wire it to a **provider-hosted checkout** (Stripe / Paddle / Lemon Squeezy; a local PSP if the
market needs ILS):

- Checkout/subscription creation → provider hosted page (no card data on our servers).
- Provider **webhook** (signature-verified, idempotent) flips `Invoice.status` and stamps
  `issuedAt`; store the provider's subscription id on `owner_subscriptions`.
- Secrets in Secrets Manager. Keep the `¤` placeholder and the DEMO note **until** the provider
  is live and legal has cleared.

---

## 4. Diamonds (virtual currency — balance + ledger only, for now)

### Concept

Diamonds are a **platform** currency (real money in → Diamonds), **distinct from demo chips**.
For now they carry **no spend responsibility at all**: the product ships only a **balance** and an
**append-only ledger**. There is deliberately nothing to spend them on yet — spend features come
later, once designed. This keeps the initial scope minimal and avoids baking in any gameplay
coupling.

### Guardrails (hard)

- **Diamonds do nothing yet.** No perks, no gameplay effect, no conversions. (This is a change
  from an earlier draft that proposed "extra decision time" as a player perk — removed, because
  buying think-time in a ranked/league game is a competitive advantage, i.e. pay-to-win, exactly
  the signal the stores use to classify an app as gambling.)
- **Whatever spend features are added later will be purely cosmetic** — themes, table designs,
  card backs, emotes. A Diamond will **never** buy a gameplay advantage (explicitly **no "extra
  decision time"** and no in-hand edge), **never** touch chip counts or hand outcomes, and
  **never** convert to chips, winnings, or cash. Anything that could move a ranked or league
  result is excluded by design — this is what keeps the app clear of pay-to-win / social-casino
  classification.
- **Naming:** the feature is the **"diamond balance / ledger", never a "wallet"** — both to stay
  clear of the gameplay money guard (`03` §8) and to avoid a gambling-flavoured term in store
  review.
- **Real-money top-ups ship only behind the legal + app-store gates** (`00-INDEX.md`). Until then,
  Diamonds exist as a demo/earned balance so the data model can be built and tested.
- **When top-ups are added, in-app purchases on mobile must use Apple StoreKit / Google Play
  Billing** — Apple and Google require their own in-app purchase for digital goods consumed in the
  app, so these **cannot** go through Stripe. Stripe / Paddle / Lemon Squeezy remain for the B2B
  subscription (§3); a web top-up may use the subscription provider.

### How to implement (API service)

- **Data**: `diamond_balances { ownerId|userId, diamonds }` and an append-only `diamond_ledger`
  (credits/debits) following the audit/event-log pattern. Lives in `mvp/src/platform/billing/`.
- **Service**: a small guarded module (same `fn(db, actor, …)` shape) exposing read-balance and a
  credit entry point. **No debit/spend API until a spend feature is designed** — there is nothing
  to debit against yet.
- **Order**: ship the balance + ledger (demo) now; add spend paths and real-money top-ups later,
  each behind its own gate (legal, app-store, IAP).

---

## 5. Sponsored promotions

Club owners pay to **boost a tournament** to players across discovery, the player home feed,
and the "Top Clubs" surfaces — a direct acquisition tool for owners.

> **Status: deferred.** This stream is paid in Diamonds, which currently have **no spend path**
> (§4). Build it only after a Diamond-spend mechanism (or a direct cash path) exists; the design
> below is the target, not near-term work.

- **Service**: a new `mvp/src/platform/promotions.ts` beside `automation.ts` (same guarded shape);
  add a `promotions.manage` permission (owner & manager).
- **Data**: `promotions { id, clubId, tournamentId, budget, startsAt, endsAt, status,
  impressions, clicks }`.
- **Delivery**: discovery / player-home read an `activePromotions(db, { playerId })` selector
  that interleaves promoted tournaments with organic ones, **always labelled "Sponsored"**.
- **Pacing & accounting**: the **Scheduler worker** (the former `Runtime.tick`) burns budget
  and paces impressions, exactly like the announcement/automation jobs it already runs. Record
  impressions/clicks with the delivery-record pattern (eligible vs actual).
- **Payment**: **deferred** — promotions need a Diamond-spend mechanism (§4) or a direct cash
  path, neither of which exists yet. When spend lands, charge against **Diamonds** first (no
  second payment integration); add a cash/CPM path later.
- **Respect responsible play**: a self-set break (`channels.ts`) suppresses promotions to that
  player.

Start with the simplest model — a **flat fee for a fixed featured window** (no auction, no CPM)
— which the existing lifecycle/scheduler patterns already cover.

---

## 6. Feature upsells (à-la-carte entitlements)

Individual features not bundled in a tier can be purchased separately, so a Starter owner can
unlock one capability without jumping to Pro.

The entitlement pattern is already proven by the **single** gate in the code — the template for
all of them:

```ts
// mvp/src/platform/api.ts:614
if (usesImage && !db.plans[club.planId].customBranding) {
  fail('plan_feature', 'Uploading your own logo and cover is part of the Professional plan and above.');
}
```

How to implement (API service):

1. **Generalise** into `entitlementsOf(db, club)` (next to `effectiveLimits`), resolving *plan
   defaults + per-owner add-on purchases*. Replace the `customBranding` check with
   `requireEntitlement(db, club, 'branding.upload')`.
2. **Catalogue** of buyable features in `seed.ts` / a `catalog` table (id, title, price or
   Diamond cost, one-off vs recurring).
3. **Purchase**: **deferred until a spend mechanism exists.** The *entitlement resolution*
   (steps 1–2) can be built now and driven by plan defaults + manually-granted add-ons; the
   *buying* of an add-on waits for either a Diamond-spend path (§4) or a cash path via the
   subscription provider. Record and `audit` every grant/purchase.
4. **UI**: an "Add-ons" panel in `Subscription.tsx` reusing the plan-comparison cards; locked
   features show an inline "unlock" affordance, **not** a hard wall (strategic priority).

---

## 7. White-label

Organizations ship their **own** branded platform for **₪2,500 / $1,000 per month, all features
included**.

- **Model it as a plan**, not a one-off: a fourth tier `whitelabel` (or an `isWhiteLabel` flag
  on `owner_subscriptions`) with **all `PlanLimits` uncapped** and **every entitlement flag
  true**. Because gating already routes through `effectiveLimits` / entitlements, "include
  everything" is just "all flags on, limits = ∞".
- **Tenancy (server)**: full white-label (custom domain, the org's logo on the login/shell,
  their name instead of "Poker Club OS") needs an `organizations` row above `club_id` carrying
  brand assets + domain, resolved at request time. Maps onto the existing `club_id`-as-tenant
  model (`03` §4).
- **Missing today**: the platform-level branding editor (`mvp/src/platform-admin/`) — build it to
  set an org's theme catalogue, accent, and logo; the `THEMES` plumbing already consumes them.

Depends on the server and billing being live (`08-ROADMAP.md`).

---

## 8. Game development & engine rental (B2B)

License/rent the engine to other companies. The engine is already a clean, reusable, UI-free
asset (`mvp/src/engine`, 13 files, zero DOM coupling, event-sourced, multi-variant). This is a
**commercial/packaging** effort, not a prototype feature:

1. Decide the product: **(a)** an embeddable engine SDK (an npm package of `mvp/src/engine` with a
   stable public API + license-key check), or **(b)** a hosted white-label (which is §7 at org
   scale).
2. For (a): the engine's command/sequence/`actionId` contract is already the integration
   surface.
3. Billing is a **contract** (per-seat / per-tournament / flat license), handled outside the
   in-app billing engine initially.

No prototype code is required to start selling this; it is a go-to-market decision backed by
the existing engine.

---

## 9. "Top Clubs" discovery (growth surface)

A ranked showcase of the strongest clubs — by rating, players, or tournaments — with a
**country filter** and drill-down into each club's tournaments. Primarily an owner acquisition
surface; also the natural home for §5 sponsored placements.

What exists: the scoring machinery in `mvp/src/platform/competition.ts` — `globalLeaderboard` and
`clubLeaderboard` share one weighted-score definition, with fairness exclusions (bots,
demo-seeded, cancelled/invalidated).

What's missing:
- **No club-level score** — today's leaderboards rank *players*, optionally scoped to a club.
- **Clubs have no `country` field** (`types.ts` has none) — the country filter needs it.

How to implement:
1. Add `country` to `Club` (`types.ts`, seed, `mvp/src/console/Branding.tsx` / the club wizard).
2. New selector `clubRankings(db, { by: 'rating'|'players'|'tournaments', country? })` in
   `competition.ts`, reusing the scoring + fairness rules. Pick one definition of club "rating"
   (aggregate member scores or tournament volume) and test it against hand-calculated values.
3. New player screen `mvp/src/player/TopClubs.tsx`: ranked list, three modes, country filter,
   drill-down to each club's tournaments; sponsored entries clearly marked. Make
   joining/opening a club one click from here (strategic priority).

---

## 10. Build order & gates

The profit module slots into the roadmap (`08-ROADMAP.md`) in this internal order, so each
stream reuses the previous one's infrastructure:

1. **Owner subscriptions + `maxClubs`** — the core; everything hangs off it.
2. **Diamonds balance & ledger** (demo) — the data model only; **no spend paths yet** (spend
   features are deferred, §4).
3. **Generalised entitlements** — turn the one gate into a reusable system (resolution now;
   *buying* add-ons later, when a spend path exists).
4. **Top Clubs** — low-risk additive growth surface.
5. **Sponsored promotions** — **deferred** until a Diamond-spend or cash path exists (§5).
6. **Real billing engine** (provider + webhooks) — flips subscriptions (and later Diamond
   top-ups) from demo to revenue. **Gated by legal + app-store review.** Mobile top-ups use IAP
   (§4).
7. **White-label tenancy + platform branding editor** — needs the server and billing.
8. **Engine SDK / B2B licensing** — parallel commercial track.

### Hard constraints (never violate)

- No real-money gameplay; Diamonds and chips never convert to cash or winnings.
- No fake "delivered" / "paid" claims; keep demo labels until a real provider is wired.
- Legal gate before charging; app-store social-casino / age-gating gate before mobile launch.
- Enforce every limit, entitlement, and spend in the **service layer** (`fail(...)` /
  `requirePermission(...)`); the UI only reflects it.
