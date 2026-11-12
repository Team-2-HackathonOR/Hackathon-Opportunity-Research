import type { Request,Response } from 'express';
import { getHackathonsCollection } from '../../mongodb';
import { parsePositiveInteger } from '../../shared/parsing';
import {
BATCH_QUERY_KEYS_TO_EXCLUDE,
buildDevpostUrlFromQuery,
fetchDevpostPage
} from './devpost/client';
import { analyzePagination } from './pagination/analyzer';
import { mapHackathon,persistHackathons } from './service';


// Batch persistence walks the known page range and stores each normalized page in MongoDB.
export const persistAllHackathons = async (request: Request, response: Response): Promise<void> => {
  const runTimestamp = request.get('x-pipeline-fetched-at');
  if (runTimestamp && (!Number.isFinite(Date.parse(runTimestamp)) ||
      new Date(runTimestamp).toISOString() !== runTimestamp)) {
    response.status(400).json({ error: 'The pipeline timestamp must be an ISO UTC timestamp.' });
    return;
  }
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
    const aiApiKey = request.get('x-ai-api-key')?.trim();
    if (aiApiKey && aiApiKey.length > 4096) {
      response.status(400).json({ error: 'The AI API key is too long.' });
      return;
    }
    const paginationAnalysis = await analyzePagination(firstPayload, requestedStartPage, aiApiKey);

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
    const fetchedAt = runTimestamp || new Date().toISOString();
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

    const runUniqueHackathonsPersisted = runTimestamp
      ? await (await getHackathonsCollection()).countDocuments({ fetchedAt })
      : undefined;
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
      ...(runTimestamp ? { runUniqueHackathonsPersisted } : {}),
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
