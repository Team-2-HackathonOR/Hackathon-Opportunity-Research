# Local run (gateway + services)

## 1. Database connection string

Supabase is **PostgreSQL hosting**. The service does not use the Supabase JS client.

1. Supabase Dashboard → **Settings → Database**
2. **Connection string** → **URI**
3. Copy and replace `[YOUR-PASSWORD]` with your database password

Example shape (region may vary):

```text
postgresql://postgres.qdnbwzyhuzgvosploprb:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

## 2. Hackathon service env

`services/hackathon-service/.env`:

```env
DATABASE_URL=postgresql://postgres.qdnbwzyhuzgvosploprb:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
PORT=4001
GATEWAY_INTERNAL_SECRET=local-dev-gateway-secret
```

Apply `supabase/auth/001_auth.sql` on the auth project. The hackathon service uses the scraper project's `hackathon_research` schema and does not read `app_auth.app_users`.

## 3. JWT service env

`jwt-service/.env` uses `AUTH_DATABASE_URL` for the auth project. If that variable is unset, the service uses `DATABASE_URL`. `JWT_SECRET` belongs only in this file. See `jwt-service/.env.example` for the seed accounts, `MAIL_SERVICE_URL`, and the `LDAP_*` variables.

## 3b. Mail service

Copy `services/mail-service/.env.example` to `services/mail-service/.env`.
Set `GATEWAY_INTERNAL_SECRET` to the same value as the gateway and configure
your actual SMTP host and credentials. The root launcher loads this file.

Set `MAIL_SERVICE_URL=http://127.0.0.1:4005` on `jwt-service`. Leave it unset to keep invite links in the API response without sending mail.

## 3c. ETL service

Copy `ETL/.env.example` to `ETL/.env` and configure `DATABASE_URL` for the
research database and `MONGODB_CONNECTION_STRING` for MongoDB.
See [ETL/Readme.md](../ETL/Readme.md) for optional AI configuration.

## 4. Gateway env

`gateway/.env`:

```env
PORT=4000
HACKATHON_SERVICE_URL=http://127.0.0.1:4001
JWT_SERVICE_URL=http://127.0.0.1:4004
GATEWAY_INTERNAL_SECRET=local-dev-gateway-secret
```

## 5. Install dependencies (once)

From repo root `Team-2`:

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2"
npm install
npm run install:all
npm run install:python
```

The Python setup command requires [uv](https://docs.astral.sh/uv/getting-started/installation/).
It selects Python 3.12 (downloading it if necessary), creates a separate `.venv`
inside each Python service, and installs its requirements.
The Python launch scripts use Windows virtual-environment paths.

## 6. Start all services together

After configuring the `.env` files and installing dependencies:

```powershell
npm run dev
```

The root `dev` script starts the hackathon service (4001), JWT service (4004),
scraper (3000), gateway (4000), static client (3001), mail service (4005),
and ETL service (8000). `concurrently` labels
each process and stops the others if one exits. Open
`http://localhost:3001` for the client; its `/api` requests are proxied to the
gateway. Configure `scraper/.env` and have MongoDB available if you need scraper
persistence.

Use `npm run dev:mail` or `npm run dev:etl` to run either Python service alone.
Both run with auto-reload and load their service-local `.env` file.
Restart the launcher after changing environment variables.

## 7. Test via gateway

```bash
curl http://localhost:4000/health/ready
curl -X POST http://localhost:4000/api/auth/login -H "content-type: application/json" -d "{\"email\":\"viewer@local\",\"password\":\"change-me-viewer\"}"
curl http://localhost:4000/api/hackathons -H "authorization: Bearer TOKEN"
```

`viewer` can read. `researcher` can create and update. `admin` can also call `/admin/*`.

## 8. Logs

With `npm run dev`, the terminal prints a readable line for each request. The same record is appended as JSON to `logs/gateway.log` and `logs/hackathon-service.log` when `LOG_FILE_PATH` is set. Startup prints `logging to stdout and file` when the file is in use.

Apply the latest SQL migration in the Supabase SQL editor before relying on the new table rules:

`supabase/migrations/20261019120000_table_rules_and_comments.sql`
