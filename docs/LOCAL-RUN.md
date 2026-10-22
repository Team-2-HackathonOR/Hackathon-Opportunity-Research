# Local run (gateway + hackathon-service)

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

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2\services\mail-service"
py -3 -m pip install -r requirements.txt
$env:GATEWAY_INTERNAL_SECRET="local-dev-gateway-secret"
$env:SMTP_HOST="smtp.example.com"
py -3 -m uvicorn main:app --host 127.0.0.1 --port 4005
```

Set `MAIL_SERVICE_URL=http://127.0.0.1:4005` on `jwt-service`. Leave it unset to keep invite links in the API response without sending mail.

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
npm run install:all
```

## 6. Start (three terminals — use full paths, not `...`)

**Terminal 1 — JWT service**

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2\jwt-service"
npm run dev
```

**Terminal 2 — hackathon service**

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2\services\hackathon-service"
npm run dev
```

**Terminal 3 — gateway**

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2\gateway"
npm run dev
```

**Or from repo root:**

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2"
npm run dev:jwt
# separate terminals:
npm run dev:hackathon
npm run dev:gateway
```

**Or auto-open three windows:**

```powershell
cd "D:\AIWorks\Codyza\HACKATHON OPPORTUNITY RESEARCH\Team-2"
.\scripts\start-dev.ps1
```

Do **not** run `npm run dev` from `Team-2` alone until `package.json` exists at root (use commands above).

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
