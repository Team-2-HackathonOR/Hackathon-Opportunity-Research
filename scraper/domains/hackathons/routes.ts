import type { Express,Request,Response } from 'express';
import { getHackathonsCollection } from '../../mongodb';
import { parsePositiveInteger } from '../../shared/parsing';
import { persistAllHackathons } from './batch-route';
import {
buildDevpostUrl,
fetchDevpostPage
} from './devpost/client';
import { analyzePagination } from './pagination/analyzer';
import { mapHackathon,persistHackathons,readCachedHackathons } from './service';

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
  app.post('/hackathons/reset', async (request, response) => {
    if (request.get('x-user-id') || request.get('x-user-role')) {
      response.status(403).json({ error: 'Database resets require an internal pipeline caller.' });
      return;
    }
    try {
      const collection = await getHackathonsCollection();
      const result = await collection.deleteMany({});
      console.warn('Pipeline cleared scraper records:', result.deletedCount);
      response.json({ reset: true, deletedRecords: result.deletedCount });
    } catch (error) {
      console.error('Pipeline scraper reset failed:', error);
      response.status(500).json({ error: 'Failed to reset scraper records.' });
    }
  });
  app.get('/hackathons', fetchHackathons);
  app.get('/hackathons/persist-all', persistAllHackathons);
  app.get('/hackathons/cache', fetchCachedHackathons);
};
