# Durable HackScout pipeline on Vercel

The admin backend enqueues a job and returns HTTP 202. Vercel Workflow dispatches
the work in a separate invocation, so service calls no longer recurse through
the original admin request:

```text
Admin -> frontend -> main gateway -> HackScout backend -> worker enqueue
Vercel Workflow -> worker step -> main gateway -> scraper / Hackathon Service / ETL
```

Jobs, progress, schedule settings, and operation acknowledgements use a dedicated
`pipeline_control` PostgreSQL schema. Only the job UUID is passed into Workflow.
Per-run AI keys are encrypted with AES-256-GCM, bound to the job UUID, and decrypted
only inside a step. They are never returned by status APIs or passed as Workflow
inputs/results. Ciphertext is erased on completion/failure or by cron after a
24-hour expiration. Database backups may retain encrypted historical values;
apply your operator retention policy. Do not rotate the encryption key while a
job is running.

## Deployment

1. Apply `migrations/001_pipeline_control.sql` to the existing PostgreSQL database
   using the worker's database role. It creates only control tables and does not
   reset event or account data. Locally, set `DATABASE_URL` in the ignored `.env`
   file, then run `npm ci` and `npm run db:migrate` from this directory. Use a
   PostgreSQL connection URL with appropriate TLS settings; do not disable
   certificate verification. Keep this schema out of Supabase's exposed schemas.
2. Create a **separate Vercel project**, Root Directory `pipeline-worker`,
   framework **Other**, Node **24.x**, Build Command `npm run build`, Output
   Directory `.vercel/output`. Enable **Include source files outside of the Root
   Directory** because Rome schedule calculation reuses the backend helper.
   Build on Vercel, not by uploading Windows-generated native modules.
3. Configure the worker's Production environment:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Existing PostgreSQL database, with access to `pipeline_control` |
   | `AUTH_GATEWAY_URL` | Main gateway origin (`https://gateway-three-chi.vercel.app`) |
   | `GATEWAY_INTERNAL_SECRET` | Same secret as the main gateway and HackScout backend |
   | `PIPELINE_KEY_ENCRYPTION_KEY` | Base64-encoded random 32-byte key, not an AI key |
   | `CRON_SECRET` | Separate random secret of at least 16 characters |
   | `AI_API_KEY` | Optional server key, required only for automatic runs |

   Generate the encryption key locally with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
   Save it directly into Vercel's environment settings; do not commit or paste it
   into chat.
4. Enable Vercel Workflows/Queues for the project and Fluid Compute. The cron in
   `vercel.json` runs every 10 minutes, so the Vercel plan must permit that cron
   frequency and 300-second functions. Workflow steps use Vercel's queue handler.
   The worker must be reachable by the backend and Workflow delivery. If Vercel
   Deployment Protection is enabled, configure the platform's supported service
   access before enabling runs; do not substitute a public unauthenticated route.
5. On the **HackScout backend** (`hackascout-gateway`), set
   `PIPELINE_WORKER_URL=https://<your-worker-project>.vercel.app` and redeploy.
   On Vercel, missing worker configuration returns an explicit 503; there is no
   fallback to an unreliable in-memory runner. Local development retains the
   old runner unless `PIPELINE_WORKER_URL` is set.
6. Redeploy the **scraper**, **ETL**, **main gateway**, and **admin UI** with these
   changes. The main gateway must have deployed `SCRAPER_SERVICE_URL`,
   `HACKATHON_SERVICE_URL`, and `ETL_SERVICE_URL` values, with matching shared
   secrets. Configure gateway/scraper/ETL Function Max Duration to at least
   **300 seconds**. The worker times individual calls out after 220 seconds.
   MongoDB database/collection settings must agree between scraper and ETL.
7. Leave automatic scheduling disabled until deployment and connections are
   verified. GET pipeline status and schedule are non-destructive. An actual
   manual run still **deletes scraper records and PostgreSQL event listings**.
   Disable any old local scheduler that targets the same databases.

## Bounded work and failure handling

- Both resets must finish before scraping starts.
- Scraping processes one page per durable step. All pages share a run timestamp,
  and MongoDB reports the run-wide unique record count.
- ETL processes one source record per step, in numeric source-ID order, restricted
  to that timestamp. AI/web timeouts and enrichment fan-out are capped for cursor
  imports only. Existing non-cursor imports retain their behavior.
- A database lock plus a unique active-job index prevents overlapping manual and
  scheduled runs across worker instances.
- A deterministic Workflow start-hook token prevents duplicate admission if
  enqueue acknowledgement is lost. Cron recovers unacknowledged starts.
- Completed remote operation results are persisted. A replay uses that result
  rather than repeating the reset or insertion.
- A timeout, crash, or lost acknowledgement after a remote operation starts has
  an **uncertain outcome**. It is not automatically retried. The job fails and
  a durable interlock blocks subsequent runs. This deliberately sacrifices
  automatic recovery rather than risk a second deletion or duplicate insert.
- Schedules persist in PostgreSQL. Vercel cron starts due runs at approximately
  02:00 Europe/Rome (up to one cron interval late), including DST behavior. It
  skips missed periods rather than replaying many destructive runs.
- Database failure or a terminated workflow is reported through the worker logs;
  cron reconciles terminal Workflow status and expires abandoned jobs.

### Recovering an uncertain operation

Inspect the worker's Workflow run and the target service logs. Confirm no remote
operation is still running, cancel the old Workflow if necessary, and decide
whether its partial writes require repair. Only then may an operator clear the
interlock for that specific failed job:

```sql
UPDATE pipeline_control.jobs
SET blocked_until = NULL
WHERE id = '<failed-job-uuid>' AND status = 'failed';
```

Do not delete the operation ledger to force a replay. Start a **new** manual run
only after acknowledging that its reset will delete the current event dataset.
There is no claim of cross-database atomicity or exactly-once remote mutations.

## Validation

`npm test` uses isolated in-memory PostgreSQL and mocked services; it performs no
live reset. `npm run build` compiles the workflow and generates queue-backed
Vercel handlers. Live Workflow delivery, cron, database permissions and deployed
service duration limits still require verification after deployment.
