# 08 — Roadmap

> **Audience: all.** The phased delivery sequence from today's prototype to a deployed
> production system, with the **profit module** woven in. Every phase leaves a working system —
> the "gradual migration, no big-bang rewrite" rule. Estimates are rough engineering effort for
> a small team, excluding legal/security/store calendar time.

---

## 1. The phases at a glance

| # | Phase | Leaves working | Est. |
|---|---|---|---|
| 1 | **Extract the API** | Two processes, same behaviour; the 220-unit suite runs unchanged against the service layer | 3–5 wk |
| 2 | **Persist** | Durable data; survives restarts; multi-user-safe writes | 3–4 wk |
| 3 | **Move the tables** | Real multiplayer, server-authoritative; hole cards never leave the server | 4–6 wk |
| 4 | **Auth & tenancy** | Secure real logins; cross-tenant access impossible even with devtools | 3–4 wk |
| 5 | **Workers & channels** | Jobs run with the tab closed; real email/SMS/push; unsubscribe honoured | 2–3 wk |
| 6 | **AWS deploy & hardening** | Live on Fargate, monitored, autoscaled, pen-tested | 4–6 wk |
| 7 | **Web + native delivery** | Installable PWA website **and** App Store / Play Store apps from one codebase | 6–10 wk eng + store review |
| **P** | **Profit module** (see §3) | Owner subscriptions, entitlements, Diamonds ledger; real billing after legal | woven across 2 / 4 / 6 |

Headline build range (from `BILLING_ESTIMATE.md`): **19–28 weeks** for Phases 1–6
(~760–1,120 hours), plus Phase 7 and the profit module.

## 2. Phase detail

### Phase 1 — Extract the API
Wrap `platform/*` in Fastify; in-memory `DB` seeded from `seed.ts`; write `client.ts`; make
`act` / `useDb` / `useReport` async; swap the client import target; error→HTTP adapter.
**Verify:** curl the REST routes; confirm `actorId` is ignored from the body and a wrong actor
gets 403; run the service-level demo journey (`crm.test.ts`) against the HTTP server.

### Phase 2 — Persist
Repository layer + RDS Postgres; `withTx` around `store.mutate` (fixes the no-rollback gap);
migrate fixtures (keep `t_`/`u_` ids); add unique constraints, RLS, partitions, indexes.
**Verify:** restart the API, data survives; attempt a cross-tenant read as one club's owner
against another club's route → 403 + RLS denial (journey E logic).

### Phase 3 — Move the tables
Table service as a WS server; `TableDriver` → WS client; engine + `Runtime` server-side;
delayed feed → Redis streams; server-driven timers.
**Verify:** drive a hand over WSS from two browsers; assert via a WS client that a spectator
frame is ≥ 30 s delayed and contains **no** live hole cards (mirror the engine redaction tests
over the wire); kill the table task mid-hand and confirm recovery from the event log.

### Phase 4 — Auth & tenancy
Magic-link / OTP + sessions; `actorId` from the session; `permissions` as middleware; RLS
enforced; demo identities → real accounts; mobile refresh tokens.
**Verify:** magic-link login issues a session; devtools cannot forge `actorId`; re-run journeys
A–E against real accounts.

### Phase 5 — Workers & channels
Scheduler worker (Redis leader lock) + SQS channel workers; register SES/SNS/FCM adapters
async; scheduled retention/erasure.
**Verify:** trigger an announcement, assert an email arrives via SES sandbox and the delivery
record's "delivered" count is real (not `simulated`); close all tabs and confirm a scheduled
reminder still fires.

### Phase 6 — AWS deploy & hardening
CDK infra; Dockerize the 4 services; CI/CD (`07-CICD-PIPELINE.md`); CloudFront SPA;
observability; WAF/rate limits; load-test concurrent tables; reconnection handling; security
review + pen test (tenant isolation is the primary target).
**Verify:** `cdk deploy` to staging; synthetic load test of N concurrent tables; chaos-kill a
Fargate task and confirm ALB reroute + reconnection; CloudWatch dashboards show real health.

### Phase 7 — Web + native delivery
Static-asset build (shared with Phase 6); PWA manifest/SW/icons, self-host fonts; Capacitor
iOS + Android wrapping the same bundle; native shims (downloads→share, durable storage,
camera/QR, back-button, deep-link/push-tap routing); on-device push token registration → real
push adapter; mobile CI + store submission. (`05-MOBILE.md`.)
**Verify:** `npm run build` emits static assets; `npx cap sync` + run on the iOS Simulator and
an Android emulator; cold launch works offline against the app shell; an OS deep link and a
tapped push both route via `go()`; an ICS/CSV export opens the native share sheet; the QR
scanner reads an invite. Submit to TestFlight + Play internal testing; pass store review with
age-gating.

## 3. The profit module, slotted in

The monetization (`04-PROFIT-MODULE.md`) is not one phase — it layers onto the infrastructure
as it lands:

| Profit step | Rides on | When |
|---|---|---|
| Owner subscriptions + `maxClubs`; generalised entitlements; Diamonds ledger (demo) | Phase 2 (persistence) | During/after Phase 2 |
| "Top Clubs" discovery (+ `country` field, `clubRankings`) | Phase 2 | Any time after persist |
| Sponsored promotions (Diamond-funded, paced by the scheduler) | Phase 5 (scheduler worker) | After Phase 5 |
| **Real billing** (provider checkout + webhooks) | Phase 6 (public HTTPS, Secrets Manager) | After Phase 6 **and legal** |
| White-label tenancy + platform branding editor | Phase 6 (server) + billing | After real billing |
| Engine SDK / B2B licensing | — (commercial track) | Parallel, any time |

## 4. Dependencies & parallelism

- CDK/infra scaffolding (Phase 6 groundwork) and the client async refactor (Phase 1) can start
  alongside Phase 2.
- Phase 7 needs Phase 4 (mobile refresh tokens) and Phase 5 (server-side push adapter). The
  *website* ships in Phase 6, so Phase 7's web delta is only **PWA installability**.
- Real billing needs Phase 6 (public endpoints + secrets) **and** the legal gate.
- The two external gates (legal, app-store) run **in parallel** with engineering and should be
  opened early — they gate the revenue switch and the mobile launch, not the build.

## 5. Top risks (watch items)

1. **Client async refactor breadth** — ~139 `act()` + ~100 `useDb()` sites. Mitigate with the
   `import * as api` → `client.ts` swap, concentrating loading/error semantics in the three hub
   files, and leaning on the e2e journeys as the safety net.
2. **Transaction/rollback gap** — `store.mutate` doesn't roll back on throw today; fix in
   Phase 2 or partial writes corrupt state under real concurrency.
3. **Single-authoritative table tick** — needs sticky routing + per-table ownership +
   event-log recovery; getting it wrong duplicates or loses hands under failover.
4. **`competition.ts` uses `Date.now()` directly** in some default params — route through
   `clock.now()` for deterministic server time.
5. **Analytics recompute-per-request** — fine at hundreds of members; add indexes/materialized
   views before mid-scale (keep definitions, change execution).
6. **Legal gate** is on the critical path for launch even though it is not engineering.
7. **App-store gambling-policy / age-gating gate** (Phase 7) — launch-blocking; open early.
8. **WKWebView `localStorage` eviction** (Phase 7) — move native persistence to a durable store
   or users silently lose local state.

## 6. Verification philosophy

The repo already has the harness for most of this: `npm test` (220 unit incl. 3 architecture
tests) is the regression net that must stay green through Phases 1–2, and the Playwright
journeys A–F + S (165 checks) re-run against each new boundary (HTTP, WSS, real auth). Each
phase above names its own end-to-end check. Keep the DEMO/MISSING honesty and the no-real-money
rule intact at every step.
