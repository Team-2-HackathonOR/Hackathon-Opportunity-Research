# HackScout

Discover hackathons with topic, keyword, location, date, format, cost, student eligibility, age, and team-rule filters. View event details and official links, save listings, and include closed events.

Signed-in users can submit event names and websites for review. Suggestions are stored as `pending` in Supabase `public.event_suggestions`; they are not published automatically.

## Run locally

From `hackscout-gateway`, run `npm install`, copy `.env.example` to `.env`, configure `SUPABASE_GRAPHQL_URL` and `SUPABASE_API_KEY` with a server-side secret/service-role key, then run `npm run dev`. Open `http://localhost:3002`.

See [local setup](./docs/LOCAL-RUN.md) for the database migrations and the full service launcher, which serves the public UI on `http://localhost:3001`.

## Sign in

Open `http://localhost:3001` with the full launcher, or `http://localhost:3002` with the standalone HackScout gateway. Without a valid session, the application redirects to sign-in. Sign in with an existing JWT account. Administrators go to moderation; viewers and researchers go to the listings. The token stays in the current tab's session storage until sign-out or tab close. Use the same origin throughout a session; ports 3001, 3002 and 3003 do not share browser storage. The listings and suggestions APIs verify the JWT server-side; the static UI files themselves are not private.

## Admin moderation

With the full service launcher, open `http://localhost:3003` for the admin UI. It is also available at `http://localhost:3002/admin/` and through the public UI's Admin link. Sign in with an existing JWT account with the `admin` role. The HackScout gateway, main gateway, and JWT service must be running; `AUTH_GATEWAY_URL` in `hackscout-gateway/.env` defaults to `http://127.0.0.1:4000`.

Apply [`20261106170000_event_suggestion_moderation.sql`](./supabase/migrations/20261106170000_event_suggestion_moderation.sql) after the research schema and listing-access migrations. It creates or upgrades the suggestions table, adds review history, and enables atomic publication.

Search and paginate pending, approved, or rejected submissions. Supply the organizer, official website, format, start date, description, and location for non-virtual events before approving. Approval publishes a listing as **Needs Confirmation** with low evidence confidence; rejection requires a reason and does not publish. Both retain the reviewer, timestamp, and review note. Reviewed submissions are read-only.

Run the API and PostgreSQL moderation tests with `npm test --prefix .\hackscout-gateway`. """"
