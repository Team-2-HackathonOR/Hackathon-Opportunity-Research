# Gateway-only Supabase scraper and ETL

Two Deno Edge Functions replace the scraper and Python ETL services:

- `scraper`: Devpost mapping, AI pagination, MongoDB persistence/cache/reset,
  pipeline control and one durable pipeline step per tick.
- `etl`: MongoDB imports, JSON/JSONL/CSV file imports, AI website enrichment,
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
tick -> one MongoDB reset / PostgreSQL reset / scrape page / ETL record
ETL step -> main gateway -> etl function -> MongoDB + PostgreSQL
```

No background promise or function-to-function HTTP bypass is used. Each minute
advances at most one step. The queue, lease, cursor, progress, encrypted keys and
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
3. Configure both functions' server secrets using `.env.example` as the inventory.
   Use a PostgreSQL transaction-pooler URL and a role with access to the private
   control schema and research tables. Connections disable prepared statements
   and require verified TLS; supply the official project CA as
   `EDGE_DATABASE_CA` if necessary. Keep `pipeline_control` unexposed to PostgREST.
   MongoDB Atlas must allow the Edge runtime's outbound connections.
4. Generate `PIPELINE_KEY_ENCRYPTION_KEY` as a random 32-byte base64 value.
   Reuse the old encryption key only when intentionally preserving old encrypted
   jobs, and never rotate while a run is active. Configure secrets through the
   Supabase Dashboard or an ignored env file; never commit them.
5. From the repository root, deploy with the Supabase CLI:

   ```text
   supabase functions deploy scraper
   supabase functions deploy etl
   ```

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
   SELECT cron.schedule('hackscout-edge-tick','* * * * *',
     'SELECT pipeline_control.dispatch_edge_tick()');
   ```

   The tick is required even for manual queued runs. Scheduling frequency
   defaults to off for a new schema; existing persisted settings are preserved.
   Review/disable an existing automatic schedule before registering the tick.

No deployment or destructive run is implicit in these steps. An actual manual
or automatic pipeline still permanently resets MongoDB and event listings.
Accounts, suggestions/review history, categories, and team members are preserved.

## Bounds and recovery

- Scraping requires `maxPages=1` per persistence request.
- AI Mongo/file imports accept one record per request; non-AI imports accept up
  to 25. Larger requests fail **before writes** rather than partially succeeding.
  File imports support JSON, JSONL and CSV, with a 1 MB multipart request limit.
  This intentionally replaces unbounded legacy bulk requests; split imports
  client-side or use the pipeline's cursor-based import.
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
Local tests do not prove hosted MongoDB connectivity, Edge bundle compatibility,
pg_net delivery, platform CPU limits, or cron permissions. Verify those in a
non-production Supabase environment before enabling destructive production runs.
