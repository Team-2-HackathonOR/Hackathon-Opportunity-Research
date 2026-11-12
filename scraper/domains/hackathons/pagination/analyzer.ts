import type { DevpostApiResponse } from '../../../models/hackathon';
import {
getPrimitiveValue
} from '../../../shared/parsing';
import { getPaginationAnalyzerConfig } from './config';
import { analyzePaginationDeterministically } from './pagination-baseline';
import { requestPaginationModelResponse } from './pagination-client';
import { classifyPaginationKeyDeterministically } from './pagination-signals';
import type {
PaginationAnalysis,
PaginationAnalysisSignal,
PaginationKeyClassification
} from './types';

// AI classifications are preferred, but deterministic inference still fills any gaps the model leaves behind.
export const classifyPaginationKey = (
  key: string,
  currentPath: string,
  classifications: PaginationKeyClassification[],
): Pick<PaginationAnalysisSignal, 'meaning' | 'confidence'> | null => {
  const exactMatch = classifications.find(
    (classification) =>
      classification.path === currentPath ||
      (classification.path === undefined && classification.key === key),
  );

  if (exactMatch) {
    return {
      meaning: exactMatch.meaning,
      confidence: exactMatch.confidence,
    };
  }

  return classifyPaginationKeyDeterministically(key, currentPath);
};

export const collectPaginationSignals = (
  value: unknown,
  classifications: PaginationKeyClassification[],
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
        collectPaginationSignals(item, classifications, `${currentPath}[${index}]`, depth + 1),
      );
  }

  if (typeof value !== 'object') {
    return [];
  }

  const signals: PaginationAnalysisSignal[] = [];

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    const paginationHint = classifyPaginationKey(key, nextPath, classifications);
    const primitiveValue = getPrimitiveValue(nestedValue);

    if (paginationHint && primitiveValue !== undefined) {
      signals.push({
        path: nextPath,
        value: primitiveValue,
        meaning: paginationHint.meaning,
        confidence: paginationHint.confidence,
      });
    }

    signals.push(...collectPaginationSignals(nestedValue, classifications, nextPath, depth + 1));
  }

  return signals;
};

export const analyzePagination = async (
  payload: DevpostApiResponse,
  requestedPage: number,
  apiKeyOverride?: string,
): Promise<PaginationAnalysis> => {
  const fallbackAnalysis = analyzePaginationDeterministically(payload, requestedPage);
  const modelResponse = await requestPaginationModelResponse(
    payload,
    requestedPage,
    fallbackAnalysis,
    apiKeyOverride,
  );
  const signals = collectPaginationSignals(payload, modelResponse.classifications);
  const config = getPaginationAnalyzerConfig(apiKeyOverride);

  return {
    analysisEngine: config.ai.enabled ? 'ai' : 'deterministic',
    requestedPage,
    hackathonsOnPage: payload.hackathons.length,
    totalCount: modelResponse.summary.totalCount,
    perPage: modelResponse.summary.perPage,
    totalPages: modelResponse.summary.totalPages,
    hasMorePages: modelResponse.summary.hasMorePages,
    canFetchAllPages: modelResponse.summary.canFetchAllPages,
    confidence: modelResponse.summary.confidence,
    signals,
    recommendation: modelResponse.summary.recommendation,
  };
};
