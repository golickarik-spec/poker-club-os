# 09 — Response to the Plan Review

> **Audience: engineering.** A point-by-point response to the external review of this plan
> (`docs/Poker-Club-OS-plan-review.pdf`, checked against the code at `mvp/` in November 2026).
> The review verified our code facts as correct and raised **5 "fix before building" points**,
> a set of **missing technical topics**, and some **business opinions**. Per scope, this response
> addresses the **technical** points only; business/pricing calls are flagged and left to the
> owner.
>
> Every technical point was found **relevant** and is now reflected in the plan. This doc records
> *what changed and where*; the authoritative text lives in the referenced docs.

---

## A. The 5 "fix before building" points — all relevant, all addressed

### A1 — The money-guard test would fail the moment the profit module is coded
**Verdict: Relevant (confirmed in code).** `mvp/tests/crm.test.ts:1644` scans **all of `src/`** for
`/\b(deposit|withdraw(al)?|cash[- ]?out|payout|wallet|iban|credit card|stripe|paypal)\b/i`. The
profit module as first written added `wallet.ts`, `wallets`, and Stripe webhooks — each trips the
guard — while the plan simultaneously promised the guard "stays intact." Real contradiction.

**Fix:** The guard is **rescoped to gameplay code** (engine / table / chip paths) and the billing
module moves to its own `mvp/src/platform/billing/` directory, excluded from the gameplay scan.
Two added rules keep them apart: (a) gameplay code may never `import` billing; (b) the Diamonds
feature is named **"diamond balance / ledger", never "wallet."** Billing's own guard forbids
storing card numbers (provider-hosted checkout, PCI SAQ-A).
→ `03` §8, `04` §4, `02` §13, `00-INDEX` guardrails.

### A2 — "In-memory DB" vs "stateless, horizontally scalable" contradiction
**Verdict: Relevant.** An in-process mutable `DB` graph cannot coexist with more than one
autoscaled API task — the copies diverge.

**Fix (decision: Postgres-authoritative):** **PostgreSQL is the single source of truth; the API
service is genuinely stateless** (per-request transaction through a repository layer; no shared
in-process graph). Redis is cache/coordination only, never a second copy of truth.
→ `03` §4.2, `06` §2–§3.1, `08` Phase 2.

### A3 — Unclear who owns tournament progression / results in early phases
**Verdict: Relevant (confirmed in code).** `mvp/src/platform/runtime.ts` the client-side `Runtime`
calls `api.completeTournament(...)` — the browser computes and writes standings. Once data is
shared, a hostile client could write its own results.

**Fix:** The authoritative tournament loop (clock → eliminations → `completeTournament`) moves
**server-side no later than Phase 2** (not left on the client until the Phase 3 table split).
Clients submit only actions, never results. Verified by a "tampered client cannot POST a result"
check.
→ `03` §6, `08` Phase 2.

### A4 — "Sticky by `table_id`" won't work as written
**Verdict: Relevant.** ALB cookie stickiness is **per-client, not per-table**; it cannot route all
seats of a table to the one task that owns it.

**Fix:** An explicit **table-ownership routing layer** — a Redis `table_id`→owning-task registry
plus a thin WS router that redirects or forwards commands; ownership by consistent hashing;
recovery from the hand event log. Named a **Phase 3 work item**, not a config flag.
→ `03` §2/§6, `06` §2, `08` Phase 3 + risk #3.

### A5 — "Extra decision time" Diamond perk = pay-to-win
**Verdict: Relevant.** Buying think-time in a ranked/league game is a competitive advantage —
pay-to-win — and contradicts "a Diamond never affects outcomes." It is exactly what triggers
store gambling/social-casino classification.

**Fix (reinforced by the owner's "Diamonds have no responsibility yet" decision):** Diamonds ship
as **balance + ledger only, with no spend paths at all.** The "extra decision time" perk is
**removed**. Any *future* spend feature is constrained to be **purely cosmetic** (themes, table
designs, card backs, emotes) and may never touch chips, outcomes, or rankings.
→ `04` §4, `00-INDEX` guardrails, `01` §4, `03` §8.

---

## B. Missing technical topics — added to the plan

| # | Topic | Verdict | Where addressed |
|---|---|---|---|
| B1 | In-app **account self-deletion** (Apple); distinct from club-side `crm.forgetPlayer` | Relevant, genuinely missing | `03` §5, `08` Phase 4, `05` §5, `02` §14 |
| B2 | **Age gate** at registration (17+/18+) | Relevant | `03` §5, `08` Phase 4, `05` §5, `02` §14 |
| B3 | **ToS/privacy consent capture** at registration (technical half) | Relevant | `03` §5, `08` Phase 4, `02` §14 |
| B4 | **Disconnect/timeout mid-hand** (auto fold/sit-out) pulled into Phase 3, not Phase 6 | Relevant | `03` §6, `08` Phase 3, `02` §14 |
| B5 | **One account per verified email/phone** + rate limits (leaderboard integrity) | Relevant | `03` §5, `08` Phase 4, `02` §14 |
| B6 | **No bots / no demo-seed data in production**; deploy seeds empty/real data | Relevant | `03` §8 |
| B7 | **Email deliverability** (SPF/DKIM/DMARC) + **rehearse backup restore** | Relevant (ops) | `03` §7, `06` §3.1, `08` Phase 5 |
| B8 | In-app Diamond top-ups must use **Apple/Google IAP**, not Stripe (architecture) | Relevant (technical part) | `04` §4, `05` §5 |
| B9 | **Profit-module time estimate** (was absent → plan incomplete) | Relevant | `08` §3 |
| B10 | **Per-club limits when the subscription moves to owner level** — define behaviour | Relevant | `04` §3 |

---

## C. Left to the owner (business — out of this response's scope)

- **White-label price inconsistency** (₪2,500 vs $1,000 ≈ $690) — pick one; pricing decision.
- **CRM gated only to the $200 tier** vs. the low-friction acquisition strategy — packaging.
- **Store commission (15–30%) on IAP changing the economics** — the *technical* IAP requirement is
  handled (B8); the pricing impact is a business call.
- **Payment processors possibly refusing a gambling-adjacent product** — flagged; a legal/
  commercial diligence item (open it early, in parallel with engineering).

---

## D. What the review verified as correct (no change needed)

File/segment/permission counts, the 3-clubs-per-owner cap, the 14 system segments, the 22
permissions, the 220/165 test counts, the absence of CI and a lockfile, and the self-identified
risks (client-side breadth, no rollback in `store.mutate`, direct `Date.now()` in
`competition.ts`). These stand as written.
