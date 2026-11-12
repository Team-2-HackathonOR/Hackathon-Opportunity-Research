import {
getPrimitiveValue
} from '../../../shared/parsing';
import { getPaginationAnalyzerConfig } from './config';
import type {
PaginationAnalysisSignal
} from './types';


// Deterministic key classification acts as the baseline understanding of common pagination field names.
export const classifyPaginationKeyDeterministically = (
  key: string,
  currentPath: string,
): Pick<PaginationAnalysisSignal, 'meaning' | 'confidence'> | null => {
  const normalizedKey = key.toLowerCase();
  const normalizedPath = currentPath.toLowerCase();

  if (normalizedKey === 'total_count' || normalizedKey === 'totalcount') {
    return {
      meaning: 'Total number of hackathons available across all pages.',
      confidence: 'high',
    };
  }

  if (normalizedKey === 'per_page' || normalizedKey === 'perpage') {
    return {
      meaning: 'Number of hackathons returned on each page.',
      confidence: 'high',
    };
  }

  if (
    normalizedKey === 'total_pages' ||
    normalizedKey === 'totalpages' ||
    normalizedKey === 'page_count' ||
    normalizedKey === 'pagecount'
  ) {
    return {
      meaning: 'Explicit total page count.',
      confidence: 'high',
    };
  }

  if (
    normalizedKey === 'page' ||
    normalizedKey === 'current_page' ||
    normalizedKey === 'currentpage'
  ) {
    return {
      meaning: 'Current page index for the API response.',
      confidence: 'medium',
    };
  }

  if (
    normalizedKey === 'next_page' ||
    normalizedKey === 'nextpage' ||
    normalizedKey === 'prev_page' ||
    normalizedKey === 'prevpage'
  ) {
    return {
      meaning: 'Pagination cursor pointing to a neighboring page.',
      confidence: 'medium',
    };
  }

  if (normalizedKey === 'limit' || normalizedKey === 'offset') {
    return {
      meaning: 'Offset/limit pagination signal.',
      confidence: 'medium',
    };
  }

  if (
    (normalizedKey === 'count' || normalizedKey === 'total') &&
    (normalizedPath.includes('.meta') || normalizedPath.includes('.pagination'))
  ) {
    return {
      meaning: 'Count-like field that may help estimate pagination coverage.',
      confidence: 'low',
    };
  }

  return null;
};

// The deterministic collector traverses the JSON tree and extracts only primitive values that look pagination-related.
export const collectPaginationSignalsDeterministically = (
  value: unknown,
  currentPath = 'payload',
  depth = 0,
): PaginationAnalysisSignal[] => {
  const config = getPaginationAnalyzerConfig();

  if (depth > config.maxPaginationAnalysisDepth || value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, config.maxSignalArrayItems)
      .flatMap((item, index) =>
        collectPaginationSignalsDeterministically(item, `${currentPath}[${index}]`, depth + 1),
      );
  }

  if (typeof value !== 'object') {
    return [];
  }

  const signals: PaginationAnalysisSignal[] = [];

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    const paginationHint = classifyPaginationKeyDeterministically(key, nextPath);
    const primitiveValue = getPrimitiveValue(nestedValue);

    if (paginationHint && primitiveValue !== undefined) {
      signals.push({
        path: nextPath,
        value: primitiveValue,
        meaning: paginationHint.meaning,
        confidence: paginationHint.confidence,
      });
    }

    signals.push(...collectPaginationSignalsDeterministically(nestedValue, nextPath, depth + 1));
  }

  return signals;
};
