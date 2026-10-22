# Team-2 Architecture

## Pattern: API Gateway + microservices

```
                    +------------------+
  Client / Next.js  |   API Gateway    |  :4000
                    |  logging, ACL,   |
                    |  rate limit,     |
                    |  route proxy     |
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
         v                   v                   v
 +---------------+   +---------------+   +---------------+
 | hackathon-    |   | jwt-service   |   | mail-service  |
 | service :4001 |   | :4004         |   | :4005 Python  |
 +-------+-------+   +-------+-------+   +---------------+
         |                   |                   ^
         v                   v                   |
   scraper project      auth project        invite mail
```

## Gateway (`gateway/`)

- Single public URL for the team
- Proxies paths to internal services
- No database URL and no JWT signing secret. Login, signing, and token checks stay in `jwt-service`.
- Asks `jwt-service` `POST /verify` on protected routes, then enforces `viewer`, `researcher`, and `admin` before proxying `/api/*`
- Forwards `X-User-Id`, `X-User-Role`, and `X-User-Email` from the token, plus `X-Gateway-Caller` and `X-Gateway-Secret`
- Request logs go to stdout as JSON. In development they are also printed as readable lines, and copied to `LOG_FILE_PATH` when set. The hackathon service logs the same way. Passwords, bearer tokens, and the gateway secret are removed from logs.

## Database rules

The hackathon service uses schema `hackathon_research` from `supabase/migrations/20261020180000_hackathon_research.sql`: `events` plus sources, tracks, benefits, milestones, categories, shortlist entries, application requirements, follow-ups, verifications, and team members. Queue endpoints read the SQL views (`v_apply_now_queue`, `v_codyza_shortlist`, and the rest). `public.hackathons` is the retired flat table. Point `DATABASE_URL` at the scraper project that holds this schema.

Login accounts, invitations, and issued tokens live in schema `app_auth` on the auth project (`supabase/auth/001_auth.sql`). Supabase already owns a schema named `auth`, so these tables are not created there. `jwt-service` reaches them through `AUTH_DATABASE_URL` (it falls back to `DATABASE_URL` when that variable is unset). Invitation links store only a token hash. Issued access tokens store `token_id`, a SHA-256 of the claims, user, role, issuer, and timestamps. The raw JWT is not stored.

## JWT service (`jwt-service/`)

- `POST /login` checks a local password, or Codyza LDAP when `LDAP_URL` is set, then writes `app_auth.jwt_tokens` and signs the token
- `POST /invitations` stores a one-time invite for an admin and asks the Python mail service to send the link. `POST /invitations/accept` creates the local account and signs the same kind of token
- `POST /verify` checks HS256, the issuer, and the expiry, then requires the token row and `app_auth.app_users` role to match the claims
- `POST /logout` revokes that token. `POST /users/:id/revoke-sessions` revokes every active token for one account and requires an admin
- Accepts calls only from the gateway (`X-Gateway-Caller` / `X-Gateway-Secret`)
- Health routes stay open so the gateway readiness check can reach them

## Mail service (`services/mail-service/`)

Python FastAPI on port 4005. It sends invite mail with `smtplib`. It has no database and no JWT secret. `jwt-service` is the caller.

## Hackathon service (`services/hackathon-service/`)

- Codyza master database CRUD, views, CSV exports, organizer follow-ups
- Rejects calls that do not carry the gateway caller and secret. `/health`, `/health/live`, and `/health/ready` stay open.
- **Drizzle ORM + `DATABASE_URL`** (standard PostgreSQL — not coupled to Supabase SDK)
- Supabase can remain the host; migration to RDS/local Postgres is a connection-string change

## Codyza research rules

Enforced in **hackathon-service** (see `docs/RESEARCH-SOP.md`).

## Adding a new service

1. Create `services/<name>/` with its own port and `.env`.
2. Add `*_SERVICE_URL` to gateway env.
3. Register proxy prefix in `gateway/src/routes/service-proxy.ts`.
4. Document in `GET /gateway/routes`.
