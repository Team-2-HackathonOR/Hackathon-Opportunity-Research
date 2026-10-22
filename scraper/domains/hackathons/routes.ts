import type { Express, Request, Response } from 'express';
import {
  BATCH_QUERY_KEYS_TO_EXCLUDE,
  buildDevpostUrl,
  buildDevpostUrlFromQuery,
  fetchDevpostPage,
} from './devpost/client';
import { analyzePagination } from './pagination/analyzer';
import { mapHackathon, persistHackathons, readCachedHackathons } from './service';
import { parsePositiveInteger } from '../../shared/parsing';

// Route-level helpers keep HTTP-specific concerns close to the hackathon domain endpoints.
const shouldPersist = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(shouldPersist);
  }

  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes'].includes(value.toLowerCase());
};

// Single-page scraping returns normalized records plus pagination analysis for the current upstream payload.
const fetchHackathons = async (request: Request, response: Response): Promise<void> => {
  const sourceUrl = buildDevpostUrl(request);
  const requestedPage = parsePositiveInteger(request.query.page) ?? 1;

  try {
    const upstreamResponse = await fetchDevpostPage(sourceUrl);

    if (!upstreamResponse.ok) {
      response.status(502).json({
        error: 'Failed to fetch hackathons from Devpost.',
        sourceUrl,
        statusCode: upstreamResponse.statusCode,
      });
      return;
    }

    const payload = upstreamResponse.payload;
    const fetchedAt = new Date().toISOString();
    const hackathons = payload.hackathons.map(mapHackathon);
    const persistToMongoDb = shouldPersist(request.query.persist);
    const paginationAnalysis = await analyzePagination(payload, requestedPage);

    if (persistToMongoDb) {
      try {
        await persistHackathons(hackathons, sourceUrl, fetchedAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        response.status(500).json({
          error: 'Hackathons were scraped but could not be persisted to MongoDB.',
          sourceUrl,
          message,
        });
        return;
      }
    }

    response.json({
      sourceUrl,
      fetchedAt,
      total: payload.hackathons.length,
      paginationAnalysis,
      persisted: persistToMongoDb,
      hackathons,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    response.status(500).json({
      error: 'Unexpected error while scraping Devpost.',
      sourceUrl,
      message,
    });
  }
};

// Batch persistence walks the known page range and stores each normalized page in MongoDB.
const persistAllHackathons = async (request: Request, response: Response): Promise<void> => {
  const requestedStartPage =
    parsePositiveInteger(request.query.startPage) ?? parsePositiveInteger(request.query.page) ?? 1;
  const requestedMaxPages = parsePositiveInteger(request.query.maxPages);
  const firstPageUrl = buildDevpostUrlFromQuery(request.query, {
    excludedKeys: BATCH_QUERY_KEYS_TO_EXCLUDE,
    page: requestedStartPage,
  });

  try {
    const firstPageResponse = await fetchDevpostPage(firstPageUrl);

    if (!firstPageResponse.ok) {
      response.status(502).json({
        error: 'Failed to fetch the initial Devpost page for batch persistence.',
        sourceUrl: firstPageUrl,
        statusCode: firstPageResponse.statusCode,
      });
      return;
    }

    const firstPayload = firstPageResponse.payload;
    const paginationAnalysis = await analyzePagination(firstPayload, requestedStartPage);

    if (paginationAnalysis.totalPages === null) {
      response.status(502).json({
        error: 'The initial Devpost response did not expose enough pagination metadata to crawl all pages.',
        sourceUrl: firstPageUrl,
        paginationAnalysis,
      });
      return;
    }

    if (requestedStartPage > paginationAnalysis.totalPages) {
      response.status(400).json({
        error: 'Requested start page is outside the available Devpost page range.',
        requestedStartPage,
        totalPages: paginationAnalysis.totalPages,
      });
      return;
    }

    const finalPage =
      requestedMaxPages === null
        ? paginationAnalysis.totalPages
        : Math.min(paginationAnalysis.totalPages, requestedStartPage + requestedMaxPages - 1);
    const pagesRequested = finalPage - requestedStartPage + 1;
    const fetchedAt = new Date().toISOString();
    const uniqueHackathonIds = new Set<number>();
    let pagesPersisted = 0;
    let hackathonsPersisted = 0;
    let lastSuccessfulPage = requestedStartPage - 1;

    for (let page = requestedStartPage; page <= finalPage; page += 1) {
      const sourceUrl =
        page === requestedStartPage
          ? firstPageUrl
          : buildDevpostUrlFromQuery(request.query, {
              excludedKeys: BATCH_QUERY_KEYS_TO_EXCLUDE,
              page,
            });
      const payload = page === requestedStartPage ? firstPayload : null;
      const pageResponse = payload === null ? await fetchDevpostPage(sourceUrl) : null;

      if (pageResponse && !pageResponse.ok) {
        response.status(502).json({
          error: 'Batch persistence stopped because Devpost returned an error for a later page.',
          sourceUrl,
          statusCode: pageResponse.statusCode,
          requestedStartPage,
          requestedMaxPages,
          attemptedPage: page,
          lastSuccessfulPage,
          pagesRequested,
          pagesPersisted,
          hackathonsPersisted,
          uniqueHackathonsPersisted: uniqueHackathonIds.size,
          paginationAnalysis,
        });
        return;
      }

      const pagePayload = payload ?? pageResponse?.payload;

      if (!pagePayload) {
        response.status(500).json({
          error: 'Batch persistence stopped because a page payload could not be resolved.',
          sourceUrl,
          requestedStartPage,
          attemptedPage: page,
          lastSuccessfulPage,
        });
        return;
      }

      const hackathons = pagePayload.hackathons.map(mapHackathon);

      try {
        await persistHackathons(hackathons, sourceUrl, fetchedAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        response.status(500).json({
          error: 'Batch persistence stopped because MongoDB persistence failed.',
          sourceUrl,
          message,
          requestedStartPage,
          requestedMaxPages,
          attemptedPage: page,
          lastSuccessfulPage,
          pagesRequested,
          pagesPersisted,
          hackathonsPersisted,
          uniqueHackathonsPersisted: uniqueHackathonIds.size,
          paginationAnalysis,
        });
        return;
      }

      for (const hackathon of hackathons) {
        uniqueHackathonIds.add(hackathon.id);
      }

      pagesPersisted += 1;
      hackathonsPersisted += hackathons.length;
      lastSuccessfulPage = page;
    }

    response.json({
      sourceUrl: firstPageUrl,
      fetchedAt,
      requestedStartPage,
      requestedMaxPages,
      targetPageRange: {
        startPage: requestedStartPage,
        endPage: finalPage,
      },
      pagesRequested,
      pagesPersisted,
      hackathonsPersisted,
      uniqueHackathonsPersisted: uniqueHackathonIds.size,
      paginationAnalysis,
      persisted: true,
      cacheEndpoint: '/hackathons/cache',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    response.status(500).json({
      error: 'Unexpected error while persisting all Devpost hackathons.',
      sourceUrl: firstPageUrl,
      message,
    });
  }
};

// Cache reads serve the locally persisted snapshot without touching the upstream API.
const fetchCachedHackathons = async (_request: Request, response: Response): Promise<void> => {
  try {
    const hackathons = await readCachedHackathons();

    response.json({
      fetchedAt: new Date().toISOString(),
      total: hackathons.length,
      hackathons,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    response.status(500).json({
      error: 'Failed to read cached hackathons from MongoDB.',
      message,
    });
  }
};

// The route registrar keeps all hackathon-specific HTTP endpoints grouped in one domain module.
export const registerHackathonRoutes = (app: Express): void => {
  app.get('/hackathons', fetchHackathons);
  app.get('/hackathons/persist-all', persistAllHackathons);
  app.get('/hackathons/cache', fetchCachedHackathons);
};
