# 03 — Architecture & Service Split

> **Audience: engineering.** How today's single-browser-tab prototype becomes a production
> system split into deployable services, and why the existing code already supports that split
> with no rewrite. Companion to `06-AWS-ARCHITECTURE.md` (where these services run) and
> `08-ROADMAP.md` (the order to build them).

---

## 1. Where we are today (grounded)

| Layer | Today | Files |
|---|---|---|
| UI | React 19, in-memory routing (no URL), 6 demo identities via `signIn` | `mvp/src/app`, `mvp/src/player`, `mvp/src/console`, `mvp/src/platform-admin`, `mvp/src/table` |
| Service layer | Pure `fn(db, actorId, …)`, synchronous, no Promises, no DOM | `mvp/src/platform/*.ts` (22 files) |
| Engine | Pure TS, injectable `Rng`, transport-agnostic commands | `mvp/src/engine/*.ts` (13 files) |
| Scheduler / realtime | `Runtime` 250 ms `setInterval` tick; `TableDriver` paces one viewer; delayed `feeds` | `mvp/src/platform/runtime.ts` |
| "DB" | One mutable `DB` object, direct mutation, best-effort `localStorage` | `mvp/src/platform/store.ts` |
| Build | esbuild + Tailwind v4 → single inlined `mvp/dist/index.html` | `mvp/scripts/build.mjs` |

Every permission and tenant-isolation check is real, tested code — but it runs **inside the
tab**, so it protects against the interface and mistakes, not against someone with devtools.
Making it enforce against a hostile client is the whole point of the server split.

**Why the split is an extraction, not a rewrite:**

- The server side is near drop-in. `permissions.ts` throws `ForbiddenError` / `DomainError`
  that map cleanly to HTTP 403 / 400 / 409. `clock.now()` and `Rng` are injectable. The only
  browser touch (`globalThis.localStorage?.…` in `store.ts`) already no-ops on Node.
- `mvp/src/engine` has **zero DOM coupling** and is transport-agnostic (`submitCommand` with
  seq/actionId idempotency, `redactEvent` per-viewer redaction).
- The client-side cost is **breadth, not depth**: ~100 `useDb()` reads return the whole DB
  graph synchronously and ~139 `act()` writes assume in-process whole-graph access and a
  client-trusted `me.id`, across ~55 screens. The fix concentrates in `app/hooks.ts`,
  `app/context.ts`, `console/crm/shared.tsx`, and a new `platform/client.ts`, then propagates
  async/loading semantics to call sites.

Three genuine engineering decisions (not mechanical): (1) the sync in-memory `DB` becomes a
durable store with a transaction boundary (today `store.mutate` has **no rollback on throw**);
(2) channel adapters are synchronous and must become async behind a queue; (3) the single
250 ms tick becomes **one authoritative runtime per running tournament** (leader election /
sharding).

## 2. The service split — 4 deployable services + client

The one browser bundle splits along boundaries that already exist in the code. **Billing lives
inside the API service** (decision #4 in `00-INDEX.md`).

| Service | Owns | Built from | Runs on (see 06) |
|---|---|---|---|
| **Client (SPA)** | All rendering (`mvp/src/app`, `mvp/src/player`, `mvp/src/console`, `mvp/src/platform-admin`, `mvp/src/ui`, `mvp/src/table`). **No** engine/service logic shipped. | Reworked `build.mjs` → static JS/CSS | S3 + CloudFront |
| **API service** | Every exported fn in `api.ts`, `crm.ts`, `messaging.ts`, `analytics.ts`, `competition.ts`, `retention.ts`, `calendar.ts`, `scheduling.ts`, `migration.ts`, `integrity.ts`, `permissions.ts`, `core.ts` — **plus the profit/billing module** (plans, entitlements, invoices, payment webhooks, Diamonds ledger). Stateless, horizontally scalable. | Fastify wrapper; `actorId` from session, never from the body | Fargate behind ALB |
| **Table service** | `mvp/src/engine/*` + `Runtime`/`TableDriver` + delayed `feeds`. One authoritative actor per table; clients send `submitCommand`, receive redacted event streams over WSS. | Extracted `runtime.ts` as a WS server | Fargate, sticky by `table_id`, Redis-backed |
| **Scheduler worker** | The housekeeping split out of `Runtime.tick`: `publishDueAnnouncements`, `automation.tick`, `runSchedules`, `runInactivityAlerts`, `runPersonalReminders`, `applyRetention`. Idempotent (dedupe keys exist today). | Headless loop, **Redis leader lock** (single active) | Fargate (1 task) |
| **Channel workers** | Drain `db.outbox` via `channels.registerAdapter`; real SES/SNS/Twilio/FCM adapters, async. | SQS consumers | Fargate, SQS-scaled |

### 2.1 The client seam — `mvp/src/platform/client.ts` (to be written)

Screens `import * as api` today. Introduce `client.ts` that mirrors the service signatures but
calls the API over HTTP; use a build-time module alias so `platform/api.ts` → `client.ts` in
the client bundle. **Screens change their import target, not their logic.** The unavoidable
propagation: service calls become **async**, so `act()` (`context.ts`), `useReport`
(`crm/shared.tsx`) and `useDb` (`hooks.ts`) get reworked to Promise / loading / subscription
semantics, and then call sites adjust. This is risk item #1 in `08-ROADMAP.md`.

## 3. The uniform service contract (the reason this works)

Every service function already has one shape, which **is** the production RPC/REST contract:

```
requirePermission(db, actorId, 'crm.notes', clubId)   // or requirePlatform; throws ForbiddenError
validate input                                         // DomainError with a code the UI translates
mutate or compute                                      // plain objects
audit(...), logEvent(...), notify(...)                 // stored as message key + params
```

In production:
- `db` becomes a transaction handle: `withTx(async (tx) => fn(tx, actor, …args))`.
- `actorId` comes from the **verified session server-side**, never the request body.
- The thrown-error types map to HTTP status codes in one adapter.

A representative slice of the would-be HTTP surface (the full mapping is in `mvp/docs/ARCHITECTURE.md`
§3.7):

| Route | Service function |
|---|---|
| `POST /clubs/:id/membership-requests` | `requestJoin` |
| `POST /clubs/:id/members/:user/approve` (reject/suspend/ban) | `approveMember` … |
| `GET /clubs/:id/players?…` | `crm.queryPlayers` |
| `POST /clubs/:id/announcements` | `publishAnnouncement` |
| `GET /clubs/:id/analytics/funnel` | `analytics.funnelReport` |
| `POST /tournaments/:id/registrations` | `registerForTournament` |
| `POST /tables/:id/act` *(or WS command)* | `submitCommand` (table service) |

Realtime channels (over WSS / Redis pub-sub): `club:{id}`, `tournament:{id}`,
`table:{id}:{seat|public|delayed}`.

## 4. Data layer

### 4.1 PostgreSQL (RDS, Multi-AZ)

The `DB` interface (`types.ts`) **is** the schema: each top-level collection becomes a table.
The mapping is already enumerated in `mvp/docs/PRODUCTION_ARCHITECTURE.md` §4 and `mvp/docs/ARCHITECTURE.md`
§3.6. Highlights:

| Prototype collection | Production table(s) |
|---|---|
| `users`, `settings` | `users`, `user_settings`, `user_channels` |
| `clubs`, `memberships` | `clubs`, `memberships` (PK club_id+user_id), `member_no` sequence per club |
| `tournaments`, `registrations` | `tournaments`, `registrations`, `tournament_structures` (JSONB) |
| `results` | `results`, `result_places` (`invalidated` flag, `game` enum) |
| `hands` | `hands` — append-only, events JSONB, per-viewer redaction at read, **partition by month** |
| `leagues`, `achievements` | `leagues`, `league_*`, `achievements` (frozen standings JSONB) |
| `crm.*` | `crm_profiles`, `crm_events` (append-only, partitioned), `crm_tags`, `crm_notes` (+history), `crm_segments`, `automation_rules/runs`, `invite_links`, `crm_settings`, `crm_imports` |
| `notifications`, `batches`, `outbox` | `notifications`, `delivery_batches`, `outbox` (drained by channel workers) |
| `conversations`, `messages`, `blocks`, `reports`, `tickets` | one table each |
| `plans`, `invoices` | `plans`, `invoices` (+ the new billing tables in `04-PROFIT-MODULE.md`) |
| `audit` | `audit_log` — append-only |

Key points:
- **Keep prefixed string ids** (`t_`, `u_`) so seed fixtures import unchanged.
- **Tenant key `club_id` on every club-scoped row**, backed by Postgres **row-level security**
  (`SET app.club_id`) *in addition to* the application `requirePermission` checks — defense in
  depth.
- **Unique constraints** replace today's code-enforced uniqueness (one membership per
  (club,user), one registration per (tournament,user), one tag name per club).
- **Indexes / materialized views** for the analytics reports when scale demands — keep the
  definitions, change only the execution.

### 4.2 Transaction boundary

`store.mutate(fn)` (`store.ts`) is the seam — wrap each service call in
`withTx(tx => fn(tx, actor, …))`. This also fixes today's no-rollback gap. Decision for v1:
**keep the hot business DB in-process, write-through to Postgres per mutation** (closest to the
current design, lowest refactor); revisit if contention appears.

### 4.3 Redis (ElastiCache)

Table/timer state; pub/sub for the realtime channels; presence; the delayed-feed ring buffer
(moves out of `runtime.ts` `feeds`); rate limits; and the scheduler leader lock.

### 4.4 S3

Uploaded images (logos/covers — today inlined and stripped on quota), CSV imports
(`migration.ts`), and real export downloads (today export is copy-only).

## 5. Identity, auth & multi-tenancy

Replaces the demo `signIn(db, userId)` stub where `me.id` is client-trusted.

- **Auth:** email magic-link / OTP first (clubs already invite by link), optional OAuth later.
  Web = HttpOnly session cookies; **mobile = refresh tokens** (feeds `05-MOBILE.md`). Device
  binding for streamer mode and the platform console. Cognito is the managed option; a
  self-rolled JWT + magic-link service is viable given the small surface.
- **`actorId` from the verified session**, injected into every service call — the client can no
  longer assert identity.
- **Authorisation unchanged in spirit:** `permissions.ts` `can` / `requirePermission` /
  `requirePlatform` become API middleware; the 22 permissions and 5 roles carry over verbatim.
  The three architecture tests keep guarding the boundary.
- **Multi-tenancy = app checks + Postgres RLS.** Tenant isolation is the primary pen-test
  target.

## 6. Server-authoritative play (table service)

The engine moves to the server unchanged (pure TS). The contract already assumes it:

- Client sends `submitCommand(table, {seat, handNo, seq, actionId, action})`; server validates
  with `legalActions` and an idempotency key per turn.
- Server emits only **redacted** `TableView` / `HandEvent` per viewer (`redactEvent`);
  `viewOfAll` stays server-only. The client never holds the deck.
- **Turn timer becomes server-driven;** the client renders only the deadline it is sent.
- **Shuffle:** keep the CSPRNG (`crypto.getRandomValues` → Node `webcrypto`, injectable via
  `rng.ts`); store a per-hand shuffle-seed hash for audit. Not certified RNG (out of scope for
  virtual-chips v1; never claim certification).
- **Delayed spectator feed** moves to Redis streams; nothing younger than the delay (≥ 30 s
  public / ≥ 60 s streamer) is ever published; `canWatchTournament` gates it server-side.
- **Scaling:** one authoritative actor per table; route WS connections sticky by table; recover
  in-flight tournaments from the hand event log on task restart (risk item #3).

## 7. Jobs, notifications & scheduling

- **Scheduler worker** runs the `Runtime.tick` housekeeping as one leader-elected process
  (Redis lock): registration windows, start times, reminders, recurring schedules, inactivity
  alerts, retention, and scheduled data-retention erasure (today manual). Each step is already
  idempotent via dedupe keys.
- **Channel workers** drain `db.outbox` through `channels.registerAdapter` — the documented
  seam. Make `ChannelAdapter.send` **async**; wire real providers: SES (email), SNS or Twilio
  (SMS), FCM/APNs (push). Secrets in Secrets Manager, never in the client bundle. Until an
  adapter is registered, rows stay `simulated` exactly as today. Delivery records already
  separate "eligible" from "delivered" with per-channel consent, so unsubscribe handling hangs
  off that.

## 8. What stays out (preserved at every phase)

- **No real money in gameplay** — no wallet, deposits, withdrawals, wagering, payouts. Virtual
  chips only. The build-time money test stays. (The monetization in `04-PROFIT-MODULE.md` is
  B2B subscription/SaaS billing + cosmetic Diamonds — a *different* money path, gated by legal.)
- **No certified RNG / collusion detection** for v1; shuffle-seed audit hash only.
- **Multi-region** and real-money settlement seams — deferred.
