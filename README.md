# HackScout

Discover hackathons with topic, keyword, location, date, format, cost, student eligibility, age, and team-rule filters. View event details and official links, save listings, and include closed events.

Visitors can submit event names and websites for review. Suggestions are stored as `pending` in Supabase `public.event_suggestions`; they are not published automatically.

## Run locally

From `gateway`, run `npm install`, configure `SUPABASE_GRAPHQL_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) in `.env`, then run `npm run dev`. Open `http://localhost:3000`.

Create the suggestions table by running [`gateway/event_suggestions.sql`](./gateway/event_suggestions.sql) in the Supabase SQL Editor. Review suggestions in Supabase **Table Editor**.
