import { json } from '../_shared/runtime.ts';
import { StorageError,storageFailure } from '../_shared/service-errors.ts';
import { parsePositiveInteger } from '../_shared/scraper/parsing.ts';
import { buildDevpostUrl,defaults,Dependencies,loadPage,mapHackathon,MAX_CACHE_ITEMS,persist,validPipelineTimestamp } from './scraper-io.ts';

export function createScraperHandler(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (request: Request, path: string): Promise<Response> => {
    const query = new URL(request.url).searchParams;
    if (request.method === 'GET' && path === '/') {
      return json({ message: 'Devpost hackathon scraper is running.', endpoints: {
        health: '/health', scrape: '/hackathons', scrapeAndPersist: '/hackathons?persist=true&page=1',
        persistAll: '/hackathons/persist-all?startPage=1', cache: '/hackathons/cache',
      } });
    }
    if (request.method === 'GET' && path === '/health') return json({ status: 'ok' });
    if (request.method === 'POST' && path === '/hackathons/reset') {
      if (request.headers.has('x-user-id') || request.headers.has('x-user-role')) {
        return json({ error: 'Database resets require an internal pipeline caller.' }, 403);
      }
      try {
        return json({ reset: true, deletedRecords: await deps.store.reset() });
      } catch (error) {
        return json(storageFailure(error), 500);
      }
    }
    if (request.method === 'GET' && (path === '/hackathons/cache' || path === '/hackathons/cached')) {
      try {
        const documents = await deps.store.read(null, null, MAX_CACHE_ITEMS);
        documents.sort((left, right) => String(left.title).localeCompare(String(right.title)));
        return json({ fetchedAt: deps.now(), total: documents.length, hackathons: documents });
      } catch (error) {
        return json(storageFailure(error), 500);
      }
    }
    if (request.method !== 'GET' || (path !== '/hackathons' && path !== '/hackathons/persist-all')) {
      return json({ error: 'Not found.' }, 404);
    }

    const batch = path === '/hackathons/persist-all';
    const timestamp = request.headers.get('x-pipeline-fetched-at');
    const apiKey = request.headers.get('x-ai-api-key')?.trim();
    if (apiKey && apiKey.length > 4096) return json({ error: 'The AI API key is too long.' }, 400);
    if (batch && timestamp !== null && !validPipelineTimestamp(timestamp)) {
      return json({ error: 'The pipeline timestamp must be an ISO UTC timestamp.' }, 400);
    }
    if (batch && (query.getAll('maxPages').length !== 1 || query.get('maxPages') !== '1')) {
      return json({ error: 'Edge batch persistence requires maxPages=1; call one page at a time.' }, 400);
    }
    const startPage = batch
      ? parsePositiveInteger(query.get('startPage')) ?? parsePositiveInteger(query.get('page')) ?? 1
      : parsePositiveInteger(query.get('page')) ?? 1;
    const sourceUrl = buildDevpostUrl(query, batch, batch ? startPage : undefined);
    try {
      const upstream = await loadPage(deps, sourceUrl);
      if (!upstream.ok) {
        return json({
          error: batch ? 'Failed to fetch the initial Devpost page for batch persistence.' : 'Failed to fetch hackathons from Devpost.',
          sourceUrl, statusCode: upstream.statusCode,
        }, 502);
      }
      const payload = upstream.body;
      const fetchedAt = batch && timestamp ? timestamp : deps.now();
      const hackathons = payload.hackathons.map(mapHackathon);
      const paginationAnalysis = await deps.analyze(payload, startPage, apiKey);
      if (batch && paginationAnalysis.totalPages === null) {
        return json({ error: 'The initial Devpost response did not expose enough pagination metadata to crawl all pages.', sourceUrl, paginationAnalysis }, 502);
      }
      if (batch && startPage > paginationAnalysis.totalPages!) {
        return json({ error: 'Requested start page is outside the available Devpost page range.', requestedStartPage: startPage, totalPages: paginationAnalysis.totalPages }, 400);
      }
      const persistToStorage = batch || query.getAll('persist').some((value) => ['1', 'true', 'yes'].includes(value.toLowerCase()));
      if (persistToStorage) {
        try {
          await persist(deps, hackathons, sourceUrl, fetchedAt);
        } catch (error) {
          if (!batch) return json({ ...storageFailure(error), sourceUrl }, 500);
          return json({ ...storageFailure(error), sourceUrl,
            requestedStartPage: startPage, requestedMaxPages: 1, attemptedPage: startPage,
            lastSuccessfulPage: startPage - 1, pagesRequested: 1, pagesPersisted: 0,
            hackathonsPersisted: 0, uniqueHackathonsPersisted: 0, paginationAnalysis }, 500);
        }
      }
      if (!batch) return json({ sourceUrl, fetchedAt, total: hackathons.length, paginationAnalysis, persisted: persistToStorage, hackathons });
      const runUniqueHackathonsPersisted = timestamp
        ? await deps.store.count(fetchedAt)
        : undefined;
      return json({
        sourceUrl, fetchedAt, requestedStartPage: startPage, requestedMaxPages: 1,
        targetPageRange: { startPage, endPage: startPage }, pagesRequested: 1, pagesPersisted: 1,
        hackathonsPersisted: hackathons.length, uniqueHackathonsPersisted: new Set(hackathons.map((item) => item.id)).size,
        ...(timestamp ? { runUniqueHackathonsPersisted } : {}), paginationAnalysis, persisted: true,
        cacheEndpoint: '/hackathons/cache',
      });
    } catch (error) {
      if (error instanceof StorageError) return json({ ...storageFailure(error), sourceUrl }, 500);
      console.error("Scraper request failed.", { kind: error instanceof Error ? error.name : "unknown" });
      return json({ error: batch ? "Unexpected error while persisting a Devpost page." : "Unexpected error while scraping Devpost.", sourceUrl }, 500);
    }
  };
}

export const handleScraper = createScraperHandler();
