# Hackathon Service

Domain microservice for Codyza hackathon research records.

## Data access (portable)

- **PostgreSQL** via standard `DATABASE_URL` connection string
- **Drizzle ORM** (no Supabase SDK) — migrate to any Postgres host by changing the connection string
- SQL bootstrap scripts live in `../../supabase/migrations/` (plain PostgreSQL, not Supabase-specific logic)
- Research records live in schema `hackathon_research`. Apply `20261020180000_hackathon_research.sql` after the earlier migrations
- Logs: JSON on stdout, readable lines in development, optional `LOG_FILE_PATH`

## Run locally

1. Supabase → **Settings → Database → Connection string → URI** (replace `[YOUR-PASSWORD]`)
2. Create `.env` from `.env.example` with `DATABASE_URL=...`
3. Ensure migrations were applied (SQL Editor)
4. `npm install && npm run dev` (port **4001**)

Clients should call the **gateway** on port 4000. Direct calls to this service need `X-Gateway-Caller: team-2-gateway` and `X-Gateway-Secret`. Health routes stay open.

`GET /api/hackathons` supports `include=details` to include each event's
tracks, benefits, sources, and application requirements. The public
`/api/hackscout/hackathons` gateway route uses this option for HackScout;
other Hackathon Service API routes retain their normal gateway authentication.

Suggestions and moderation use the same PostgreSQL connection:
`POST /api/suggestions`, `GET /api/admin/suggestions`, and
`POST /api/admin/suggestions/:id/review`. Admin routes require a trusted
gateway admin identity. Apply `20261106170000_event_suggestion_moderation.sql`
to this database; approval uses its atomic `public.moderate_event_suggestion`
function. The connection role must have access to the suggestions table and
permission to execute that function. Supabase REST keys are not required.

The internal pipeline uses `POST /api/internal/pipeline/reset` through the
gateway's `POST /api/internal/hackathons/reset`. A trusted gateway caller and
shared secret are required; this route does not need a user identity.
It atomically clears event links in suggestions, deletes event-linked
contributions and deletes all events (dependent records cascade). Accounts,
suggestions/review history, categories and team members remain intact.
The moderation migration must already be applied. Returns
`{reset:true,deletedEvents}` only after commit. Every manual and scheduled
pipeline run invokes this reset before scraping; failures stop the pipeline.

Account deletion also uses internal `DELETE /api/account-data` with trusted
gateway identity headers (`x-user-id`, `x-user-email`, `x-user-role`). The gateway
verifies the user's password before calling it. Within one transaction it removes
matching-email team members and their contributions/verifications, and clears
that account's reviewer ID and review notes. Other member references become null
through existing foreign keys. Public events, anonymous suggestions and other
users' records remain. The gateway deletes the separate auth account only after
this cleanup succeeds.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests |
| `npm run db:studio` | Drizzle Studio (optional) |
