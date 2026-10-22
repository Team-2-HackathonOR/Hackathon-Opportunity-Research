# ETL database schema and API

This folder contains:

- the PostgreSQL schema for the Codyza hackathon-opportunity research workflow
- a Python FastAPI insert-only API
- an ETL pipeline that can ingest raw records from MongoDB or uploaded files
- AI-based normalization using an OpenAI-compatible API

## Files

- `hackathon_research_schema.sql` - core DDL, enums, tables, indexes, triggers, and reporting views
- `requirements.txt` - Python dependencies for the API and ETL pipeline
- `.env.example` - required environment variables
- `main.py` - FastAPI application entry point
- `app/` - ORM models, Pydantic schemas, ETL services, and normalization logic

## What the schema covers

The schema is designed to support the required deliverables from the document:

- master hackathon database
- Codyza shortlist
- Apply Now queue
- Prepare Before Opening queue
- deadline and monitoring tracker
- organizer follow-up log
- source/evidence appendix
- individual contribution record

## Design notes

- Unknown facts should stay `NULL` unless the team has a verified value.
- Explanations such as "Not publicly confirmed" or "Needs organizer confirmation" belong in the relevant notes or question fields.
- One event has one master record, with child tables for evidence, categories, tracks, benefits, milestones, verification history, and follow-up activity.
- Shortlisted events are modeled separately so an event can exist in the master database before it is recommended.

## Usage

Run the script in PostgreSQL:

```sql
\i hackathon_research_schema.sql
```

## FastAPI application

Install dependencies:

```bash
pip install -r requirements.txt
```

Or, if you are using `uv`, sync the project environment from [pyproject.toml](./pyproject.toml):

```bash
uv sync
```

Create a local environment file from `.env.example`, then start the API:

```bash
uvicorn main:app --reload
```

With `uv`, you can now run the FastAPI CLI directly:

```bash
uv run fastapi dev main.py
```

Before running the ETL locally or in Kubernetes, set these required secrets:

Use `postgresql+psycopg://USER:PASSWORD@HOST:5432/hackathons` for Psycopg 3.
Bare `postgresql://` and `postgres://` URLs also select the installed Psycopg 3
driver. Explicit driver selections are preserved.

- `DATABASE_URL` - PostgreSQL SQLAlchemy URL, for example `postgresql+psycopg://USERNAME:PASSWORD@HOST:5432/hackathons`
- `AI_API_KEY` - API key for the configured OpenAI-compatible provider

## Database initialization

The PostgreSQL DDL lives in [hackathon_research_schema.sql](./hackathon_research_schema.sql). To create the target database from `DATABASE_URL` and apply the schema automatically:

```bash
uv run python init_db.py
```

The script:

- connects to the PostgreSQL server using `DATABASE_URL`
- creates the target database if it does not exist
- applies the schema file once
- skips re-applying if the `hackathon_research.team_members` table already exists

## One-command MongoDB import

To extract records from MongoDB, normalize them, and insert them into PostgreSQL:

```bash
uv run python import_mongodb.py --limit 1000
```

Recommended operator command when you want one explicit retry for AI-only normalization failures:

```bash
uv run python import_mongodb.py --limit 1000 --retry-failed-without-ai
```

Useful options:

- `--no-ai` - skip AI normalization entirely
- `--database-name <name>` - override the MongoDB database from settings
- `--collection-name <name>` - override the MongoDB collection from settings
- `--output-json` - print the full import result as JSON

The command exits non-zero if any failures remain after the requested import pass or retry pass.

## Docker

Build the ETL image:

```bash
docker build -t team2-etl:latest .
```

Run the container:

```bash
docker run --rm -p 8000:8000 --env-file .env team2-etl:latest
```

The container starts the API with:

```bash
uv run --no-sync fastapi run main.py --host 0.0.0.0 --port 8000
```

## Kubernetes deployment note

When MongoDB runs on your computer and Kubernetes runs in Minikube, configure
`MONGODB_CONNECTION_STRING` in both ETL and scraper secrets with
`host.minikube.internal:27017`. `localhost` inside a pod refers to that pod,
not your computer. Restart both deployments after changing their secrets.

The Kubernetes manifests and [skaffold.yaml](../skaffold.yaml) expect the ETL image to be pushed to a registry for non-local clusters. If you deploy to a shared or remote cluster, set a default repo so Skaffold can publish `team2-etl` instead of leaving it available only in the local Docker daemon.

## Insert-only endpoints

- `POST /team-members` - insert a team member
- `POST /events` - insert one fully normalized event plus nested related records
- `POST /etl/import/mongodb` - extract raw records from MongoDB, normalize them, and insert them
- `POST /etl/import/file` - upload `.json`, `.jsonl`, or `.csv` records, normalize them, and insert them

## AI normalization

The ETL pipeline performs a base deterministic mapping first, then optionally calls an OpenAI-compatible `/chat/completions` API to refine the normalized record.

When AI normalization is enabled, the ETL also fetches up to a small set of candidate source pages such as the official site, registration page, and rules/FAQ page. The fetched page text is included in the AI prompt so the model can populate more of the database fields from primary-source evidence.

If a record includes `sourceUrl`, the enricher now fetches that source first. For JSON directory sources such as the Devpost hackathon feed, it extracts the matching record, discovers the linked event pages from that feed, and then navigates those pages to gather more evidence for the schema fields.

Relevant AI website-enrichment settings:

- `AI_WEB_FETCH_TIMEOUT_SECONDS` - per-request timeout for source-page fetches
- `AI_WEB_FETCH_MAX_CHARS` - maximum text captured from each fetched page
- `AI_WEB_FETCH_MAX_URLS` - maximum number of URLs fetched per record
- `AI_WEB_FETCH_MAX_DISCOVERED_URLS` - maximum number of extra URLs discovered from `sourceUrl` or fetched pages

Important behavior:

- unknown facts remain null
- AI normalization does not silently fall back if the provider fails
- website fetch issues are recorded in `unresolved_questions`
- AI can draft structured `application_requirement_items`, `shortlist_entry`, `organizer_follow_ups`, and `verifications` when the fetched evidence supports them
- `verifications` still require a valid internal `verifier_id` or `primary_researcher_id` so the ETL can assign `checked_by_member_id`
- when `--primary-researcher-id` and/or `--verifier-id` are provided, the ETL automatically creates baseline `contribution_log` rows for research and verification ownership
- uploaded or MongoDB records are inserted as new rows only
- duplicate or invalid inserts are returned in the ETL failure list

## Included reporting views

The schema also includes ready-to-query views for:

- shortlist
- Apply Now queue
- Prepare Before Opening queue
- travel-supported opportunities
- virtual/hybrid opportunities
- upcoming/monitoring list
- deadlines in the next 7 days
- deadlines in the next 30 days
- source/evidence appendix
