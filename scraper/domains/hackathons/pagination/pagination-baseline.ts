import type { DevpostApiResponse } from '../../../models/hackathon';
import { collectPaginationSignalsDeterministically } from './pagination-signals';
import type {
PaginationAnalysis,
PaginationConfidence
} from './types';

// The deterministic analyzer computes totals directly from known fields when AI is unavailable.
export const analyzePaginationDeterministically = (
  payload: DevpostApiResponse,
  requestedPage: number,
): PaginationAnalysis => {
  const signals = collectPaginationSignalsDeterministically(payload);
  const explicitTotalCount =
    typeof payload.meta?.total_count === 'number' && payload.meta.total_count >= 0
      ? payload.meta.total_count
      : null;
  const explicitPerPage =
    typeof payload.meta?.per_page === 'number' && payload.meta.per_page > 0
      ? payload.meta.per_page
      : null;
  const explicitTotalPages =
    typeof payload.meta?.total_pages === 'number' && payload.meta.total_pages > 0
      ? payload.meta.total_pages
      : null;
  const inferredPerPage =
    explicitPerPage ??
    (requestedPage === 1 && payload.hackathons.length > 0 ? payload.hackathons.length : null);
  const totalPages =
    explicitTotalPages ??
    (explicitTotalCount !== null && inferredPerPage !== null
      ? Math.ceil(explicitTotalCount / inferredPerPage)
      : null);

  let confidence: PaginationConfidence = 'none';

  if (explicitTotalPages !== null || (explicitTotalCount !== null && explicitPerPage !== null)) {
    confidence = 'high';
  } else if (explicitTotalCount !== null && inferredPerPage !== null) {
    confidence = 'medium';
  } else if (signals.length > 0) {
    confidence = 'low';
  }

  let recommendation = 'No reliable page count was found in the first fetch response.';

  if (totalPages !== null) {
    recommendation = `Fetch pages 1 through ${totalPages} to enumerate the current Devpost hackathon catalog.`;
  } else if (explicitTotalCount !== null) {
    recommendation = `The response exposes a total count of ${explicitTotalCount}, but it does not expose enough pagination detail to calculate a safe last page.`;
  } else if (signals.length > 0) {
    recommendation = 'Pagination hints were detected, but none were strong enough to calculate the full page range.';
  }

  return {
    analysisEngine: 'deterministic',
    requestedPage,
    hackathonsOnPage: payload.hackathons.length,
    totalCount: explicitTotalCount,
    perPage: inferredPerPage,
    totalPages,
    hasMorePages: totalPages !== null ? requestedPage < totalPages : null,
    canFetchAllPages: totalPages !== null,
    confidence,
    signals,
    recommendation,
  };
};
