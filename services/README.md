# Microservices

| Service | Port | Status |
|---------|------|--------|
| `gateway` | 4000 | Implemented — external API entry point |
| `hackathon-service` | 4001 | Implemented — Codyza research API + PostgreSQL |
| `ai-service` | — | Planned — analysis (draft only, human verify) |
| `scraper` | 3000 | Implemented — hackathon discovery and persistence |
| `jwt-service` | 4004 | Implemented — JWT login and roles |
| `mail-service` | 4005 | Implemented — SMTP delivery |

Kubernetes deployments and ClusterIP services are defined under `infra/` and
included in the Skaffold configuration. Required credentials must be created
as Kubernetes Secrets before deploying; see [Deployment](../docs/DEPLOYMENT.md).
All external API traffic enters through **gateway** on port 4000.
