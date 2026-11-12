# HackScout

Discover hackathons with topic, keyword, location, date, format, cost, student eligibility, age, and team-rule filters. View event details and official links, save listings, and include closed events.

Visitors can submit event names and websites for review. The Hackathon Service stores suggestions as `pending` in PostgreSQL `public.event_suggestions`; they are not published automatically.

HackScout opens with **Sign in**, **Create account**, and **Continue as guest**.
Public signup creates a viewer account in the existing authentication database;
it never grants admin access. Sessions stay in page memory rather than browser
storage. The main gateway and JWT service are required for account access.
**My data** offers separate actions to clear device-only saved listings/filters,
or permanently delete the signed-in account after entering its current password
and typing `DELETE`. Account deletion removes sessions and related invitations,
deletes linked team-member/contribution/verification records, and anonymizes
moderation identity and notes. Public listings and anonymous suggestions stay.
Clearing browser data does not delete the account, and deleting the account does
not clear browser bookmarks.
Saved listings are device-local and separated by authenticated account ID, with
a separate guest collection. Legacy unscoped bookmarks are not assigned to an
account because their owner is unknown. A complete successful listings refresh
removes bookmarks for deleted events; failed or incomplete refreshes do not.
The public UI follows the Hackathon Service's `after_event_id` cursor so saves
beyond the first 100 listings are not incorrectly removed. **Clear browser data**
removes all HackScout bookmark collections on the device, not unrelated storage.

## Run locally

Configure the service environment files, including the same
`GATEWAY_INTERNAL_SECRET` for the main gateway, HackScout API, scraper, and ETL.
Configure `services/hackathon-service/.env` with its PostgreSQL `DATABASE_URL`
and the shared `GATEWAY_INTERNAL_SECRET` for listings, suggestions, and moderation.
These features do not require a Supabase API key or exposed API schemas.
Run the root `npm run dev` and open
`http://localhost:3001`. All application API calls go through the main gateway
on port 4000. Listings, suggestions, and moderation use the Hackathon Service.
Admin cookie sign-in is handled by the main gateway and JWT service; pipeline
controls still use the protected HackScout API on port 3002.

See [local setup](./docs/LOCAL-RUN.md) for the database migrations and the full service launcher, which serves the public UI on `http://localhost:3001`.

### Deployed HackScout frontend

When deploying `hackscout-gateway/server.js` as the frontend on Vercel, set
`AUTH_GATEWAY_URL` to the deployed **main gateway** URL, not the HackScout
frontend URL or the Hackathon Service URL. Browser `/api/hackscout/*` and
`/api/auth/*` requests are forwarded server-side to that gateway. Gateway
credentials and identity headers are never accepted from the browser proxy.
The main gateway must have `HACKATHON_SERVICE_URL` pointing to the deployed
Hackathon Service and `HACKSCOUT_SERVICE_URL` pointing back to this backend.
The backend's `/api/admin`, `/api/suggestions`, and legacy listing routes
remain gateway-only; `/hackscout-admin/` serves the admin UI.

For a separate static admin deployment, set the Vercel project's Root Directory
to `admin-ui`. Its `vercel.json` forwards `/api/hackscout/admin/*` server-side
through `https://hackascout-gateway.vercel.app`, including authentication,
moderation, and pipeline requests. This keeps browser requests and HttpOnly
session cookies on the admin site's own origin. Update the rewrite destination
if the HackScout frontend domain changes. Redeploy the admin project after
adding or changing this configuration; deploying only its static assets without
the rewrite causes Vercel `NOT_FOUND` responses for admin API requests.

## Admin moderation

Open `http://localhost:3003` (also available through the public UI's Admin link).
Enter an approved admin email first, then sign in with its password. A
pre-approved local admin with no password gets a first-password creation form,
matching Codyza Weather. No public admin registration or role selection is
available. Admin sessions use an HttpOnly, SameSite cookie (Secure in production)
until JWT expiry or sign-out and survive page reloads. Public user sessions remain
in page memory. **First-password setup intentionally follows Weather's
email-only flow: it does not verify email ownership. Provision passwordless admin
accounts only when their intended owners are ready to activate them.**
The main gateway
and JWT service must be running; `AUTH_GATEWAY_URL` in
`hackscout-gateway/.env` defaults to `http://127.0.0.1:4000`.
Pipeline requests use the administrator identity verified and injected by the
main gateway, only after backend shared-secret authentication succeeds. They
do not call `/api/auth/me` recursively: that extra gateway round trip can trigger
HTTP 508 loop detection on Vercel. Missing or non-admin identities are rejected.
Legacy bearer verification still reports upstream errors without credentials.
The main gateway logs failed JWT verification with the upstream origin, path,
HTTP status (when available), and a failure reason, without credentials or
response bodies. Verification has a 10-second timeout and does not follow
redirects.

Apply [`20261106170000_event_suggestion_moderation.sql`](./supabase/migrations/20261106170000_event_suggestion_moderation.sql) after the research schema and listing-access migrations. It creates or upgrades the suggestions table, adds review history, and enables atomic publication.

Search and paginate pending, approved, or rejected submissions. Supply the organizer, official website, format, start date, description, and location for non-virtual events before approving. Approval publishes a listing as **Needs Confirmation** with low evidence confidence; rejection requires a reason and does not publish. Both retain the reviewer, timestamp, and review note. Reviewed submissions are read-only.

The dashboard also runs **reset MongoDB and PostgreSQL → scraper → MongoDB → ETL with AI → PostgreSQL**.
Enter an OpenAI-compatible key for each run. Locally it stays in process memory;
on Vercel it is encrypted temporarily in the worker's control database, never
stored as plaintext or passed into Workflow history. The UI shows
stage and import counts, including partial failures. Configure
`SCRAPER_SERVICE_URL` and `ETL_SERVICE_URL` on the main gateway and use the
same MongoDB database/collection for both services. Every manual and automatic
run permanently deletes scraper records, event listings and their dependent
records before scraping. Accounts, suggestions/review history, categories and
team members are retained; published suggestions are unlinked from deleted events.
A failed reset stops the pipeline; later failures can leave databases empty or
partially filled. The two database resets are not atomic together.
ETL remains insert-only. Animated stage cards display reset/scraper/ETL elapsed times. Optional weekly,
every-two-week, or monthly schedules use the pipeline host's `AI_API_KEY`.
The [gateway-only Supabase Edge deployment](./supabase/functions/README.md)
moves both services, durable orchestration and scheduling to Supabase while
retaining MongoDB and existing gateway API paths. Configure
`PIPELINE_SERVICE_URL` on the main gateway to select it.
Without that Edge routing, Vercel requires the [durable workflow worker](./pipeline-worker/README.md), its
control-schema migration, and `PIPELINE_WORKER_URL` on the HackScout backend.
It replaces background memory/timers with queued, bounded steps and durable
progress/schedules. See [local setup](./docs/LOCAL-RUN.md) for the local runner.

Run the API and PostgreSQL moderation tests with `npm test --prefix .\hackscout-gateway`.

## Contributor code-size rule

Every repository-owned code file, including tests, SQL and workflow YAML, must
contain at most **200 physical lines**. Split cohesive responsibilities into
modules; do not minify code to evade the limit. Dependencies, generated artifacts
and data/lockfiles are not source code. Run `npm run check:code-size`; CI enforces
the same check for pushes and pull requests.
