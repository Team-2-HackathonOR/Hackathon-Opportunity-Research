# Local run (gateway + services)

## 1. Database connection string

Supabase is **PostgreSQL hosting**. The service does not use the Supabase JS client.

1. Supabase Dashboard → **Settings → Database**
2. **Connection string** → **URI**
3. Copy and replace `[YOUR-PASSWORD]` with your database password

Example shape (region may vary):

```text
postgresql://postgres.qdnbwzyhuzgvosploprb:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

## 2. Hackathon service env

`services/hackathon-service/.env`:

```env
DATABASE_URL=postgresql://postgres.qdnbwzyhuzgvosploprb:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
PORT=4001
GATEWAY_INTERNAL_SECRET=local-dev-gateway-secret
```

Apply `supabase/auth/001_auth.sql` on the auth project. The hackathon service uses the scraper project's `hackathon_research` schema and does not read `app_auth.app_users`.

## 3. JWT service env

`jwt-service/.env` uses `AUTH_DATABASE_URL` for the auth project. If that variable is unset, the service uses `DATABASE_URL`. `JWT_SECRET` belongs only in this file. See `jwt-service/.env.example` for the seed accounts, `MAIL_SERVICE_URL`, and the `LDAP_*` variables.

## 3b. Mail service

Copy `services/mail-service/.env.example` to `services/mail-service/.env`.
Set `GATEWAY_INTERNAL_SECRET` to the same value as the gateway and configure
your actual SMTP host and credentials. The root launcher loads this file.

Set `MAIL_SERVICE_URL=http://127.0.0.1:4005` on `jwt-service`. Leave it unset to keep invite links in the API response without sending mail.

## 3c. ETL service

Copy `ETL/.env.example` to `ETL/.env` and configure `DATABASE_URL` for the
research database and `MONGODB_CONNECTION_STRING` for MongoDB.
See [ETL/Readme.md](../ETL/Readme.md) for optional AI configuration.

## 4. Gateway env

`gateway/.env`:

```env
PORT=4000
HACKATHON_SERVICE_URL=http://127.0.0.1:4001
JWT_SERVICE_URL=http://127.0.0.1:4004
GATEWAY_INTERNAL_SECRET=local-dev-gateway-secret
```

HackScout's public listings come from the Hackathon Service through the main
gateway. Configure `services/hackathon-service/.env` with its PostgreSQL
`DATABASE_URL` and the same `GATEWAY_INTERNAL_SECRET` used by `gateway/.env`;
the gateway's `HACKATHON_SERVICE_URL` defaults to
`http://127.0.0.1:4001`.

The standalone HackScout API still uses Supabase for suggestions and
moderation. Copy `hackscout-gateway/.env.example` to
`hackscout-gateway/.env`, set `SUPABASE_GRAPHQL_URL` and `SUPABASE_API_KEY`
to a server-side Supabase secret/service-role key, and leave `PORT=3002`.
Never use or expose a publishable key or commit the secret. These credentials
are not used to load the public listings.

## 5. Install dependencies (once)

From repo root `Hackathon-Opportunity-Research`:

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Hackathon-Opportunity-Research"
npm install
npm run install:all
npm run install:python
```

The Python setup command requires [uv](https://docs.astral.sh/uv/getting-started/installation/).
It selects Python 3.12 (downloading it if necessary), creates a separate `.venv`
inside each Python service, and installs its requirements.
The Python launch scripts use Windows virtual-environment paths.

## 6. Start all services together

After configuring the `.env` files and installing dependencies:

```powershell
npm run dev
```

The root `dev` script starts the hackathon service (4001), JWT service (4004),
scraper (3000), main gateway (4000), standalone HackScout API (3002), static
client (3001), admin UI (3003), mail service (4005), and ETL service (8000).
`concurrently` labels each process and stops the others if one exits. Open
`http://localhost:3001` for the public client; its `/api` requests are proxied
to the main gateway on port 4000. Open `http://localhost:3003` for the admin UI;
its API requests also use the main gateway.
Configure `scraper/.env` and have MongoDB available if you need scraper
persistence.

The client shows six events per page, including closed listings by default.
HackScout at `http://localhost:3001` is the main application entrance: sign in,
create a viewer account, or select **Continue as guest** to explore. Public
registration requires a valid email and a password of at least 8 characters
(at most 72 UTF-8 bytes). Sessions remain in page memory; reload requires
signing in again. The header allows guests to return to account access and
signed-in users to sign out. The main gateway and JWT service must be running
for signup and login; guest listings retain their existing access behavior.
Use Previous, Next, or the page selector to browse every matching event.
Keyword search covers all loaded events, not just the current page; suggestions
offer event names, organizers, locations, and topics as you type. Changing a
search, filter, or sort returns to page one. Click anywhere on an event card
to open its details; the Save button remains independent.
The search dropdown updates on each keystroke; use Up/Down and Enter or click
a suggestion to select it, and Escape to dismiss it. The date picker filters
events happening on that day, including multi-day events spanning that date.
Clearing search and filters also clears the selected date.
Cards and detail headers use a distinct color for each topic, with the first
matching category determining the theme for multi-topic events. A visible
topic label identifies the type without relying on color; uncategorized
events use a neutral theme.
Card ribbons and detail headers also display topic-specific illustrations
from the local `hackscout-ui/assets/event-topics.png` sprite sheet. All 15
topics and the general-event fallback have their own image.

### Admin submission moderation

Open `http://localhost:3003` for the standalone admin UI, or
`http://localhost:3001/hackscout-admin/` through the public client's gateway
proxy. The public footer includes an Admin link.
Sign in with an existing account whose JWT role is `admin`; viewer and
researcher accounts cannot access the moderation API. Configure
`AUTH_GATEWAY_URL=http://127.0.0.1:4000` in `hackscout-gateway/.env` when the
authentication gateway runs at a different address. Both the main gateway
and JWT service must be available. No new admin password or separate login
database is introduced.

On the research Supabase project, apply these migrations in order:

1. [`20261020180000_hackathon_research.sql`](../supabase/migrations/20261020180000_hackathon_research.sql)
2. [`20261106090000_hackathon_graphql_access.sql`](../supabase/migrations/20261106090000_hackathon_graphql_access.sql)
3. [`20261106170000_event_suggestion_moderation.sql`](../supabase/migrations/20261106170000_event_suggestion_moderation.sql)

The last migration creates or upgrades `public.event_suggestions`, preserving
existing submissions. Keep `public` exposed to the Supabase REST API and
`hackathon_research` exposed only if using the standalone GraphQL listing
queries. The service-role key remains only on the standalone API server.
Browser requests use the existing JWT;
the API checks its current admin role for every moderation operation.

The queue supports status filters, event-name/website search, and 12 submissions
per page. Before approval, supply event name, organizer, official HTTP(S)
website, format, start date, and description. In-person and hybrid events
also require city and country. Optional fields include end date, registration
link, topics, and fee details. An end date cannot precede the start date.
Approval publishes the listing and records the review in one database
transaction as **Needs Confirmation** with low confidence, not verified
eligibility. Refresh public listings to see newly published events.

Admins can run the complete pipeline from the admin dashboard. Enter an
OpenAI-compatible API key for each run: the scraper first persists Devpost pages
to MongoDB, then ETL imports this scrape's records with AI normalization into
PostgreSQL. The key is used only during that run, not saved, and immediately
cleared from the form. Both services use their own `AI_BASE_URL` and `AI_MODEL`.
Configure `HACKSCOUT_SERVICE_URL`, `SCRAPER_SERVICE_URL`, and `ETL_SERVICE_URL`
in `gateway/.env` if they differ from ports 3002, 3000, and 8000 on localhost.
Set the same `GATEWAY_INTERNAL_SECRET` in the gateway, HackScout API,
scraper, and ETL environment files. Backend API requests without the gateway
caller and secret are rejected; do not put this secret in frontend code.
Pipeline stages call internal gateway routes rather than the services directly.
Both services must use the same MongoDB database and collection.
ETL must point to the research database used by public listings.

Only one pipeline runs at a time per standalone API process. The dashboard
polls its stage and result; closing the page does not cancel a run. Run status
includes server-recorded start/end timestamps for scraper and ETL. Animated
stage cards show live elapsed time and freeze each duration when that stage
finishes or fails. Waiting/skipped stages have no elapsed time. Reduced-motion
preferences disable the activity animations; no percentage progress is inferred.
Run status is in server memory and is lost on server restart. ETL is insert-only: existing
events or normalization failures are reported as failures, while successful
inserts remain saved. Review failures before repeating a run; reruns do not
update existing research events.

**Automatic runs:** choose Disabled, Once a week, Once every two weeks, or
Once a month and save the schedule. Weekly schedules start on the next Sunday
at 02:00 Europe/Rome; every-two-week schedules repeat from that first Sunday.
Monthly runs occur on the 1st at 02:00 Europe/Rome. On the spring daylight-saving
transition, the nonexistent 02:00 runs at 03:00; the autumn repeated hour runs
only once.

Configure `AI_API_KEY` in `hackscout-gateway/.env` before enabling a schedule.
Manual form keys are never saved or reused for automatic runs. The schedule
(without secrets) persists in the git-ignored
`hackscout-gateway/.data/pipeline-schedule.json`, or `PIPELINE_SCHEDULE_PATH`.
Keep that location writable and persistent. Run one scheduler process only;
this is not a distributed scheduler. The backend must remain running. After
downtime, one overdue run is attempted, not every missed interval. A busy
pipeline defers the automatic run until it is free. Restarting during a run
interrupts it; the in-memory job is not resumed. Due times are advanced on disk
before starting a run to avoid duplicate launches after a restart; a crash
between that write and launch requires a manual retry. Scheduler errors are
logged and shown in the admin dashboard.

Rejection requires a review note and never creates a listing. Approved and
rejected submissions retain reviewer ID, timestamp, note, and any published
event ID in a read-only history view. Duplicate publication and attempts to
review an already-reviewed submission return an actionable conflict.
The admin token is held only in page memory; refreshing requires signing in
again, and Sign out revokes the session through the existing authentication
gateway.

Run the protected API and embedded PostgreSQL migration tests without touching
the live database:

```powershell
npm test --prefix .\hackscout-gateway
```

Use `npm run dev:mail` or `npm run dev:etl` to run either Python service alone.
Both run with auto-reload and load their service-local `.env` file.
Restart the launcher after changing environment variables.

## 7. Test via gateway

```bash
npm run smoke
```

Or manually:

```bash
curl http://localhost:4000/health/ready
curl -X POST http://localhost:4000/api/auth/login -H "content-type: application/json" -d "{\"email\":\"viewer@local\",\"password\":\"change-me-viewer\"}"
curl http://localhost:4000/api/hackathons -H "authorization: Bearer TOKEN"
```

`viewer` can read. `researcher` can create and update. `admin` can also call `/admin/*`.

## 8. Logs

With `npm run dev`, the terminal prints a readable line for each request. The same record is appended as JSON to `logs/gateway.log` and `logs/hackathon-service.log` when `LOG_FILE_PATH` is set. Startup prints `logging to stdout and file` when the file is in use.

Apply the latest SQL migration in the Supabase SQL editor before relying on the new table rules:

`supabase/migrations/20261019120000_table_rules_and_comments.sql`
