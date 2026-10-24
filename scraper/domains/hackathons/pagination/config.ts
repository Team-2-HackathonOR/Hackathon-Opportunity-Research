import { parsePositiveInteger } from '../../../shared/parsing';

// Pagination analyzer configuration is centralized here so defaults and env overrides live in one place.
const DEFAULT_AI_SYSTEM_PROMPT =
  'You analyze raw API JSON for pagination evidence. Return JSON only. Never invent fields or values.';
const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_AI_MODEL = 'gpt-4.1-mini';
const DEFAULT_AI_TIMEOUT_SECONDS = 60;
const DEFAULT_MAX_SIGNAL_ARRAY_ITEMS = 3;
const DEFAULT_MAX_PAGINATION_ANALYSIS_DEPTH = 6;

export type PaginationAnalyzerConfig = {
  aiSystemPrompt: string;
  maxSignalArrayItems: number;
  maxPaginationAnalysisDepth: number;
  ai: {
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
};

export const getPaginationAnalyzerConfig = (): PaginationAnalyzerConfig => {
  const apiKey = process.env.AI_API_KEY?.trim() ?? '';
  const timeoutSeconds =
    parsePositiveInteger(process.env.AI_TIMEOUT_SECONDS) ?? DEFAULT_AI_TIMEOUT_SECONDS;

  return {
    aiSystemPrompt: process.env.PAGINATION_AI_SYSTEM_PROMPT?.trim() || DEFAULT_AI_SYSTEM_PROMPT,
    maxSignalArrayItems:
      parsePositiveInteger(process.env.PAGINATION_MAX_SIGNAL_ARRAY_ITEMS) ??
      DEFAULT_MAX_SIGNAL_ARRAY_ITEMS,
    maxPaginationAnalysisDepth:
      parsePositiveInteger(process.env.PAGINATION_MAX_ANALYSIS_DEPTH) ??
      DEFAULT_MAX_PAGINATION_ANALYSIS_DEPTH,
    ai: {
      enabled: apiKey.length > 0,
      apiKey,
      baseUrl: process.env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL,
      model: process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL,
      timeoutMs: timeoutSeconds * 1000,
    },
  };
};
