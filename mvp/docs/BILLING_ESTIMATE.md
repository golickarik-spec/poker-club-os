# Poker Club OS — Production Build: Billing & Pricing Summary

> Companion to `docs/PRODUCTION_READINESS_AWS.md`. All figures in **ILS (₪)**, Israeli
> freelance/contract market, 2025–26. These are market-based ranges to calibrate against
> your own seniority and the client — not fixed quotes. All figures are **before VAT
> (מע״מ 18%)** and are **build fees only** unless stated otherwise.

---

## 1. Effort basis (from the roadmap)

The six-phase plan sums to **19–28 weeks of engineering effort ≈ 760–1,120 hours**
(~4.5–6.5 months full-time for one strong senior dev).

| Phase | Effort | Hours (40h/wk) | Fee @ ₪400/hr |
|---|---|---|---|
| 1 — Extract API + client async | 3–5 wk | 120–200 | ₪48K–₪80K |
| 2 — Persist (Postgres, tx, RLS) | 3–4 wk | 120–160 | ₪48K–₪64K |
| 3 — Move tables (WS, server-authoritative) | 4–6 wk | 160–240 | ₪64K–₪96K |
| 4 — Auth & tenancy | 3–4 wk | 120–160 | ₪48K–₪64K |
| 5 — Workers & channels | 2–3 wk | 80–120 | ₪32K–₪48K |
| 6 — AWS deploy & hardening | 4–6 wk | 160–240 | ₪64K–₪96K |
| **Total** | **19–28 wk** | **760–1,120 h** | **₪304K–₪448K** |

---

## 2. Rate tiers (Israel, freelance/contract)

| Tier | ₪/hr |
|---|---|
| Mid-senior full-stack | 250–350 |
| **Strong senior, AWS + real-time/WebSocket** (this project) | **350–500** |
| Architect / small-studio blended | 500–700 |

This work is distributed-systems + server-authoritative real-time + multi-tenant security.
Price it in the second tier — **not** as generic CRUD.

---

## 3. Full six-phase build — the number

| Rate | Low (760h) | High (1,120h) |
|---|---|---|
| ₪350/hr | ₪266,000 | ₪392,000 |
| **₪400/hr** | **₪304,000** | **₪448,000** |
| ₪450/hr | ₪342,000 | ₪504,000 |

- **Headline range: ₪300,000–₪500,000.**
- **Single fixed-price figure: ~₪380,000–₪420,000** (midpoint + 20–25% contingency).
  Fixed bids overrun; the two hardest parts are the ~239 client call-sites going async
  (Phase 1) and server-authoritative table failover/reconnection (Phase 3).
- **As a retainer:** ~₪55,000–₪70,000/month for ~6 months.

---

## 4. The "I can do it in 2–3 weeks" case — price by value, not hours

If your own estimate is far below the market effort, the key rule is: **never quote your
hours; quote the deliverable.** The client is buying a production platform (market value
₪300K–₪500K / 5–6 months), not your calendar time. Billing `~120h × ₪500 = ₪60K` punishes
your own speed and hands over a ₪300K+ asset for a fraction of its worth. **Do not disclose
your hours to the client.**

Two readings of "2–3 weeks":

| Scenario | What it means | Quote |
|---|---|---|
| **A — Reduced scope** (more likely) | Phases 1–2 + a basic deploy; **no** real-time table service, channel workers, or pen-test | **₪40,000–₪90,000**, with the omitted phases named as separate later work |
| **B — Full plan, you're just fast** | The entire six-phase deliverable, delivered fast | **₪150,000–₪300,000** (value-based discount off the ₪380K midpoint) |

**Floors:** a full production platform should not leave your mouth under **~₪100K–₪150K**;
a genuinely-reduced first slice not under **~₪40K**. Don't let "it's only a couple weeks"
anchor the price down.

---

## 5. NOT included in the build fee — quote these separately

| Item | Who pays | Rough cost |
|---|---|---|
| **AWS running costs** (Fargate, RDS Multi-AZ, ElastiCache, ALB, NAT, CloudFront, S3) | Client, ongoing | **$500–$1,000/mo ≈ ₪1,800–₪3,700/mo** |
| **Legal / counsel** (PII, marketing consent, gambling-law review — hard launch gate) | Client | counsel's rates |
| **Security pen-test** (Phase 6, if outsourced to a specialist firm) | Add-on | **₪30,000–₪80,000** |
| **Ongoing maintenance/support** (post-launch) | Separate retainer | ~15–20% of build fee / year |
| **VAT (מע״מ 18%)** | Added on invoice | on top of all figures above |

---

## 6. Pricing-strategy notes

- **Bill by milestone**, not lump sum — each phase ships something testable; bill on
  acceptance. Take **~20–25% upfront**.
- Prefer **Time & Materials or capped-T&M** over pure fixed-price; Phase 3 is the most
  likely to exceed estimate.
- If the client insists on fixed-price, use the **high end + contingency** (~₪450K–₪500K
  for the full build), not the low end.
- **De-risking entry offer:** quote **Phases 1–2 alone (~₪100K–₪140K)** as a first contract
  that proves out the architecture before committing to the rest.
