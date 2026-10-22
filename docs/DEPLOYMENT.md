# Deployment

## Local (development)

See [LOCAL-RUN.md](./LOCAL-RUN.md): start `jwt-service` (4004), `services/hackathon-service` (4001), then `gateway` (4000).

## Docker (single instance)

```bash
docker compose up --build
```

## Redundancy (production pattern)

1. Build image from `gateway/Dockerfile`.
2. Run **2+ replicas** behind a load balancer (Railway, Render, AWS ALB, etc.).
3. Configure LB health check: `GET /health/ready`.
4. Gateway replicas share the same downstream URLs (`HACKATHON_SERVICE_URL`, etc.).
5. Hackathon-service replicas share the same `DATABASE_URL` (PostgreSQL).
6. Set `ADMIN_API_KEY`, rate limits, and optional `IP_ALLOWLIST`.

## Environment variables

See root `.env.example`, `gateway/.env.example` (if present), `services/hackathon-service/.env.example`, and `.env.production.example`.

**Gateway:** `HACKATHON_SERVICE_URL`, `JWT_SERVICE_URL`, `GATEWAY_INTERNAL_SECRET`, `PORT`, `ADMIN_API_KEY` (no database credentials and no JWT signing secret). Optional `LOG_FILE_PATH` for a local JSON log file. Leave it unset in containers.

Apply `supabase/migrations/20261020180000_hackathon_research.sql` after the earlier migrations, then `supabase/migrations/20261021140000_app_users.sql` and `supabase/migrations/20261021180000_invitations.sql`. The API reads and writes schema `hackathon_research`. The earlier `public.hackathons` scripts are the retired flat table.

**Hackathon service:** `DATABASE_URL`, `DATABASE_SSL`, `GATEWAY_INTERNAL_SECRET` (standard PostgreSQL; Supabase is optional hosting only).

**JWT service:** `AUTH_DATABASE_URL` for the auth project, the same `GATEWAY_INTERNAL_SECRET` as the gateway, and its own `JWT_SECRET` (`openssl rand -base64 32`). Set `INVITE_URL_BASE` to the frontend page that accepts an invitation. Leave seed passwords unset in production. Set `MAIL_SERVICE_URL` and the `LDAP_*` variables when those are in use.

**Mail service:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`, and the same `GATEWAY_INTERNAL_SECRET`. It does not receive a database URL. Apply `supabase/auth/001_auth.sql` on the auth project. Apply `supabase/auth/002_drop_research_accounts.sql` only after login, invite, verify, and logout succeed against `app_auth`. Leave the event tables on the scraper project.

Never commit `.env` or paste production secrets into GitHub. Use the hosting provider **Environment Variables** / **Secrets** UI.

Optional proxy upstreams:

- `PROXY_REST_UPSTREAM_URL`
- `PROXY_GRAPHQL_UPSTREAM_URL`
