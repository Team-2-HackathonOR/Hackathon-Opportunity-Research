# HackScout

Discover hackathons with topic, keyword, location, date, format, cost, student eligibility, age, and team-rule filters. View event details and official links, save listings, and include closed events.

Visitors can submit event names and websites for review. Suggestions are stored as `pending` in Supabase `public.event_suggestions`; they are not published automatically.

HackScout opens with **Sign in**, **Create account**, and **Continue as guest**.
Public signup creates a viewer account in the existing authentication database;
it never grants admin access. Sessions stay in page memory rather than browser
storage. The main gateway and JWT service are required for account access.

## Run locally

Configure the service environment files, including the same
`GATEWAY_INTERNAL_SECRET` for the main gateway, HackScout API, scraper, and ETL.
Configure `SUPABASE_GRAPHQL_URL` and `SUPABASE_API_KEY` on the HackScout API
with a server-side secret/service-role key. Run the root `npm run dev` and open
`http://localhost:3001`. All application API calls go through the main gateway
on port 4000; the HackScout API on port 3002 is a protected backend.

See [local setup](./docs/LOCAL-RUN.md) for the database migrations and the full service launcher, which serves the public UI on `http://localhost:3001`.

## Admin moderation

Open `http://localhost:3003` (also available through the public UI's Admin link).
Sign in with an existing JWT account with the `admin` role. The main gateway
and JWT service must be running; `AUTH_GATEWAY_URL` in
`hackscout-gateway/.env` defaults to `http://127.0.0.1:4000`.

Apply [`20261106170000_event_suggestion_moderation.sql`](./supabase/migrations/20261106170000_event_suggestion_moderation.sql) after the research schema and listing-access migrations. It creates or upgrades the suggestions table, adds review history, and enables atomic publication.

Search and paginate pending, approved, or rejected submissions. Supply the organizer, official website, format, start date, description, and location for non-virtual events before approving. Approval publishes a listing as **Needs Confirmation** with low evidence confidence; rejection requires a reason and does not publish. Both retain the reviewer, timestamp, and review note. Reviewed submissions are read-only.

The dashboard also runs **scraper → MongoDB → ETL with AI → PostgreSQL**.
Enter an OpenAI-compatible key for each run; it is not saved. The UI shows
stage and import counts, including partial failures. Configure
`SCRAPER_SERVICE_URL` and `ETL_SERVICE_URL` on the main gateway and use the
same MongoDB database/collection for both services. ETL remains insert-only.
Animated stage cards display scraper/ETL elapsed times. Optional weekly,
every-two-week, or monthly schedules use the backend's `AI_API_KEY` while it
is running; form keys are not saved. See [local setup](./docs/LOCAL-RUN.md)
for schedule timing and persistence.

Run the API and PostgreSQL moderation tests with `npm test --prefix .\hackscout-gateway`.
