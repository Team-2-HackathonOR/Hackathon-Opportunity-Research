# Devpost hackathon scraper

This service exposes an Express endpoint that scrapes hackathon data from `https://devpost.com/api/hackathons` and returns a cleaner JSON response.

MongoDB is wired so the scraper can persist normalized hackathons to a `hackathons` collection.

## Run

```bash
npm start
```

The server uses port `3000` by default. You can override it with `PORT`.

## MongoDB configuration

Set these variables in your local `.env` file before using the persistence routes:

- `MONGODB_CONNECTION_STRING`
- `MONGODB_DATABASE_NAME` (defaults to `hackathon-opportunity-research`)
- `MONGODB_COLLECTION_NAME` (defaults to `hackathons`)

To enable the AI-backed pagination analyzer, also set:

- `AI_API_KEY` - API key for an OpenAI-compatible provider
- `AI_BASE_URL` (defaults to `https://api.openai.com/v1`)
- `AI_MODEL` (defaults to `gpt-4.1-mini`)
- `AI_TIMEOUT_SECONDS` (defaults to `60`)
- `PAGINATION_AI_SYSTEM_PROMPT` - override the pagination-analysis system prompt
- `PAGINATION_MAX_SIGNAL_ARRAY_ITEMS` (defaults to `3`)
- `PAGINATION_MAX_ANALYSIS_DEPTH` (defaults to `6`)

## Docker

Build the image:

```bash
docker build -t scraper:latest .
```

The build stage compiles the entrypoint together with `models`, `domains`, and
`shared`. The runtime image contains the compiled output and production
dependencies only.

Run the container:

```bash
docker run --rm -p 3000:3000 --env-file .env scraper:latest
```

## Endpoints

- `GET /` - quick usage info
- `GET /health` - health check
- `GET /hackathons` - fetch and normalize Devpost hackathons, plus analyze pagination hints from the upstream JSON
- `GET /hackathons?persist=true` - fetch, normalize, and store hackathons in MongoDB
- `GET /hackathons/persist-all` - crawl the full Devpost pagination range and batch-store all discovered hackathons in MongoDB
- `GET /hackathons/cache` - return the cached MongoDB documents

Example:

```bash
curl "http://localhost:3000/hackathons?page=1"
```

The `/hackathons` response now includes a `paginationAnalysis` object. When `AI_API_KEY` is configured, the scraper asks an OpenAI-compatible model to identify pagination fields, summarize the page-count evidence, and recommend how many pages to fetch. If AI settings are not configured, the scraper falls back to the built-in deterministic analyzer.

Persist results to MongoDB:

```bash
curl "http://localhost:3000/hackathons?persist=true&page=1"
```

Persist the full catalog to MongoDB:

```bash
curl "http://localhost:3000/hackathons/persist-all?startPage=1"
```

For safer chunked imports, you can limit the batch size and resume later:

```bash
curl "http://localhost:3000/hackathons/persist-all?startPage=1&maxPages=25"
curl "http://localhost:3000/hackathons/persist-all?startPage=26&maxPages=25"
```