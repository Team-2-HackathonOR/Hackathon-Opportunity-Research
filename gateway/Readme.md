# API Gateway

Central entry point for Team-2. **Does not contain business logic** — it routes traffic to microservices.

## Responsibilities

- Request logging: readable lines in development, JSON on stdout, and an optional `LOG_FILE_PATH` copy
- Rate limiting
- IP/path allow & block lists
- Admin access-control APIs
- Asks the JWT service to verify tokens against the stored row and account role, then applies role checks (`viewer`, `researcher`, `admin`)
- Reverse proxy to:
  - `jwt-service` — `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/invitations`, `POST /api/auth/invitations/accept`, `POST /api/auth/users/:id/revoke-sessions`
  - `hackathon-service` — `/api/hackathons`, `/api/exports`, `/api/organizer-followups`
  - `ai-service` (future) — `/api/ai`
  - `scraper-service` (future) — `/api/scraper`
  - GraphQL — `/proxy/graphql`
- Health aggregation (`/health/ready` checks downstream services)

## Run locally

Start **hackathon-service first**, then gateway:

```bash
# Terminal 1
cd ../services/hackathon-service
cp .env.example .env
npm install && npm run dev

# Terminal 2
cd ../../gateway
# gateway/.env needs HACKATHON_SERVICE_URL, JWT_SERVICE_URL, and GATEWAY_INTERNAL_SECRET
npm install && npm run dev
```

Clients call **http://localhost:4000** only.

## Test

From `gateway/`:

```bash
npm test
```

Inspect routes: `GET http://localhost:4000/gateway/routes`
