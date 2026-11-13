# Gateway-only Supabase scraper and ETL

Two Deno Edge Functions replace the scraper and Python ETL services:

- `scraper`: Devpost mapping, AI pagination, private Storage persistence/cache/reset,
  pipeline control and one durable pipeline step per tick.
- `etl`: Storage imports, JSON/JSONL/CSV file imports, AI website enrichment,
  validation, and transactional creation of events, children and team members.

Every request, including health checks and OPTIONS, requires both the server-only
`GATEWAY_INTERNAL_SECRET` and `x-gateway-caller: team-2-gateway`. Browser bearer
tokens, Supabase public keys, origin headers, and caller-name spoofing do not
grant access. `verify_jwt=false` delegates authentication to this mandatory
application guard; it does **not** make either handler unauthenticated.
The URLs remain network-reachable. This is gateway-credential authentication,
not private-network isolation. Never send the shared secret to browser code.

## Flow

```text
Admin -> frontend -> main gateway -> scraper pipeline API -> PostgreSQL job
pg_cron -> pg_net -> main gateway -> scraper pipeline tick
tick -> one staging Storage reset / PostgreSQL reset / scrape page / ETL record
ETL step -> main gateway -> etl function -> private Storage + PostgreSQL
```

No background promise or function-to-function HTTP bypass is used. A tick every
1 second advances at most one step. A leased step is not executed again by
overlapping ticks; steps taking longer than 1 second still finish at their own pace.
The queue, lease, cursor, progress, encrypted keys and
operation ledger live in the private `pipeline_control` schema. The admin
gateway route avoids a second frontend/backend/gateway round trip.

## Deployment

1. Stop/disable the old Vercel worker cron and any local scheduler using this
   database. Wait for old runs to finish or investigate/cancel them; do not clear
   an uncertain-operation interlock blindly. The old worker must not keep
   reconciling jobs after cutover.
2. Apply `../migrations/20261112180000_edge_pipeline.sql` using a database owner.
   It supports the existing control schema and adds executor/lease columns.
   It does not reset application data, enable automatic runs, or register cron.
   Supabase `pg_cron`, `pg_net` and Vault must be available.
   Also apply `../migrations/20261112200000_pipeline_cancel.sql` before deploying
   the admin stop control. It adds cancellation without changing existing jobs.
   Apply `../migrations/20261112210000_pipeline_restart.sql` for Reset & restart.
   Apply `../migrations/20261113035500_pipeline_ack.sql` before deploying the
   scraper's atomic operation acknowledgement. It serializes acknowledgement
   with cancellation. A stopped run's temporary blocker is cleared only when
   every admitted operation is confirmed; the run stays cancelled and its key
   stays erased. Missing acknowledgements still require investigation. This
   migration does not clear historical blockers or start/reset a run.
   Apply `../migrations/20261113130000_pipeline_resume.sql` before deploying
   Continue. `POST /pipeline/continue` requires a verified administrator, the
   displayed `jobId`, and a fresh `apiKey`. It requeues the same latest failed or
   stopped Storage run, keeping its original timestamp, cursor, progress, data
   and operation ledger. Completed acknowledgements replay without repeating
   their side effects; no new cleanup is introduced, but a paused cleanup
   finishes its remaining batches. Previous failure details remain in
   `resumeHistory`, and the replacement key has a new 24-hour encrypted lifetime.
   Continue rejects outstanding operations, blockers, leases, obsolete/legacy
   checkpoints, and failed ETL records that would otherwise be skipped.
   It does not change automatic scheduling.
   Apply `../migrations/20261113140000_pipeline_clear.sql` before deploying
   **Clear all**. `POST /pipeline/clear` requires a verified administrator,
   `{jobId, confirmation: "CLEAR ALL"}`; `jobId` is the latest displayed run ID,
   or `null` when no history exists. It queues durable cleanup without an AI key:
   bounded Storage reset batches, then the existing PostgreSQL event reset.
   Only after both acknowledgements does it atomically remove all pipeline jobs
   and operation records and reset automatic scheduling to disabled. Scraping
   and ETL never start; accounts, submissions/reviews, categories and team
   members survive. The worker cron stays active. Stop active runs first;
   blockers, leases and unconfirmed operations anywhere in history prevent
   clearing. A failed cleanup retains history; after inspecting its outcome,
   use Clear all again rather than Continue. Deploying this migration alone
   neither queues cleanup nor deletes records.
3. Configure both functions' server secrets using `.env.example` as the inventory.
   Set `AUTH_GATEWAY_URL` to the HTTPS origin of the deployed **main gateway**.
   The scraper requires this setting to send ETL imports through the gateway.
   Local environment files and the cron dispatcher's Vault URL do not configure
   this Edge Function setting. For example:

   ```text
   supabase secrets set AUTH_GATEWAY_URL=https://YOUR-MAIN-GATEWAY --project-ref PROJECT
   ```

   Setting a hosted secret does not require redeploying the function. Automatic
   runs additionally require `AI_API_KEY`, configured privately in Supabase;
   a key supplied for a manual run does not enable automatic scheduling.
   Use a PostgreSQL transaction-pooler URL and a role with access to the private
   control schema and research tables. Connections disable prepared statements
   and require verified TLS; supply the official project CA as
   `EDGE_DATABASE_CA` if necessary. Keep `pipeline_control` unexposed to PostgREST.
   In Supabase Dashboard -> Storage, create a **private** bucket named
   `hackscout-staging`. Both functions use `STAGING_STORAGE_BUCKET` (that default)
   and `STAGING_STORAGE_PREFIX` (default `hackscout/raw`).
   Hosted functions receive `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   automatically; supply these privately for local runs. Do not send the
   service-role key to the browser or replace it with a public key.
   MongoDB secrets and Atlas networking are no longer required by Edge functions.
   Existing MongoDB data is neither migrated nor deleted. The standalone
   Node scraper and Python ETL still use MongoDB and are not changed here.
   Storage failures log stable diagnostic codes, never credentials or raw bodies.
   The gateway's internal allowlist does not expose the cache route.
   A timeout does not prove a pending operation stopped.
4. Generate `PIPELINE_KEY_ENCRYPTION_KEY` as a random 32-byte base64 value.
   Reuse the old encryption key only when intentionally preserving old encrypted
   jobs, and never rotate while a run is active. Configure secrets through the
   Supabase Dashboard or an ignored env file; never commit them.
5. From the repository root, deploy with the Supabase CLI:

   ```text
   supabase functions deploy scraper --no-verify-jwt
   supabase functions deploy etl --no-verify-jwt
   ```

   The repository's `supabase/config.toml` also sets `verify_jwt=false` for
   both functions. Supabase's JWT gate must be disabled because gateway sessions
   are not Supabase-issued JWTs; the function handlers still require the gateway
   caller and shared secret. A platform 401 such as `UNAUTHORIZED_NO_AUTH_HEADER`
   indicates this gate is still enabled. Use `--profile YOUR_PROFILE` when
   deploying with a named Supabase CLI account.

6. Configure the **main gateway**, then redeploy it:

   ```text
   SCRAPER_SERVICE_URL=https://PROJECT.supabase.co/functions/v1/scraper
   ETL_SERVICE_URL=https://PROJECT.supabase.co/functions/v1/etl
   PIPELINE_SERVICE_URL=https://PROJECT.supabase.co/functions/v1/scraper
   ```

   The gateway preserves these URL prefixes and the existing browser API paths.
   With `PIPELINE_SERVICE_URL` set, administrator pipeline controls go directly to
   the protected scraper function rather than the old backend worker.
   Set the gateway function's maximum duration to at least 130 seconds.
   For a backend-only integration, `PIPELINE_WORKER_URL` can instead point to
   `https://GATEWAY/api/internal/pipeline-worker`; never point it directly to
   Supabase if all traffic must traverse the gateway.
7. In Supabase Vault create/update `hackscout_gateway_url` (HTTPS gateway origin)
   and `hackscout_gateway_secret` (matching server-only gateway credential).
   Use the Dashboard so secrets do not enter shell history or migration files.
   Vault credentials protect the scheduled request to the gateway. Privileged
   database roles may observe outgoing credentials in pg_net's request queue;
   do not grant untrusted database-login roles access to it.
8. Verify authenticated health and status through the gateway and confirm direct
   function calls without gateway credentials return 403. Then register:

   ```sql
   SELECT cron.schedule('hackscout-edge-tick','1 second',
     'SELECT pipeline_control.dispatch_edge_tick()');
   ```

   The tick is required even for manual queued runs. Scheduling frequency
   defaults to off for a new schema; existing persisted settings are preserved.
   Review/disable an existing automatic schedule before registering the tick.

   For an existing worker, change only its cadence without re-enabling a paused job:

   ```sql
   SELECT cron.alter_job(jobid, schedule := '1 second')
   FROM cron.job WHERE jobname = 'hackscout-edge-tick';
   ```

   This requires pg_cron 1.5 or later. One-second ticks send 60 requests per
   minute, including while idle: 60 times the dispatch requests of minute ticks.

No deployment or destructive run is implicit in these steps. An actual manual
or automatic pipeline still permanently resets its Storage staging records and event listings.
Accounts, suggestions/review history, categories, and team members are preserved.

### Queued runs and stopping

The timer includes queue time. A run waiting for a cron tick is not actively
deleting data. New runs require an active cron job named `hackscout-edge-tick`;
the admin schedule panel reports when it is missing.
An idle pipeline with automatic runs disabled reports a stopped worker as a
neutral state, not an error. Missing-worker warnings remain for queued/running
jobs or enabled automatic schedules; actual schedule errors remain visible.

The admin UI preserves the displayed run and resumes status polling after a
rejected start request. If another run is active, polling enables its Stop
control. Stop remains visible but disabled without a queued/running run;
stopping does not clear uncertainty interlocks.

Check the worker cron with:

```sql
SELECT jobname,schedule,active FROM cron.job WHERE jobname='hackscout-edge-tick';
```

Registering or re-enabling the tick will advance any existing queued run,
including its destructive reset. Stop an unwanted run first, then configure the
worker. The admin **Stop pipeline** button requires an administrator, targets
the displayed job ID, disables automatic runs, and erases that job's encrypted
key. It prevents further operation admission and stale progress updates.
It cannot forcibly interrupt an already-running remote request or undo changes.
If an operation started without acknowledgement, stopping retains the infinite
restart interlock until an operator verifies that the remote operation ended.
No new cancellation status is added to the database constraint: cancelled jobs
are stored as `failed` with `cancelled: true` in their public progress.

Storage failures return stable `STORAGE_*` codes and targeted instructions for
missing configuration/buckets, public buckets, authentication, permissions,
connectivity, timeouts and unconfirmed mutations. The pipeline forwards only these allowlisted diagnostics,
never raw upstream messages. Conflict errors identify the active or blocked
run and its uncertain operation; missing and paused cron jobs are distinguished.
Known PostgreSQL failures identify authentication, permissions, missing
migrations, connection capacity, statement cancellation/timeouts and lock waits
without exposing SQL statements or database connection details.

**Reset & restart** requires a new run key and destructive confirmation. It
targets the displayed job, safely stops it when no operation is in flight,
disables automatic runs, and queues a fresh Storage reset, PostgreSQL reset,
scrape and ETL sequence. Stop admission and new enqueue share one transaction;
if enqueue fails, the old run is unchanged. Stale targets, other active runs and
uncertain-operation interlocks are rejected, never cleared by the button.

### Storage objects and migration

The staging prefix owns JSON objects named `<run-unix-ms>_<16-digit-source-id>.json`.
Writes upsert a source ID within a run; counts and cursor imports isolate that
run's timestamp. The cache selects the latest record per source ID. Listings
paginate explicitly and fail above 10,000 entries instead of truncating.
Cleanup removes only matching record filenames in the configured prefix,
validates every deletion acknowledgement, and never empties the whole bucket
or removes unrelated files/subfolders. Reserve this prefix for the scraper.
Use a private bucket: public buckets are refused even with a valid server key.
`POST /hackathons/reset` deletes at most 100 owned objects per request. It returns
`deletedRecords`, `hasMore`, and `reset: !hasMore`; partial cleanup is not a completed
reset. The pipeline checkpoints each acknowledged batch, accumulates deleted
counts, and advances to PostgreSQL only after the final batch. It keeps the first
operation named `reset-storage`, so an old uncertain reset cannot be bypassed.
Previously completed whole-reset acknowledgements remain replayable.

The canonical import route is `POST /etl/import/storage`, forwarded through
`POST /api/internal/etl/etl/import/storage` on the main gateway.
The old `/etl/import/mongodb` route is a deprecated Storage-backed alias;
non-empty database/collection overrides now return 400, not a silent fallback.
No database migration is needed for the new storage backend. Stop old workers
before deploying; pre-Storage jobs are refused before any new mutation and must
not resume against the new store. Do not erase their uncertainty interlocks.
New jobs are marked `stagingBackend: "supabase-storage"` and use `reset-storage`.

## Bounds and recovery

- Scraping requires `maxPages=1` per persistence request.
- Each Edge run admits at most **9,998 unique source IDs** before Storage uploads.
  Duplicate IDs update their existing records without using another slot.
  A page crossing the cap persists only the IDs that fit; the pipeline completes
  scraping and advances to ETL at the cap even when Devpost has more pages.
  This does not resume an already failed run or clear an uncertain-operation interlock.
- AI Storage/file imports accept one record per request; non-AI imports accept up
  to 25. Larger requests fail **before writes** rather than partially succeeding.
  File imports support JSON, JSONL and CSV, with a 1 MB multipart request limit.
  This intentionally replaces unbounded legacy bulk requests; split imports
  client-side or use the pipeline's cursor-based import.
- Storage operations share a 25-second budget with 15-second HTTP timeouts.
  Writes use at most ten parallel requests; records are capped at 250 KB,
  API responses at 2 MB, and cache reads at 8 MB.
  Cleanup uses one deletion request per tick, with a 100-object batch and bounded
  lookahead instead of listing and deleting the entire staging run in one request.
- Evidence fetches have a 35-second shared budget, per-page timeouts and size
  caps; AI completion is limited to 45 seconds. Unknown facts stay unknown.
- Import processing shares a 100-second request budget. Each event transaction
  has at most 20 seconds, shortened to the remaining request budget; database
  statement timeouts are recalculated before each query so expired writes roll
  back rather than continuing an unbounded transaction.
- A database lease prevents overlapping ticks. A completed operation can replay
  its stored result after a lost progress acknowledgement. A started operation
  without a persisted result is **never automatically repeated**. After lease
  expiry it fails the job and blocks new runs with an infinite interlock.
- Keys are AES-256-GCM encrypted with the job UUID as authenticated data, expire
  after 24 hours, and are erased on completion/failure/expiry. Backups can retain
  old ciphertext. Only safe errors and aggregate counts are persisted.

Inspect remote logs and ensure no prior operation is still active before
clearing the exact failed job's interlock:

```sql
UPDATE pipeline_control.jobs SET blocked_until=NULL
WHERE id='FAILED-JOB-UUID' AND status='failed';
```

Never delete the operation ledger to force a replay. Resets across databases are
not atomic and the pipeline does not claim exactly-once remote mutations.

## Validation and code organization

```text
deno task --config supabase/functions/deno.json check
deno task --config supabase/functions/deno.json test
npm run check:code-size
node --test scripts/test/research-schema.test.cjs
```

Code files are limited to 200 physical lines, including tests and SQL. The
historical research migration is split into sequential files: a completion-view
guard skips new fragments on databases that already applied the original DDL.
The standalone psql schema uses the same ordered schema structure.
Local tests do not prove hosted Storage permissions/connectivity, Edge bundle compatibility,
pg_net delivery, platform CPU limits, or cron permissions. Verify those in a
non-production Supabase environment before enabling destructive production runs.

The shared runtime installs Node's `Buffer` compatibility global before loading
the PostgreSQL npm client. Pipeline encryption imports `Buffer` explicitly.
A `ReferenceError` log includes only the missing symbol name, never arbitrary
exception messages that could contain connection strings or provider keys.
