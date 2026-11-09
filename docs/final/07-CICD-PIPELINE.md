# 07 — CI/CD Pipeline

> **Audience: engineering.** The build/test/deploy pipeline. This is **greenfield** — the repo
> has **no** CI/CD, Dockerfiles, or IaC today. This document specifies what to build, grounded
> in the real scripts and commands that exist. Deploy targets are the AWS services in
> `06-AWS-ARCHITECTURE.md`.

---

## 1. Current state (what CI has to work with)

| Thing | Today |
|---|---|
| Package | `poker-club-os` 0.4.0, `"type": "module"` (ESM), **private** |
| Node/engine | **No `engines` field** — must pin |
| Lockfile | **None present** — must add (`package-lock.json`) for reproducible installs |
| `npm run build` | `node scripts/build.mjs` → single inlined `dist/index.html` (+ `artifact.html`); esbuild + Tailwind v4; `--design=v2\|v3` (default v3); fonts from Google CDN at runtime |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` (TypeScript 6.0.3; type-check only, esbuild does the bundling) |
| `npm test` | `node --import tsx --test tests/*.test.ts` — **220 unit** across 17 files (CRM suite alone ~2.5 min) |
| `npm run e2e` | `node scripts/e2e.mjs` — Playwright **headless Chromium** against the built `file://.../dist/index.html`; **165 checks**, journeys A–F + S; exit 1 on any failure or browser runtime error |
| i18n check | `tests/i18n.test.ts` (+ a standalone `scripts/i18n-check.mjs` not wired to npm) |
| CI / Docker / IaC | **None** |

The pipeline is built in Phase 6 (`08-ROADMAP.md`) but its **PR-gate half can and should exist
from day one** against the current prototype — it protects the service layer through the entire
migration.

> **Project root.** The prototype now lives in **`mvp/`** (the repo root holds only `mvp/` and
> `docs/final/`). Every `npm` command and every `scripts/…`, `tests/…`, `dist/…`,
> `package.json`, and `tsconfig.json` path in this document is relative to `mvp/`; the CI jobs
> below therefore set `working-directory: mvp` (and point the dependency cache / artifact paths
> at `mvp/…`).

## 2. Prerequisites to add first

1. **Commit a lockfile** (`npm install` then commit `package-lock.json`) so CI uses
   `npm ci`.
2. **Pin Node** — add `"engines": { "node": ">=20" }` and an `.nvmrc` (`20`). The target
   runtime is Node 20 (also the container base).
3. **Wire the i18n check** to an npm script (`"i18n": "node scripts/i18n-check.mjs"`) so CI can
   call it by name.
4. Decide the CI provider — **GitHub Actions** (assumed here; CodePipeline is the AWS-native
   alternative). Use **GitHub OIDC → AWS IAM role** for deploys (no long-lived AWS keys in CI).

## 3. Pipeline shape

Two triggers, two jobsets:

```
PR / push to any branch          →  QUALITY GATE  (fast, no AWS)
  typecheck → unit tests → build → e2e → i18n

push to main / tag v*            →  DELIVERY
  quality gate → build images → push to ECR → cdk deploy staging
                → smoke → manual approval → cdk deploy prod (blue/green)
```

### 3.1 Quality gate (every PR)

Runs entirely in CI, no AWS needed — this is what guards the service layer during the whole
migration (the 220 unit tests must stay green through Phases 1–2 as the regression net).

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  quality:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: mvp }       # package.json lives in mvp/
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: mvp/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test                       # 220 unit (node:test + tsx)
      - run: npm run i18n                    # EN/HE key parity
      - run: npx playwright install --with-deps chromium
      - run: npm run build                   # emits dist/
      - run: npm run e2e                     # 165 checks, headless Chromium
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: e2e-screenshots, path: mvp/scratch/e2e/ }   # action path is repo-root-relative
```

Notes:
- The CRM unit suite is slow (~2.5 min); split `npm test` into sharded matrix jobs if wall-clock
  matters (the test command already globs `tests/*.test.ts` — shard by file list).
- e2e needs a build first (it loads the built file over `file://`); keep the `build` step
  immediately before it.
- Add a **money-code guard** check (the build-time test that fails on money paths) to the gate so
  the "no real-money gameplay" rule can never regress. In production this guard is **rescoped to
  gameplay code** and the billing module lives in its own `src/platform/billing/` dir excluded
  from it (`03` §8); the gate also enforces that gameplay code never imports billing.

### 3.2 Delivery (main / tags)

Once the services are extracted (Phases 1–6), the delivery job builds and ships them.

```yaml
# .github/workflows/deploy.yml  (sketch)
name: Deploy
on:
  push:
    branches: [main]
    tags: ['v*']
permissions: { id-token: write, contents: read }   # OIDC
jobs:
  images:
    needs: quality            # reuse the gate
    runs-on: ubuntu-latest
    strategy:
      matrix: { service: [api, table, scheduler, channels] }
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE }}, aws-region: <region> }
      - uses: aws-actions/amazon-ecr-login@v2
      - run: docker build -f services/${{ matrix.service }}/Dockerfile -t $ECR/${{ matrix.service }}:$GITHUB_SHA .
      - run: docker push $ECR/${{ matrix.service }}:$GITHUB_SHA
  client:
    needs: quality
    steps: [ build static assets, aws s3 sync dist/ s3://<bucket>, cloudfront create-invalidation ]
  deploy-staging:
    needs: [images, client]
    steps: [ npx cdk deploy '*' --require-approval never --context env=staging ]
  smoke-staging:
    needs: deploy-staging
    steps: [ run a subset of e2e / health checks against the staging URL ]
  deploy-prod:
    needs: smoke-staging
    environment: production        # GitHub "environment" = manual approval gate
    steps: [ npx cdk deploy '*' --context env=prod ]
```

## 4. Containers

One `Dockerfile` per server service under `services/<name>/` (Node 20 base, multi-stage:
`npm ci` → build → slim runtime image). The **client is not containerized** — it is static
assets synced to S3 and served by CloudFront.

- `api` — Fastify app wrapping `src/platform/*` (incl. billing).
- `table` — WS server wrapping `src/engine/*` + `runtime.ts`.
- `scheduler` — headless loop (the former `Runtime.tick`), Redis leader lock.
- `channels` — SQS consumers draining the outbox.

Images → ECR, tagged by commit SHA; ECS task definitions reference the SHA tag.

## 5. Deploy strategy on ECS

- **Staging → prod** with a manual approval gate (GitHub `environment: production`).
- **Blue/green or rolling** on ECS (CodeDeploy blue/green for the API; rolling acceptable for
  stateless services). The **Table service** needs care on deploy — drain WS connections and
  recover running tables from the hand event log (risk item #3 in `08-ROADMAP.md`); prefer a
  rolling deploy that lets in-flight tables finish.
- **DB migrations** run as a one-off ECS task (or a migration step) before the API rolls,
  gated so a failed migration blocks the deploy.
- **IaC**: `npx cdk deploy` provisions/updates everything in `06-AWS-ARCHITECTURE.md` §8;
  `cdk diff` runs in the PR gate for infra changes so reviewers see the plan.

## 6. Secrets & config

- **AWS access** via GitHub OIDC → a least-privilege deploy role (no static keys).
- **App/provider secrets** (DB, Redis, payment + channel provider keys) live in **Secrets
  Manager**, injected into ECS tasks at runtime — never in CI logs, never in the client bundle.
- **Build-time config** (`API_BASE_URL`, WS URL) injected into the client build per environment.

## 7. Mobile CI (ties to `05-MOBILE.md`)

A separate workflow for the native apps:

- Build the static bundle → `npx cap sync` → build signed `.ipa` / `.aab` via **Fastlane /
  Codemagic / EAS**.
- Distribute to **TestFlight** and **Play internal testing**.
- Store metadata, screenshots, and privacy forms as tracked assets.
- The **social-casino / age-gating review** is an external gate (not automatable) — see
  `05-MOBILE.md` §5.

## 8. Branch & release strategy

- Trunk-based: PRs into `main`, quality gate required to merge.
- `main` auto-deploys to **staging**.
- **Tags `v*`** (or a manual approval on the prod environment) promote a staging build to
  **prod**.
- Keep the `--design=v2|v3` switch available; default `v3`. The design variant is a build arg,
  not a separate pipeline.

## 9. What "done" looks like per phase

CI/CD is not all-or-nothing. Minimum useful increments, aligned with `08-ROADMAP.md`:

1. **Now** — the quality gate (§3.1) against the prototype.
2. **Phase 1–2** — add `cdk diff` + a staging deploy of the API + RDS.
3. **Phase 3–5** — add the table/scheduler/channel images and their deploys.
4. **Phase 6** — full blue/green prod delivery, smoke tests, DB-migration gating, observability
   alarms wired.
5. **Phase 7** — the mobile CI workflow and store submission.
