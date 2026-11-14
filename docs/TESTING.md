# Testing and CI

The standalone Python ETL, Express scraper and MongoDB staging are retired from
the active pipeline. Their component tests remain as legacy regression coverage,
not deployment requirements. Current ingestion integration/E2E journeys use the
Supabase Edge Functions, private Storage bucket and PostgreSQL described in the
[Functions guide](../supabase/functions/README.md).

## Testing strategy

**Application type:** mixed HTTP APIs and browser-rendered HTML/JavaScript.
**Primary validation stack:** existing Vitest/Node:test and Python unittest,
Deno handler tests, PGlite schema integration, real disposable Supabase
PostgreSQL 17/Storage API journeys, and Chromium Playwright browser journeys.

**Vertical** means a complete business flow through actual HTTP boundaries and
persistence. **Horizontal** means contracts shared across services: gateway
authentication, verified identity, roles, JSON/BIGINT encoding, receipts,
leases, private data access, and failure continuation.

### Critical journeys and acceptance

| Journey | API coverage | Browser coverage | Required result |
|---|---|---|---|
| Register, authenticate, revoke, delete | `tests/api/accounts.test.cjs` | `tests/browser/accounts.spec.cjs` | Viewer persisted; spoofed admin denied; revoked/deleted sessions unusable; account removed |
| Guest suggestion and admin publication | `tests/api/moderation.test.cjs` | `tests/browser/moderation.spec.cjs` | Pending stays unpublished; authenticated review atomically publishes once; verified reviewer persisted; listing readable |
| Search, filter, save | Listing contract/component suites | `tests/browser/listings.spec.cjs` | Real persisted listing rendered; filter works; device bookmark survives reload and can be removed |
| Ingestion and dead-letter continuation | `tests/api/pipeline.test.cjs` | `tests/browser/pipeline.spec.cjs` | Expired 2011 lead discarded; one provider 503 retried; two events committed; bad original retained privately; run completes with warning |
| Receipt and access contracts | `tests/api/receipts.test.cjs` | Admin-cookie paths in browser journeys | Real postgres.js numeric-ID receipt; exact replay without another AI request/write; altered cursor/expired lease rejected; browser DB roles denied |

Component suites additionally cover Stop/Continue/Clear/Next, bounded retry
exhaustion, rollback, unsafe BIGINTs, directory authentication, mail, Storage
integrity, pagination, and API error contracts. They are not relabeled E2E.

### Legacy test assets

- Source: discovered repository tests; no user-supplied test files.
- Decision: **reuse-with-edits**. Existing Vitest, Node:test, Python unittest,
  Deno, and PGlite suites remain authoritative and are now included in CI.
- No existing real browser suite was found; browser journeys are new.
- Updated the Storage-error regression to check the current classified HTTP 503
  contract while retaining explicit legacy HTTP 502 coverage.

## Commands

Install root and component dependencies with committed lockfiles:

```text
npm ci
npm ci --prefix gateway
npm ci --prefix jwt-service
npm ci --prefix services/hackathon-service
npm ci --prefix scraper
npm ci --prefix hackscout-gateway
```

| Command | Scope / prerequisite |
|---|---|
| `npm test` | Canonical non-browser suite: all Node components, harness guards/providers, SQL, Edge |
| `npm run test:node` | Node component suites plus runtime-harness tests |
| `npm run test:sql` | PGlite research/control/staging schema tests; no Docker |
| `npm run test:edge` | Pinned Deno handler checks and all JS/TS Edge tests; no Docker |
| `npm run test:python` | Both Python suites; uses each component's existing `.venv`, or `PYTHON`/`python`; source copied without environment files |
| `npm run typecheck` / `npm run build` | All four compiled Node services |
| `npm run check:code-size` | Every code file, including tests and workflow YAML, at most 200 lines |
| `npm run test:e2e:api` | Actual HTTP stack; requires built services and fresh disposable Supabase |
| `npm run test:e2e:browser` | CI-only Chromium journeys; explicitly refuses execution outside GitHub Actions |
| `npm run test:all` | Every tier; requires Python dependencies, Docker/Supabase, and CI browser authorization |

Python dependencies are installed separately using each component's
`requirements.txt`; see [local setup](./LOCAL-RUN.md). CI uses separate Python
3.12 environments, preserving the two services' different dependency pins.
Browser installation and execution are not authorized locally. Do not bypass
that restriction by setting GitHub Actions environment variables.

### Disposable API runtime

Requires functional Docker, Supabase CLI **3.1.0**, Node 24, and the dependencies
above. Deno 2.9.6 is installed by the root lockfile; no global Deno is needed.
After `npm run build`, start only this test project:

```text
supabase start --workdir tests/runtime --exclude realtime,studio,imgproxy,postgres-meta,logflare,vector,edge-runtime,supavisor,mailpit
npm run test:e2e:api
supabase stop --workdir tests/runtime --no-backup
```

Run the stop command even after failure. CLI startup/status output contains
disposable credentials: do not publish it. Do not run these commands against the
root Supabase project. Do not use global Docker prune/stop commands.

- Project ID: `hackscout-ci`; API 54328, database 54329, shadow database 54330.
- Tests connect to app ports 43100-43106 over loopback. Occupied ports fail startup; no unrelated
  processes or containers are stopped.
- A nonempty control schema is refused; stop with `--no-backup` and restart
  between API and browser runs. Schema/migration setup is transactional.
- The fixture applies the four split research migrations and application/control
  migrations from `20261106090000` onward in order, then canonical `supabase/auth/001_auth.sql`.
  Historical pre-research DDL and retired research-account tables are excluded.
  CLI automatic migrations/seeding are disabled.
- An actual private Storage bucket is created. Node services run built code in
  temporary environment-free directories, linked to installed dependencies.
  Actual Edge handlers run with Deno. Temporary service copies and owned child
  processes are cleaned up on completion/signals.
- Each journey uses synthetic accounts/UUIDs; record/account cleanup runs in
  `finally`. Staged originals and completed audit records deliberately remain
  for assertions until this disposable project is destroyed.
- No hosted project URL/key, deployment secret, local application environment
  file, Devpost account, or paid AI provider is used.

## Dependency boundaries and known gaps

| Boundary | Test implementation | Deliberate gap |
|---|---|---|
| Gateway, JWT, Hackathon Service, frontend, Edge | Actual services over loopback HTTP; actual `pg` and postgres.js drivers | Hosted Vercel/Edge routing and production connection pooling not exercised |
| Database and staging | Real local Supabase PostgreSQL and Storage in Docker | Hosted Storage availability and production credentials not exercised |
| Devpost, evidence DNS/pages, AI | Deterministic local HTTP provider; exactly one transient 503 and one malformed completion | Provider behavior, live data, paid AI quality, and public DNS not certified |
| TLS | Test-scoped import map wraps the same postgres.js 3.4.7 with loopback-only plaintext; synthetic HTTPS Storage origin maps to local HTTP | Certificate verification not exercised; deployed TLS code/config is unchanged |
| Scheduling | Real pg_cron registration runs harmless `SELECT 1`; tests drive ticks over authenticated gateway HTTP | Vault, pg_net delivery and wall-clock cron dispatch require separate deployment checks |
| LDAP and SMTP | Existing component protocol/adapter tests, with mocked directory/mail dependencies | No directory server or SMTP delivery in these E2E journeys |

Fallbacks are independent: without Docker, component/PGlite/Edge tests remain
available, but **real infrastructure API journeys remain unverified**, not
silently skipped or rebranded. Browser execution is separately restricted to CI,
regardless of local Docker/Node availability.

## GitHub Actions and evidence

[Project CI](../.github/workflows/gateway-ci.yml) replaces the old path-filtered,
three-service workflow. Every push, PR and manual dispatch runs Node 22/24 for
five components, Python 3.12 for both Python services, SQL and Edge checks.
[Reusable runtime CI](../.github/workflows/runtime-ci.yml) then runs API journeys
and, only after they pass, browser journeys on a separate fresh fixture.

Installs use `npm ci`; permissions are read-only; obsolete runs are cancelled.
All tiers have timeouts. Test failures, cancellations and skipped prerequisites
fail the final `required` job. No deployment occurs. Configure branch protection
to require this job and the existing [code-size workflow](../.github/workflows/code-size.yml).

Runtime artifacts are retained for seven days: API/browser JUnit, sanitized
service logs, HTML browser reports, and failed-test screenshots/traces.
Only synthetic test identities are used; traces can contain disposable session
tokens. CLI status/startup output and credential state are never uploaded.

### Local implementation verification

Node, Python, SQL, Edge, build/type checks and the code-size gate were executed
locally. Docker is installed but its daemon is unavailable, so real-container
journeys are **unverified locally**. Playwright was **not run locally**, by user
instruction. A successful hosted workflow run is still required before treating
the new runtime tiers as green; creating these files is not evidence of a CI pass.
