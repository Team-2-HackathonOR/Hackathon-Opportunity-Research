import {
parseNonNegativeInteger,
parsePositiveInteger,
toNullableBoolean
} from '../../../shared/parsing';
import type {
PaginationAnalysis,
PaginationConfidence,
PaginationKeyClassification,
PaginationModelSummary
} from './types';


export const isConfidence = (value: unknown): value is PaginationConfidence =>
  value === 'high' || value === 'medium' || value === 'low' || value === 'none';

// The AI response is normalized back into strict local types before the API uses it.
export const normalizePaginationClassifications = (value: unknown): PaginationKeyClassification[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const classifications: PaginationKeyClassification[] = [];

  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const candidate = item as Record<string, unknown>;

    if (
      typeof candidate.key === 'string' &&
      typeof candidate.meaning === 'string' &&
      isConfidence(candidate.confidence) &&
      candidate.confidence !== 'none'
    ) {
      classifications.push({
        key: candidate.key,
        path: typeof candidate.path === 'string' ? candidate.path : undefined,
        meaning: candidate.meaning,
        confidence: candidate.confidence,
      });
    }
  }

  return classifications;
};

export const normalizePaginationModelSummary = (
  value: unknown,
  fallback: PaginationAnalysis,
): PaginationModelSummary => {
  if (typeof value !== 'object' || value === null) {
    return {
      totalCount: fallback.totalCount,
      perPage: fallback.perPage,
      totalPages: fallback.totalPages,
      hasMorePages: fallback.hasMorePages,
      canFetchAllPages: fallback.canFetchAllPages,
      confidence: fallback.confidence,
      recommendation: fallback.recommendation,
    };
  }

  const candidate = value as Record<string, unknown>;
  const totalCount = parseNonNegativeInteger(candidate.totalCount) ?? fallback.totalCount;
  const perPage = parsePositiveInteger(candidate.perPage) ?? fallback.perPage;
  const totalPages = parsePositiveInteger(candidate.totalPages) ?? fallback.totalPages;
  const hasMorePages = toNullableBoolean(candidate.hasMorePages) ?? fallback.hasMorePages;
  const canFetchAllPages =
    typeof candidate.canFetchAllPages === 'boolean'
      ? candidate.canFetchAllPages
      : fallback.canFetchAllPages;
  const confidence = isConfidence(candidate.confidence)
    ? candidate.confidence
    : fallback.confidence;
  const recommendation =
    typeof candidate.recommendation === 'string' && candidate.recommendation.trim() !== ''
      ? candidate.recommendation
      : fallback.recommendation;

  return {
    totalCount,
    perPage,
    totalPages,
    hasMorePages,
    canFetchAllPages,
    confidence,
    recommendation,
  };
};
