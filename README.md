# Team-2 — Hackathon Opportunity Research

Codyza **Team 02 Task 01**: verified hackathon research platform (database + API + frontend).

## Repository layout

| Path | Purpose |
|------|---------|
| `client/` | Next.js frontend |
| `gateway/` | API Gateway — JWT checks, roles, routes traffic to services |
| `jwt-service/` | Login, LDAP, and JWT checks against `app_auth.jwt_tokens` |
| `services/mail-service/` | Python SMTP service for invitation links |
| `services/hackathon-service/` | Hackathon research API (Drizzle + PostgreSQL) |
| `ETL/` | Python ETL service |
| `scrapper/` | Scraper service |
| `infra/` | Kubernetes manifests |
| `supabase/migrations/` | PostgreSQL schema |
| `docs/` | Architecture, API, task progress, research SOP |

## Quick start (gateway + hackathon API)

1. Create the Postgres database and run migrations in order. The live schema is `hackathon_research` from `supabase/migrations/20261020180000_hackathon_research.sql`. The earlier `public.hackathons` scripts are the retired flat table.
2. Configure env (see [LOCAL-RUN.md](docs/LOCAL-RUN.md)): `services/hackathon-service/.env`, `jwt-service/.env`, and `gateway/.env`. Use the same `GATEWAY_INTERNAL_SECRET` on the gateway and JWT service. Keep `JWT_SECRET` only in `jwt-service`.
3. Start **jwt-service**, **hackathon-service**, then **gateway** (or `npm run dev:jwt`, `dev:hackathon`, and `dev:gateway` from repo root).
4. Verify: `GET http://localhost:4000/health/ready` and `GET http://localhost:4000/gateway/routes`

## Documentation index

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Research SOP](docs/RESEARCH-SOP.md)

## Docker (gateway stack)

```bash
docker compose up --build
```

## Skaffold / Kubernetes (ETL + scrapper)

The Kubernetes manifests under [infra/](./infra) reference the `team2-etl` and `team2-scraper` images. For remote or shared clusters, [skaffold.yaml](./skaffold.yaml) is configured to push images so the cluster can pull the generated tag.

Example:

```bash
skaffold run --default-repo <your-registry>
```

For common local clusters (`docker-desktop`, `minikube`, and `kind-kind`), the `local-cluster` profile is auto-activated and keeps image pushes disabled so local development still works with the node's local image store.

## Remote repositories

Local clone may point to `saningore/Team-2`. Team PRs may also use `ayushgaire/Team-2` — confirm the canonical remote with your lead before pushing.

Powered by Codyza.
