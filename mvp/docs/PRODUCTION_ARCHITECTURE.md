# Poker Club OS — production multiplayer architecture plan

Milestone A deliverable (parallel infrastructure track). The prototype runs entirely in one
browser: the engine, the "server" (`platform/*`), the scheduler (`Runtime.tick`) and the UI
share one process and one `localStorage` database. This document describes the production
shape the code was written to grow into, and the order in which to get there without a
rewrite. Nothing here is implemented as a server yet; the parts marked *exists* are the
pieces of the prototype that already have the right boundary.

## 1. Target topology

```
┌──────────────┐   HTTPS/JSON      ┌────────────────────┐    SQL     ┌────────────┐
│ Web / iOS /  │ ───────────────▶  │ API service        │ ─────────▶ │ PostgreSQL │
│ Android / PC │ ◀───────────────  │ (Node, TypeScript) │ ◀───────── │            │
│ (same React  │   WebSocket       ├────────────────────┤            └────────────┘
│  app)        │ ◀──────────────▶  │ Table service      │ ─▶ Redis (pub/sub, presence,
└──────────────┘                   │ (server-authoritative│           delayed feed, rate limits)
                                   │  engine, per-table   │
                                   │  actor)              │
                                   ├────────────────────┤
                                   │ Scheduler worker   │ ─▶ cron-like loop: registration
                                   │ (housekeeping)     │    windows, reminders, recurring
                                   └────────────────────┘    schedules, inactivity alerts
```

One React code base serves web, desktop (PWA / Electron / Tauri shell) and mobile (Capacitor
or React Native WebView first; native later). The UI already talks to the domain only through
service functions, which is the seam the API replaces.

## 2. Server-authoritative play

| Concern | Today (prototype) | Production |
|---|---|---|
| Deck, shuffle | `engine/cards.ts` seeded RNG in the browser | Table service, CSPRNG (`crypto.randomInt`), per-hand audit of the shuffle seed hash; the client never holds the deck |
| Hand state | `engine/holdem.ts` `HandState` in memory | Same module, running inside a per-table actor on the table service; one actor owns one table, processes commands sequentially |
| What a client sees | `engine/view.ts` `viewOf(table, viewerSeat)` redacts other players' hole cards | *Exists and is the contract*: the server sends only `TableView`s / redacted `HandEvent`s; `viewOfAll` is server-only |
| Player actions | `TableDriver.act()` validates with `legalActions` | `POST /tables/:id/act` or WS command, validated by the actor with the same `legalActions`; idempotency key per turn |
| Turn timer | client-driven | server-driven; the client only renders the deadline the server sent |
| Bots | `engine/bots.ts` in the browser | same code in the table service for demo tables; disabled on real-money-free "serious" tables if the club wants |
| Spectator delay | `Runtime.feeds` ring buffer, `spectate()` picks a frame ≥ delay old | *Exists as the design*: the ring buffer lives in the table service (or Redis streams), and clients subscribe to a *delayed* channel; nothing younger than the delay is ever published |

The engine is pure TypeScript with no DOM dependency, so it moves to the server unchanged.

## 3. Identity and authorisation

- **Auth**: email + magic link / OTP first (clubs invite by link anyway), optional OAuth
  later. Sessions as HttpOnly cookies for web, refresh tokens for mobile. Device binding for
  the streamer mode and the platform console.
- **Authorisation**: `platform/permissions.ts` (`can`, `requirePermission`, roles per club,
  platform admins) is already the single gate; it becomes server middleware. The rules the
  prototype enforces today keep holding: an access code never replaces club membership, a
  personal referral link never replaces approval, only tournament staff can open the
  streamer feed.
- **Multi-tenancy**: every table row carries `club_id`; row-level security in PostgreSQL
  (`SET app.club_id`) backs the application checks.

## 4. Data model (PostgreSQL)

The `DB` type in `platform/types.ts` is the schema. Each top-level collection becomes a
table (or a small set):

| Prototype collection | Tables | Notes |
|---|---|---|
| `users`, `settings` | `users`, `user_settings`, `user_channels` | settings JSONB per user; channels normalised for querying |
| `clubs`, `memberships` | `clubs`, `memberships` (PK club_id+user_id) | `member_no` sequence per club |
| `tournaments` (+`registrations`) | `tournaments`, `registrations`, `tournament_structures` (JSONB) | `schedule_id` FK to `recurring_schedules` |
| `results` | `results`, `result_places` | `invalidated` flag, `game` enum |
| `hands` | `hands` (append-only; events JSONB, per-viewer redaction at read time) | partition by month |
| `leagues`, `achievements` | `leagues`, `league_tournaments`, `league_members`, `league_rules` (versioned), `achievements` | frozen standings stored as JSONB snapshot on completion |
| `crm.*` | `crm_profiles`, `crm_events` (append-only), `crm_tags`, `crm_notes` (+history), `crm_segments`, `automation_rules`, `automation_runs`, `invite_links`, `crm_settings`, `crm_imports` | events partitioned by month; retention job already exists (`applyRetention`) |
| `reminders`, `templates`, `schedules` | `personal_reminders`, `tournament_templates`, `recurring_schedules` | |
| `integrity` | `integrity_cases`, `integrity_notes` | |
| `notifications`, `batches`, `outbox` | `notifications`, `delivery_batches`, `outbox` | outbox drained by channel workers |
| `audit` | `audit_log` (append-only) | |
| `conversations`, `messages`, `blocks`, `reports`, `tickets`, `invoices`, `plans` | one table each | |

Ids stay prefixed strings (`t_…`, `u_…`) so prototype fixtures import unchanged.

## 5. API boundary

Every exported function in `platform/api.ts`, `crm.ts`, `competition.ts`, `retention.ts`,
`calendar.ts`, `scheduling.ts`, `migration.ts`, `integrity.ts`, `messaging.ts`,
`analytics.ts` has the shape `fn(db, actorId, …args)`. That is the REST/RPC contract:

- `actorId` comes from the session, never the request body.
- `db` becomes a transaction handle (`withTx(async (tx) => fn(tx, actor, …))`).
- Read models that the UI calls directly today (`selectors.ts`, `analytics.compute`) stay
  server-side; the architecture test in `tests/crm.test.ts` already fails any screen that
  reaches past the guarded functions, which keeps the client ready for the switch.
- Realtime: the client subscribes to `club:{id}`, `tournament:{id}`, `table:{id}:{seat|public|delayed}`
  channels; the server pushes the same `TableView` / `HandEvent` payloads the prototype's
  `TableDriver` emits.

A thin `src/platform/client.ts` (not yet written) will mirror the function signatures and
call the API, so screens change imports, not logic.

## 6. Scheduler and background work

`Runtime.tick()` and `automation.tick()` are the worker. In production they run as a single
scheduler process (leader-elected, Redis lock) doing, in order: registration windows, start
times, reminders (club rules and personal), recurring schedules (`runSchedules`), inactivity
alerts, housekeeping. Each step is idempotent today (dedupe keys, `startAt` identity for
occurrences), which is what a retrying worker needs.

Channel workers drain `outbox` through registered adapters (`channels.ts`
`registerAdapter`): email (SES/Postmark), SMS/WhatsApp (Twilio/Meta), push (FCM/APNs). Provider
secrets live in the worker's environment, never in the client bundle. Until an adapter is
registered, rows stay `simulated`, exactly as in the prototype.

## 7. Gradual migration path

1. **Extract the API** — wrap `platform/*` in an HTTP server (Fastify) with an in-memory `DB`
   loaded from the seed. The web client switches to `client.ts`. No behaviour change, now
   two processes. (Tests: existing unit suite runs unchanged against the service layer.)
2. **Persist** — replace the in-memory `DB` with PostgreSQL via a repository layer; keep
   `types.ts` as the source of truth; migrate fixtures.
3. **Move the tables** — run `TournamentLive` actors in a table service; clients get views
   over WebSocket; `TableDriver` becomes a WS client. The delayed feed moves with it.
4. **Auth and tenancy** — magic links, sessions, RLS. Demo identities become real accounts.
5. **Workers** — scheduler and channel workers as separate processes; register real adapters.
6. **Mobile shells** — PWA first, then store builds. Same bundle.

Each step keeps the previous one working, matching the brief's "gradual migration" rule.

## 8. What stays out

No real-money deposits, withdrawals, wagering or payouts, at any step. Demo points remain
the only currency. If a club runs for money outside the product, the product neither knows nor
settles it.
