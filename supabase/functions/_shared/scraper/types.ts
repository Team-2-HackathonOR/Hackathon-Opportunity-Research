// Pagination types describe the AI/deterministic analysis contract shared with the API response.
export type PaginationConfidence = 'high' | 'medium' | 'low' | 'none';

export type PaginationAnalysisSignal = {
  path: string;
  value: string | number | boolean | null;
  meaning: string;
  confidence: Exclude<PaginationConfidence, 'none'>;
};

export type PaginationKeyClassification = {
  key: string;
  path?: string;
  meaning: string;
  confidence: Exclude<PaginationConfidence, 'none'>;
};

export type PaginationAnalyzerEngine = 'ai' | 'deterministic';

export type PaginationModelSummary = {
  totalCount: number | null;
  perPage: number | null;
  totalPages: number | null;
  hasMorePages: boolean | null;
  canFetchAllPages: boolean;
  confidence: PaginationConfidence;
  recommendation: string;
};

export type PaginationModelResponse = {
  classifications: PaginationKeyClassification[];
  summary: PaginationModelSummary;
};

export type PaginationAnalysis = {
  analysisEngine: PaginationAnalyzerEngine;
  requestedPage: number;
  hackathonsOnPage: number;
  totalCount: number | null;
  perPage: number | null;
  totalPages: number | null;
  hasMorePages: boolean | null;
  canFetchAllPages: boolean;
  confidence: PaginationConfidence;
  signals: PaginationAnalysisSignal[];
  recommendation: string;
};
