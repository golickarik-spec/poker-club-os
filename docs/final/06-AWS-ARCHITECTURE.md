# 06 — AWS Architecture

> **Audience: engineering.** The target AWS architecture: single region, multi-AZ, built for a
> **small SaaS v1** (hundreds of concurrent players, dozens of clubs) and able to scale. It
> runs the services from `03-ARCHITECTURE-AND-SERVICES.md`. Deployment automation is in
> `07-CICD-PIPELINE.md`.

---

## 1. Topology (single region, multi-AZ)

```
                         Route 53  ─┐
                                    ▼
              CloudFront (SPA static assets, S3 origin)
                                    │
  Browser / native WebView ── HTTPS/JSON & WSS ──► ALB (HTTP + WebSocket listeners)
                                    │
        ┌───────────────┬───────────┴───────────┬──────────────────┐
        ▼               ▼                        ▼                  ▼
  ECS Fargate      ECS Fargate              ECS Fargate        ECS Fargate
  API service      Table service            Scheduler          Channel workers
  (Fastify,        (WS, per-table actor,    (leader-elected,   (drain outbox →
   stateless,       engine + Runtime,        cron-like loop)    SES/SNS/FCM)
   autoscaled,      owned 1 task/table       single active      SQS-driven
   + billing)       via Redis registry)
        │               │                        │                  │
        └───────┬───────┴──────────┬─────────────┴──────────────────┘
                ▼                   ▼
        RDS PostgreSQL        ElastiCache Redis            S3 (uploads: logos,
        (Multi-AZ, business   (pub/sub, presence,          covers, CSV imports,
         data + append-only   table/timer state,           export downloads)
         hands & audit)       delayed-feed streams,
                              rate limits, scheduler lock)
```

**The four services + client** are defined in `03` §2. **Billing is part of the API service**
(decision #4) — no separate billing service.

## 2. Compute — ECS Fargate

Containers (not Lambda) because the **Table service is stateful** (long-lived WebSocket
connections, one authoritative actor per table, server-driven timers). Fargate removes
server management while supporting that model.

| Service | Fargate shape | Scaling |
|---|---|---|
| **API service** | Stateless tasks behind the ALB | Autoscale on CPU / request count |
| **Table service** | Stateful tasks; **each table owned by one task via a Redis `table_id`→task registry + a WS router** (ALB cookie stickiness is per-client, not per-table — insufficient; see `03` §6) | Scale by number of running tables; consistent-hash ownership; recover from the hand event log on task restart |
| **Scheduler worker** | **1 active task**, Redis leader lock | Single active (standby acceptable) |
| **Channel workers** | SQS consumers | Autoscale on SQS queue depth |

## 3. Data stores

### 3.1 RDS PostgreSQL (Multi-AZ)

- Business data; the `DB` shape maps almost one-to-one to tables (`03` §4). **Postgres is the
  single source of truth** (`03` §4.2); the API tier is stateless and Redis is cache/coordination
  only — never a second authoritative copy.
- **Row-level security** (`SET app.club_id`) + application `requirePermission` = defense in
  depth; tenant isolation is the primary pen-test target.
- Append-only, month-partitioned `hands`, `audit_log`, `crm_events`.
- Unique constraints replace code-enforced uniqueness; indexes / materialized views for
  analytics when scale demands.
- Automated backups + point-in-time recovery; Multi-AZ failover. **Periodically rehearse an
  actual restore** into a scratch instance and assert row counts / a smoke query — "backups exist"
  is not "restore works."

### 3.2 ElastiCache Redis

Table/timer state; pub/sub for `club:{id}` / `tournament:{id}` / `table:{id}:{seat|public|delayed}`;
presence; the delayed-feed ring buffer (moves out of `runtime.ts` `feeds`); rate limits; and
the scheduler leader lock.

### 3.3 S3

Uploaded images (logos/covers — today inlined and stripped on quota); CSV imports
(`migration.ts`); real export downloads (today copy-only). Versioning on.

## 4. Edge & networking

- **CloudFront** serves the SPA from S3; **WAF** on CloudFront/ALB for rate limiting and edge
  rules. **Route 53** for DNS; **ACM** for TLS.
- **VPC**: public subnets (ALB, NAT), private subnets (Fargate, RDS, Redis). Least-privilege
  **security groups**. **ALB** with both HTTP and **WebSocket** listeners.

## 5. Identity, secrets, queues, registry

- **Cognito** (managed identity) *or* a self-rolled magic-link / JWT service — the surface is
  small enough for either (`03` §5). Web = HttpOnly cookies; mobile = refresh tokens.
- **Secrets Manager** — DB credentials, payment-provider keys, channel-provider keys. **No
  provider secrets in the client bundle, ever.**
- **SQS** — the outbox → channel-workers queue, and any job queue.
- **ECR** — container images for the four services.

## 6. Observability

- **CloudWatch** logs/metrics/alarms; **X-Ray** tracing; structured logs.
- Real metrics behind the existing **Health screen** (today simulated).

## 7. Configuration

Inject `API_BASE_URL` / WS URL **at build time** (today `build.mjs` only defines `NODE_ENV`
and `__DESIGN__`). Everything else (DB, Redis, provider keys) comes from Secrets Manager /
environment at runtime on the server side.

## 8. Infrastructure as Code

**AWS CDK (TypeScript)** in a new `infra/` workspace so infra shares the repo's language and
types. CDK stacks provision: VPC, ECS cluster + 4 services, RDS, ElastiCache, S3 buckets, SQS,
Cognito/secrets, CloudFront + WAF, ACM, and CloudWatch alarms. Deployed by the pipeline
(`07-CICD-PIPELINE.md`).

## 9. Backups / DR

RDS automated backups + PITR; S3 versioning; Multi-AZ failover for RDS and the ALB/Fargate
tier. **Single region for v1**; multi-region deferred.

## 10. Scale posture (v1 → later)

v1 targets a **small SaaS**: single region, multi-AZ, managed RDS + a single ElastiCache
cluster, hundreds of concurrent players and dozens of clubs. The scale levers, when needed:
API autoscaling (already stateless), more Table-service tasks with sharding by `table_id`,
analytics indexes/materialized views (keep the definitions, change the execution), read
replicas, and eventually multi-region. None require re-architecting the service split.

## 11. Cost note

Running costs are the client's ongoing expense, roughly **$500–$1,000/mo** for the v1 footprint
(Fargate, RDS Multi-AZ, ElastiCache, ALB, NAT, CloudFront, S3) per `mvp/docs/BILLING_ESTIMATE.md`.
This is separate from build fees and from the payment-processing fees in `04-PROFIT-MODULE.md`.
