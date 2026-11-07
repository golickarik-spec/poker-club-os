# Poker Club OS — Production Readiness: AWS Architecture & Migration Roadmap

## Context

**Why.** Poker Club OS v0.4 is a complete, well-tested product *prototype* that runs
entirely in one browser tab: the poker engine, the "backend" service layer
(`src/platform/*`), the scheduler (`Runtime.tick`), and the React UI all share one
process and one `localStorage` database. Every permission check and tenant-isolation
rule is real, unit-tested code — but it is enforced only inside the tab, so anyone with
devtools can read every club's private data. The goal: make it production-ready — deploy
on AWS, split into services, and define the production architecture.

**What prompted this.** The codebase was deliberately built to grow into a client/server
system without a rewrite (see `PRODUCTION_ARCHITECTURE.md`): services follow a uniform
`fn(db, actorId, …args)` contract, the engine is transport-agnostic (`submitCommand` with
seq/actionId idempotency), event redaction (`redactEvent`) and the delayed spectator buffer
are already shaped for a WebSocket boundary, and there is **zero DOM coupling** anywhere in
`src/platform` or `src/engine`. This document converts that documented intent into a
concrete AWS design and an ordered, each-step-ships migration.

**Decisions taken:**
- **Deliverable:** architecture + phased roadmap (this document). No code changes yet.
- **Compute:** AWS **ECS Fargate** (containers, supports the stateful WebSocket table tier).
- **Scale (v1):** **Small SaaS** — single region, multi-AZ; hundreds of concurrent
  players, dozens of clubs; managed RDS Postgres + single ElastiCache Redis; scale later.
- **Money model:** **virtual-chips-only** preserved. Production = a B2B SaaS for clubs
  (subscription billing only). No wallet / deposits / payouts — stays out of gambling
  licensing scope. A build-time test already fails if any money code path appears; keep it.
- **Delivery targets:** ship **two ways from one codebase** — a **website** (S3/CloudFront SPA)
  and **native iOS/Android apps** published to the App Store and Play Store via a **Capacitor
  shell wrapping the same bundle** (not a React Native rewrite). See §8.5 and Phase 7.

**Intended outcome.** A target architecture the team can build toward, a service split, a
data model, and a 7-phase roadmap where every phase leaves a working system — ending with
the app deployed on AWS Fargate with real auth, Postgres persistence, server-authoritative
play, and real notification channels, delivered as a website and as native App Store /
Play Store apps from one bundle.

> This is an evaluation/plan. **Legal review is a hard prerequisite to any commercial
> launch** (CRM holds PII; marketing messages need consent; per-market gambling-law review
> even for virtual chips). That gate is owned by counsel, not this plan.

---

## 1. Current state (grounded)

| Layer | Today | Files |
|---|---|---|
| UI | React, in-memory routing (no URL), 6 demo identities via `signIn` | `src/app/`, `src/player/`, `src/console/`, `src/platform-admin/`, `src/table/` |
| Service layer | Pure `fn(db, actorId, …)`, synchronous, no Promises, no DOM | `src/platform/*.ts` |
| Engine | Pure TS, injectable `Rng`, transport-agnostic commands | `src/engine/*.ts` |
| Scheduler/realtime | `Runtime` 250ms `setInterval` tick; `TableDriver` paces one viewer; delayed `feeds` | `src/platform/runtime.ts` |
| "DB" | One mutable `DB` object (`types.ts:998`), direct mutation, best-effort `localStorage` | `src/platform/store.ts` |
| Build | esbuild + Tailwind v4 → single inlined `dist/index.html` | `scripts/build.mjs`, `scripts/dev.mjs` |

**Extraction verdict (from code exploration):**
- *Server side is near drop-in.* `permissions.ts` throws `ForbiddenError`/`DomainError`
  that map cleanly to HTTP 403/400/409. `clock.now()` (`core.ts:29`) and `Rng` are
  injectable. The only browser touch — `globalThis.localStorage?.…` in `store.ts` — already
  no-ops on Node.
- *Client side cost is breadth, not depth.* ~100 `useDb()` reads return the **whole DB
  graph** synchronously; ~139 `act()` writes assume in-process whole-graph access and a
  **client-trusted `me.id`**, across ~55 screens. The fix concentrates in `app/hooks.ts`,
  `app/context.ts`, `console/crm/shared.tsx` + a new `platform/client.ts`, then propagates
  async/loading semantics to call sites.
- *Three real engineering decisions:* (1) sync in-memory `DB` → durable store with a
  transaction boundary (today `store.mutate` has **no rollback on throw**); (2) channel
  adapters are synchronous (`channels.ts:17`) and must become async behind a queue;
  (3) the 250ms tick is single-process — production needs **one authoritative runtime per
  running tournament** (leader election / sharding).

---

## 2. Target AWS architecture (single region, multi-AZ)

```
                         Route 53  ─┐
                                    ▼
              CloudFront (SPA static assets, S3 origin)
                                    │
  Browser (React SPA) ── HTTPS/JSON & WSS ──► ALB (HTTP + WebSocket listeners)
                                    │
        ┌───────────────┬───────────┴───────────┬──────────────────┐
        ▼               ▼                        ▼                  ▼
  ECS Fargate      ECS Fargate              ECS Fargate        ECS Fargate
  API service      Table service            Scheduler          Channel workers
  (Fastify,        (WS, per-table actor,    (leader-elected,   (drain outbox →
   stateless,       engine + Runtime,        cron-like loop)    SES/SNS/Twilio)
   autoscaled)      sticky by table)         single active      SQS-driven
        │               │                        │                  │
        └───────┬───────┴──────────┬─────────────┴──────────────────┘
                ▼                   ▼
        RDS PostgreSQL        ElastiCache Redis            S3 (uploads: logos,
        (Multi-AZ, business   (pub/sub, presence,          covers, CSV imports,
         data + append-only   table/timer state,           export downloads)
         hands & audit)       delayed-feed streams,
                              rate limits, scheduler lock)
```

**Supporting AWS services:** Cognito (identity) or self-rolled magic-link/JWT; Secrets
Manager (DB creds, provider keys); SQS (outbox → channel workers; job queue); ECR
(images); CloudWatch + X-Ray (logs/metrics/traces); WAF on CloudFront/ALB (rate limiting,
edge rules); ACM (TLS). IaC via **AWS CDK (TypeScript)** so infra shares the repo's
language and types.

---

## 3. Service split (4 deployable services + client)

The one browser bundle splits along boundaries that already exist in the code.

| Service | Owns | Built from | AWS |
|---|---|---|---|
| **Client (SPA)** | All of `src/app`, `src/player`, `src/console`, `src/platform-admin`, `src/ui`, `src/table` rendering. **No** engine/service logic shipped. | Reworked `build.mjs` → static JS/CSS bundle | S3 + CloudFront |
| **API service** | Every exported fn in `api.ts`, `crm.ts`, `messaging.ts`, `analytics.ts`, `competition.ts`, `retention.ts`, `calendar.ts`, `scheduling.ts`, `migration.ts`, `integrity.ts`, `permissions.ts`, `core.ts`. Stateless, horizontally scalable. | Fastify wrapper; `actorId` from session, never body | Fargate behind ALB |
| **Table service** | `src/engine/*` + `Runtime`/`TableDriver` + delayed `feeds`. One authoritative actor per table; clients send `submitCommand`, receive redacted event streams over WSS. | Extracted `runtime.ts` as WS server | Fargate, sticky routing by `table_id`, Redis-backed state |
| **Scheduler worker** | `Runtime.tick` housekeeping split out: `publishDueAnnouncements`, `automation.tick`, `runSchedules`, `runInactivityAlerts`, `runPersonalReminders`. Idempotent (dedupe keys exist today). | Headless loop, **Redis leader lock** (single active) | Fargate (1 task) / or EventBridge-triggered |
| **Channel workers** | Drain `db.outbox` via `channels.registerAdapter`; real SES/SNS/Twilio/FCM adapters, async. | SQS consumers | Fargate, SQS-scaled |

**The client seam (`src/platform/client.ts`, to be written).** Screens `import * as api`
today. Introduce `client.ts` mirroring the service signatures but calling the API; use a
build-time module alias so `platform/api.ts` → `client.ts` in the client bundle — screens
change imports, not logic. The unavoidable propagation: service calls become **async**, so
`act()` (`context.ts:68`), `useReport` (`crm/shared.tsx:28`) and `useDb` (`hooks.ts:9`)
get reworked to Promise/loading/subscription semantics, then call sites adjust.

---

## 4. Data layer

**PostgreSQL (RDS, Multi-AZ).** The `DB` interface (`types.ts:998`) *is* the schema; each
top-level collection becomes a table (mapping already enumerated in
`PRODUCTION_ARCHITECTURE.md` §4 and `ARCHITECTURE.md` §3.6). Key points:
- Keep prefixed string ids (`t_`, `u_`) so seed fixtures import unchanged.
- **Tenant key `club_id` on every club-scoped row**, backed by Postgres row-level security
  (`SET app.club_id`) in addition to the application `requirePermission` checks.
- **Unique constraints** replace today's code-enforced uniqueness: one membership per
  (club,user), one registration per (tournament,user), one tag name per club.
- **Append-only + partitioned:** `hands` (events JSONB, per-viewer redaction at read),
  `audit_log`, `crm_events` — partition by month; `applyRetention` already exists as the
  retention job.
- **Indexes** for the analytics reports (today they recompute from records each call — fine
  at hundreds of members; add indexes/materialized views when scale demands).
- Repository layer behind the service functions; `types.ts` stays source of truth.

**Transaction boundary.** `store.mutate(fn)` (`store.ts:73`) is the seam — wrap each
service call in `withTx(tx => fn(tx, actor, …))`. This also fixes today's no-rollback gap.
Decision for v1: **keep the hot business DB in-process, write-through to Postgres per
mutation** (closest to current design, lowest refactor), OR full repository per call. Lean
write-through-per-mutation first; revisit if contention appears.

**Redis (ElastiCache).** Table/timer state, pub/sub for `club:{id}` / `tournament:{id}` /
`table:{id}:{seat|public|delayed}` channels, presence, delayed-feed ring buffer (moves out
of `runtime.ts` `feeds`), rate limits, and the scheduler leader lock.

**S3.** Uploaded images (logos/covers — today inlined/stripped on quota in `store.ts:95`),
CSV imports (`migration.ts`), and real export downloads (today export is copy-only).

---

## 5. Identity, auth & multi-tenancy

Replaces the demo `signIn(db, userId)` stub (`session.ts:138`) where `me.id` is
client-trusted.
- **Auth:** email magic-link / OTP first (clubs already invite by link), optional OAuth
  later. Web = HttpOnly session cookies; mobile = refresh tokens. Device binding for
  streamer mode and the platform console. Cognito is the managed option; a self-rolled
  JWT + magic-link service is viable given the small surface.
- **`actorId` comes from the verified session server-side** and is injected into every
  service call — the client can no longer assert identity.
- **Authorisation unchanged in spirit:** `permissions.ts` `can`/`requirePermission`/
  `requirePlatform` become API middleware; the 22 permissions and 5 roles carry over
  verbatim. The three architecture tests in `tests/crm.test.ts` (no screen reads private
  stores / access codes / unguarded calcs) keep guarding the boundary.
- **Multi-tenancy = app checks + Postgres RLS** (defense in depth). Tenant isolation is a
  primary pen-test target.

---

## 6. Server-authoritative play (table service)

The engine moves to the server unchanged (pure TS). The contract already assumes this:
- Client sends `submitCommand(table, {seat, handNo, seq, actionId, action})`
  (`engine/session.ts:30`); server validates with `legalActions`, idempotency key per turn.
- Server emits only **redacted** `TableView`/`HandEvent` per viewer (`redactEvent`,
  `engine/view.ts`); `viewOfAll` stays server-only. The client never holds the deck.
- **Turn timer becomes server-driven;** client renders only the deadline it's sent.
- **Shuffle:** keep CSPRNG (`crypto.getRandomValues` → Node `webcrypto`, already injectable
  via `rng.ts`); store per-hand shuffle-seed hash for audit. *Not* certified RNG (out of
  scope for virtual-chips v1; never claim certification).
- **Delayed spectator feed** moves to Redis streams; nothing younger than the delay
  (≥30s public / ≥60s streamer) is ever published; `canWatchTournament` gates server-side.
- **Scaling:** one authoritative actor per table; route WS connections sticky by table;
  recover in-flight tournaments from the hand event log on task restart.

---

## 7. Jobs, notifications & scheduling

- **Scheduler worker** runs the housekeeping steps from `Runtime.tick` as one
  leader-elected process (Redis lock): registration windows, start times, reminders,
  recurring schedules (`runSchedules`), inactivity alerts, retention (`applyRetention`),
  data-retention erasure (today manual — becomes scheduled). Each step is already
  idempotent via dedupe keys / `startAt` identity.
- **Channel workers** drain `db.outbox` through `channels.registerAdapter` (`channels.ts:39`)
  — the documented seam. Make `ChannelAdapter.send` **async**; wire real providers: **SES**
  (email), **SNS** (SMS) or Twilio, **FCM/APNs** (push). Provider secrets in Secrets Manager,
  never in the client bundle. Until an adapter is registered, rows stay `simulated` exactly
  as today. Delivery records already separate "eligible" from "delivered" with per-channel
  consent — unsubscribe handling hangs off that.

---

## 8. AWS infrastructure & delivery

- **Networking:** VPC, public subnets (ALB, NAT), private subnets (Fargate, RDS, Redis);
  security groups least-privilege; ALB with HTTP + WebSocket listeners; ACM TLS.
- **Edge:** CloudFront serves the SPA from S3; WAF for rate limiting and basic rules.
- **IaC:** **AWS CDK (TypeScript)** in a new `infra/` workspace — VPC, ECS cluster + 4
  services, RDS, ElastiCache, S3 buckets, SQS, Cognito/secrets, CloudFront, alarms.
- **Containers:** per-service `Dockerfile` (Node 20); images to ECR; the client build
  (reworked `build.mjs`) emits static assets instead of one inlined HTML.
- **CI/CD:** GitHub Actions (or CodePipeline) → typecheck, `npm test` (220 unit) + e2e,
  build images, `cdk deploy`. Blue/green or rolling on ECS.
- **Observability:** CloudWatch logs/metrics/alarms, X-Ray tracing, structured logs;
  real metrics behind the existing Health screen (today simulated).
- **Config:** inject `API_BASE_URL` / WS URL at build (today `build.mjs:80` only defines
  `NODE_ENV`/`__DESIGN__`).
- **Backups/DR:** RDS automated backups + PITR; S3 versioning; multi-AZ failover. (Single
  region for v1; multi-region deferred.)

---

## 8.5. Delivery targets: web + native apps (one codebase)

The product ships **two ways from a single React bundle**: a **website** and **native iOS/Android
apps** in the App Store and Play Store. The native apps are a **Capacitor** shell wrapping the
*same* static assets — **not** a React Native rewrite (which would re-code all ~55 screens). The
engine, service layer, and permission checks are byte-for-byte identical across targets.

**One codebase, two targets.** The reworked `build.mjs` (already required by §8 / Phase 6) emits
static JS/CSS instead of one inlined HTML. The **website** serves those assets from CloudFront/S3.
The **native apps** wrap the same assets in a Capacitor WebView shell (`@capacitor/ios`,
`@capacitor/android`), producing a signed `.ipa` and `.aab`.

**Why this is cheap here (grounded in the current code):**
- Self-contained bundle, no bundler framework or asset pipeline to untangle (`scripts/build.mjs`).
- In-memory routing with no URL/history coupling (`src/app/session.ts:1-5`, `go()` in
  `hooks.ts:146`) — nothing to reconcile with native navigation.
- Mobile ergonomics already done: `viewport-fit=cover` + `color-scheme: dark` (`build.mjs:97-98`),
  safe-area insets and 44px touch targets from the v3 redesign.
- The `push` channel and the `registerAdapter` seam already exist (`src/platform/channels.ts:11,38`);
  mobile auth already planned as refresh tokens in §5.

**Native work items (the real gaps):**
1. **PWA baseline** — web manifest, icon set, service worker, offline app-shell, and self-host the
   Google Fonts currently loaded from the CDN at runtime (`build.mjs:28-32`). *Also upgrades the
   website to an installable PWA — a shared benefit, not just mobile.*
2. **Capacitor projects** — add iOS + Android platforms; app icons/splash; status-bar + safe-area
   config (CSS insets already present); `@capacitor/app` pause/resume to flush state (mirrors the
   existing `pagehide` flush in `context.ts:99`).
3. **Native bridge shims behind existing seams** — replace WebView-hostile paths: anchor-`download`
   exports (ICS `Calendar.tsx:87`, CSV `crm/Migration.tsx:79`, QR `shared/qr.tsx:25`) → 
   `@capacitor/filesystem` + share sheet (these **break in iOS WKWebView**); durable storage →
   `@capacitor/preferences`/SQLite in place of the evictable `localStorage` persistence
   (`store.ts:16-40`); camera/QR → a scanner plugin (today a placeholder, `Clubs.tsx:459`); Android
   hardware back → `session.back()`; OS deep links + push-tap → `go(name, params)` (`hooks.ts:146`);
   clipboard via a plugin where `navigator.clipboard` is unreliable.
4. **On-device push** — `@capacitor/push-notifications` to obtain APNs/FCM device tokens and
   register them with the API; wire the real push `registerAdapter` (`channels.ts:38`). The
   *server* half of this is already Phase 5, so this is only the incremental client side.
5. **Mobile CI + store submission** — Fastlane/Codemagic (or EAS) build + sign; Apple Developer +
   Google Play accounts; privacy "nutrition labels" / Data Safety forms; screenshots/metadata;
   TestFlight / internal-testing tracks; review cycles.

**Auth note (ties to §5):** §5 already specifies web = HttpOnly session cookies, **mobile =
refresh tokens** — the mobile auth path is accounted for; Phase 7 just consumes it.

**Store-policy gate (important).** A poker app — *even virtual-chips-only* — is treated as a
**"social casino" / gambling-category** app by both stores. Expect **age-gating (17+/18+)**,
possible **regional availability restrictions**, and extra review scrutiny (Apple Guideline 5.3,
Google gambling policy). This is a real submission gate that **overlaps the existing legal gate**
(see the §Context note and §12.6). It is *not* RNG certification (still out of scope per §10) — and
the UI must continue to never claim certification.

**Effort: ≈ +6–10 weeks of engineering** (PWA baseline ~1–1.5 wk · Capacitor projects ~1–2 wk ·
native bridge shims ~2–3 wk · on-device push ~1–2 wk · mobile CI + store submission ~2–3 wk), plus
external store-review calendar time. See Phase 7 below.

---

## 9. Phased migration roadmap (each phase ships a working system)

Mirrors `PRODUCTION_ARCHITECTURE.md` §7, made concrete. Estimates are rough engineering
effort for a small team, excluding legal/security audit calendar time.

| # | Phase | Scope | Leaves working | Est. |
|---|---|---|---|---|
| 1 | **Extract the API** | Wrap `platform/*` in Fastify; in-memory `DB` seeded from `seed.ts`; write `client.ts`; make `act`/`useDb`/`useReport` async; swap client import target. Error→HTTP adapter. | Two processes, same behaviour; existing unit suite runs unchanged against the service layer. | 3–5 wk |
| 2 | **Persist** | Repository layer + RDS Postgres; `withTx` around `store.mutate`; migrate fixtures; add unique constraints, RLS, partitions, indexes. | Durable data; survives restarts; multi-user safe writes. | 3–4 wk |
| 3 | **Move the tables** | Table service as WS server; `TableDriver` → WS client; engine + `Runtime` server-side; delayed feed → Redis streams; server-driven timers. | Real multiplayer, server-authoritative; hole cards never leave the server. | 4–6 wk |
| 4 | **Auth & tenancy** | Magic-link/OTP + sessions; `actorId` from session; `permissions` as middleware; RLS enforced; demo identities → real accounts. | Secure, real logins; cross-tenant access impossible even with devtools. | 3–4 wk |
| 5 | **Workers & channels** | Scheduler worker (leader lock) + SQS channel workers; register SES/SNS/FCM adapters async; scheduled retention/erasure. | Jobs run with the tab closed; real email/SMS/push; unsubscribe honored. | 2–3 wk |
| 6 | **AWS deploy & hardening** | CDK infra; Dockerize 4 services; CI/CD; CloudFront SPA; observability; WAF/rate limits; load test concurrent tables; reconnection handling; security review + pen test. | Live on AWS Fargate, monitored, autoscaled, pen-tested. | 4–6 wk |
| 7 | **Web + native delivery** | Static-asset build (shared w/ Ph 6); PWA manifest/SW/icons, self-host fonts; Capacitor iOS+Android wrapping the same bundle; native shims (downloads→share, durable storage, camera/QR, back-button, deep-link/push-tap routing); on-device push token registration → real push adapter; mobile CI + store submission. | Installable PWA website **and** App Store / Play Store apps from one codebase. | 6–10 wk eng + external store-review time |

**Parallelizable:** CDK/infra scaffolding (Phase 6 groundwork) and the client async refactor
(Phase 1) can start alongside Phase 2. Phases keep the previous one working — the
"gradual migration, no big-bang rewrite" rule.

**Phase 7 dependencies:** needs Phase 4 (auth / mobile refresh tokens) and Phase 5 (server-side
push adapter) to point at. The *website* itself ships in Phase 6, so the **web delta in Phase 7 is
only PWA installability**. Native shell scaffolding can begin in parallel once the static-asset
build (Phase 6 groundwork) exists; the app-store gambling-policy / age-gating gate runs alongside
the legal gate and should be opened early.

---

## 10. Explicitly out of scope / preserved

- **No real money, at any phase.** No wallet, deposits, withdrawals, wagering, payouts.
  Virtual chips remain the only currency. Keep the build-time test that fails on money code.
- **No certified RNG / collusion detection** for v1 (virtual chips); keep shuffle-seed
  audit hash only, and never claim certification in the UI.
- **Multi-region and real-money seams (KYC/settlement)** — deferred. (Native mobile apps are
  **now in scope as Phase 7** — Capacitor shell from the same bundle, see §8.5. Desktop shells
  (Tauri/Electron) remain deferred but are reachable from the same bundle.)
- **Legal/privacy operations** (DSARs, jurisdiction review, counsel-written terms) — a
  prerequisite gate owned by counsel, tracked but not built here.

---

## 11. Verification

How each future phase proves itself end-to-end (the repo already has the harness for most):

- **Service layer unchanged:** `npm test` (220 unit incl. 3 architecture tests) must stay
  green through Phase 1–2 — it's the regression net that the extraction didn't change logic.
- **Phase 1 (API):** curl the REST routes (mapping in `ARCHITECTURE.md` §3.7); confirm
  `actorId` is ignored from the body and a wrong actor gets 403; run the service-level demo
  journey (`crm.test.ts`) against the HTTP server.
- **Phase 2 (persist):** restart the API, confirm data survives; attempt a cross-tenant read
  as River Kings' owner against a Midnight route → 403 + RLS denial (journey E logic).
- **Phase 3 (tables):** drive a hand over WSS from two browsers; assert via a WS client that
  a spectator frame is ≥30s delayed and contains **no** live hole cards (mirror
  `engine.test.ts` redaction tests over the wire); kill the table task mid-hand and confirm
  recovery from the event log.
- **Phase 4 (auth):** magic-link login issues a session; devtools cannot forge `actorId`;
  re-run journeys A–E against real accounts.
- **Phase 5 (channels):** trigger an announcement, assert an email arrives via SES sandbox
  and the delivery record's "delivered" count is real (not `simulated`); close all tabs and
  confirm a scheduled reminder still fires.
- **Phase 6 (AWS):** `cdk deploy` to a staging account; synthetic load test of N concurrent
  tables; chaos-kill a Fargate task and confirm ALB reroute + reconnection; pen test with
  tenant isolation as the primary target; CloudWatch dashboards show real health metrics.
- **Phase 7 (delivery):** `npm run build` emits static assets; `npx cap sync` + run on the iOS
  Simulator and an Android emulator; confirm a cold launch works offline against the app shell,
  an OS deep link and a tapped push both route via `go()`, an ICS/CSV export opens the native
  share sheet (not a broken WebView download), and the QR scanner reads an invite. Submit to
  TestFlight + Play internal testing; pass store review with age-gating applied.

---

## 12. Key risks / watch items

1. **Client async refactor breadth** — ~139 `act()` + ~100 `useDb()` sites. Mitigate by
   keeping the `import * as api` → `client.ts` swap, concentrating loading/error semantics in
   the three hub files, and leaning on the e2e journeys as the safety net.
2. **Transaction/rollback gap** — `store.mutate` doesn't roll back on throw today; must be
   fixed in Phase 2 or partial writes corrupt state under real concurrency.
3. **Single-authoritative table tick** — needs sticky routing + per-table ownership +
   event-log recovery; getting this wrong = duplicated or lost hands under failover.
4. **`competition.ts` bypasses injectable `clock`** in several default params (uses
   `Date.now()` directly) — route through `clock.now()` for deterministic server time.
5. **Analytics recompute-per-request** — fine at hundreds of members, needs indexes/
   materialized views before mid-scale; keep the definitions, change the execution.
6. **Legal gate is on the critical path** for launch even though it's not engineering.
7. **App-store gambling-policy / age-gating gate (Phase 7)** — a poker app, even virtual-chips,
   is reviewed as social-casino; age-gating + regional restrictions + review rejection risk make
   store submission a launch-blocking gate alongside the legal one. Open it early.
8. **WKWebView `localStorage` eviction (Phase 7)** — the native app's persistence must move off
   the evictable WebView `localStorage` (`store.ts:16-40`) to a durable store (`@capacitor/preferences`/SQLite),
   or users silently lose local state.
