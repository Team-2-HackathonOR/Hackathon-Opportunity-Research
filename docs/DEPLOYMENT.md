# Deployment

## Local (development)

See [LOCAL-RUN.md](./LOCAL-RUN.md): start `jwt-service` (4004), `services/hackathon-service` (4001), then `gateway` (4000).

## Docker (single instance)

```bash
docker compose up --build
```

## Hackathon service on Vercel

Set the Vercel project root directory to `services/hackathon-service`.
The detected `src/app.ts` entrypoint exports an HTTP handler that initializes
Fastify once per function instance. Local development and Docker continue to
start the listening server through `src/index.ts`.

Configure `DATABASE_URL`, `DATABASE_SSL=true`, and `GATEWAY_INTERNAL_SECRET`
in Vercel's environment settings. The shared secret must match the gateway.
Leave `LOG_FILE_PATH` unset so logs go to stdout rather than the function's
filesystem. Redeploy after changing code or environment settings.
On Vercel, file logging is disabled even if `LOG_FILE_PATH` is configured;
the service emits a warning and continues logging to stdout.
Check `/health/live` for function startup and `/health/ready` for database
connectivity, then set the gateway's `HACKATHON_SERVICE_URL` to the deployment's
base URL.

## JWT service on Vercel

Set the Vercel project root directory to `jwt-service`. Its `src/app.ts`
default HTTP handler initializes the same PostgreSQL user, invitation, token,
and optional LDAP stores as the local entrypoint. Initialization is shared
across requests within each function instance, including startup seed handling
and expired-token cleanup.

Configure `DATABASE_URL` for the auth database, `DATABASE_SSL=true`,
`JWT_SECRET` (at least 32 characters), and `GATEWAY_INTERNAL_SECRET` (matching
the gateway). `AUTH_DATABASE_URL`, when supplied, overrides `DATABASE_URL`;
the current validator still requires `DATABASE_URL`. Leave production seed
passwords and `LOG_FILE_PATH` unset. Configure `MAIL_SERVICE_URL` and LDAP
settings only when those services are available from Vercel.

Redeploy, verify `/health/live` and `/health/ready`, and point the gateway's
`JWT_SERVICE_URL` to the deployment base URL.

## Kubernetes (Skaffold)

Create the namespace secrets before the first deploy. Use the same
`GATEWAY_INTERNAL_SECRET` for gateway, hackathon-service, jwt-service, and
mail-service; set the two database URLs and JWT signing secret to their actual
values. Keep these values in your cluster secret manager or local environment,
not in checked-in YAML.
The shared internal secret must be at least 16 characters; `JWT_SECRET` must
be at least 32 characters.

Create the namespace first with `kubectl apply -f infra/namespace.yaml`.

Required Secret keys:

| Secret | Keys |
|--------|------|
| `gateway-secrets` | `GATEWAY_INTERNAL_SECRET` |
| `hackathon-service-secrets` | `DATABASE_URL`, `GATEWAY_INTERNAL_SECRET` |
| `jwt-service-secrets` | `DATABASE_URL`, `JWT_SECRET`, `GATEWAY_INTERNAL_SECRET` |
| `mail-service-secrets` | `GATEWAY_INTERNAL_SECRET`; `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` when mail is enabled |

Create each Secret with `kubectl create secret generic <name> -n hackathon-research --from-literal=KEY=value`.
Generate `JWT_SECRET` with `openssl rand -base64 32`. The database URLs should
refer to reachable PostgreSQL instances with the required migrations applied.
The mail service stays unready until `SMTP_HOST` is configured.

Then build and deploy all Kubernetes services:

```bash
skaffold dev
```

The gateway is internal to the cluster by default. For local access, run
`kubectl port-forward -n hackathon-research service/gateway 4000:4000`.

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
