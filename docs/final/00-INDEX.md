# Poker Club OS — Final Plan (Index)

> This folder is the **single consolidated plan** for Poker Club OS: what the product is,
> everything it does, how it becomes a production system split into services, how it ships
> to mobile, how it runs on AWS, and how it deploys. It synthesizes the ~11 documents under
> `docs/` plus the current codebase into one forward-looking blueprint.
>
> It is written for **two readers at once**, clearly sectioned:
> - **Business / product** readers — start with `01-PRODUCT-OVERVIEW.md`, then skim
>   `02-FEATURES.md`, `04-PROFIT-MODULE.md`, and `08-ROADMAP.md`.
> - **Engineering** readers — read `03-ARCHITECTURE-AND-SERVICES.md` through
>   `07-CICD-PIPELINE.md` in order; `08-ROADMAP.md` ties them to a delivery sequence.

---

## The documents

| # | Document | For | What it answers |
|---|---|---|---|
| 00 | **00-INDEX.md** (this file) | All | How to read this, the key decisions, the shared glossary |
| 01 | [01-PRODUCT-OVERVIEW.md](01-PRODUCT-OVERVIEW.md) | Business | What the app is, who uses it, the ClubHouse business model, strategy |
| 02 | [02-FEATURES.md](02-FEATURES.md) | All | The complete feature inventory with honest status (built / demo / partial / missing) |
| 03 | [03-ARCHITECTURE-AND-SERVICES.md](03-ARCHITECTURE-AND-SERVICES.md) | Engineering | The production service split and why today's code already supports it |
| 04 | [04-PROFIT-MODULE.md](04-PROFIT-MODULE.md) | All | Every revenue stream, mapped onto the services and the data model |
| 05 | [05-MOBILE.md](05-MOBILE.md) | Engineering | Web + native iOS/Android from one bundle (Capacitor), and the store gate |
| 06 | [06-AWS-ARCHITECTURE.md](06-AWS-ARCHITECTURE.md) | Engineering | The AWS target architecture, every service and why |
| 07 | [07-CICD-PIPELINE.md](07-CICD-PIPELINE.md) | Engineering | The build/test/deploy pipeline (greenfield — none exists today) |
| 08 | [08-ROADMAP.md](08-ROADMAP.md) | All | The phased delivery sequence, dependencies, effort, and per-phase verification |

The existing `docs/` files remain the **source of record**; this set references them and
should not contradict them. Where two older docs disagreed, this set resolves it (see
"Facts this plan fixes" below).

---

## The four decisions this plan commits to

These were decided for this consolidation and are applied uniformly across all documents.

1. **Structure.** A folder of numbered docs with this index — not one monolithic file.
2. **Audience.** Both business and engineering, clearly sectioned per document.
3. **Monetization scope.** The **full ClubHouse model**, including **Diamonds purchasable by
   players** — under the guardrails below.
4. **Billing placement.** The profit/billing module lives **inside the API service**, not as a
   separate service. Rationale: a provider-hosted checkout (Stripe / Paddle / Lemon Squeezy)
   keeps raw card data off our servers (PCI **SAQ-A**), so there is no material security risk
   that would justify a dedicated service. The only guardrails — signed webhooks, provider
   secrets in Secrets Manager, never storing card numbers — are things the API service already
   does for its other secrets.

### Monetization guardrails (non-negotiable, consistent with the repo's hard constraints)

- **No real-money gameplay, ever.** Chips are virtual and have no monetary value; nothing
  deposits, withdraws, wagers, or pays out. The build-time test that fails on money code paths
  stays in place.
- **Player Diamonds are cosmetic / convenience only** — extra decision time, themes, and the
  like. A Diamond **never** touches chip counts, hand outcomes, or converts to cash/winnings.
- **Real money is gated.** Live subscription charges and real-money Diamond top-ups ship **only
  after** (a) per-market legal review (gambling + consumer-payment + PII/consent) and (b) the
  app-store social-casino / age-gating review. Both are **hard launch blockers owned by
  counsel and the store process**, not engineering tasks.

---

## Version lineage (how we got here)

| Version | Theme | Delivery docs | Unit tests | E2E checks |
|---|---|---|---|---|
| 0.1.0 | Baseline prototype (engine, clubs, tournaments) | `CRM_AUDIT.md` (baseline audit) | — | — |
| 0.2.0 | CRM, community, analytics | `COMPLETION_REPORT.md` | 146 | 135 |
| 0.3.0 | "Modern Poker Arena" redesign, table branding | `DESIGN_V3.md`, `REDESIGN_REPORT_V3.md` | 153 | 137 |
| 0.4.0 | Feature expansion (variants, competition, growth, retention, integrity) | `V04_REPORT.md`, `V04_FEATURE_AUDIT.md` | **220** | **165** |

Everything in this plan builds **forward** from 0.4.0 toward a deployed production system; it
does not propose rewriting what exists.

---

## Shared glossary (used throughout)

**The three experiences.** One browser app with three role-separated surfaces: the **Player
app** (`src/player`), the **Club console** (`src/console`), and the **Platform
administration** (`src/platform-admin`).

**The two engines.** `src/engine` (poker + tournament logic, pure TypeScript, no UI/browser
APIs) and the `src/platform` service layer (the "mock backend").

**The four relationship records.** A person and a club relate in four *independent* ways; none
implies another:

| Relationship | Record | States |
|---|---|---|
| Registered user | `users` | exists / not (grants nothing) |
| Follower | `follows` | following / not (never grants access) |
| Member | `memberships` | none · pending · active · rejected · suspended · banned |
| Tournament participant | `registrations[]` | none · requested · approved · registered · waitlisted · rejected · cancelled |

**Lifecycle** (new follower → interested → approved → first-time → returning → inactive) is
*derived*, never stored.

**Permissions.** Five club roles (Owner, Manager, Tournament manager, Support agent, Player)
and 22 permissions, plus platform administrators who hold no club permissions. Enforced in the
service layer via `requirePermission` / `requirePlatform`; the UI only reflects it.

**Service contract.** Every service function has the shape `fn(db, actorId, …args)` —
`requirePermission` → validate → mutate/compute → `audit`/`logEvent`/`notify`. This uniform
shape is what makes the production service split a mechanical extraction rather than a rewrite.

**Design direction.** "Graphite & ember" (`--color-bg #0c0f13`, brand/ember `#ff8a3d`, prestige
gold `#e3c27a`). The app ships two interchangeable looks (v2 / v3) selected at build time.

---

## Facts this plan fixes (discrepancies in the older docs)

- **Palette.** `REDESIGN_REPORT_V3.md §3` still cites a superseded teal palette
  (`#18a999` / `#0b1015`). The authoritative direction is **graphite & ember** (`#0c0f13` /
  `#ff8a3d` / `#e3c27a`), per `DESIGN_V3.md` and that report's own §0 Revision 2.
- **Clubs-per-owner.** The 0.4 prototype hard-codes **3 clubs per owner** at self-service club
  creation. The ClubHouse subscription model replaces this with a **plan-driven `maxClubs`**
  (1 / 5 / 10). See `04-PROFIT-MODULE.md`.
- **"Billing / health" screens are DEMO.** They render placeholder data in an unnamed currency
  (`¤`). No money moves anywhere in the prototype. See `02-FEATURES.md`.

---

## Status vocabulary (used in `02-FEATURES.md`)

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | In the build and exercised by an automated test and/or e2e check |
| **DEMO** | Works end-to-end on simulated data by design, and is labelled as such in the UI |
| **PARTIAL** | Part of the capability exists; the missing part is named |
| **MISSING** | Not in the build |
