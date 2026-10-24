import type { Request } from 'express';
import type { DevpostApiResponse } from '../../../models/hackathon';
import { requestJson } from '../../../shared/http';

// Devpost-specific constants and query rules live together so upstream request behavior stays centralized.
const DEVPOST_API_URL = 'https://devpost.com/api/hackathons';
const DEVPOST_REQUEST_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'devpost-scraper/1.0',
} as const;

export const SCRAPE_QUERY_KEYS_TO_EXCLUDE = new Set(['persist']);
export const BATCH_QUERY_KEYS_TO_EXCLUDE = new Set(['persist', 'page', 'startPage', 'maxPages']);

// URL builders preserve user filters while stripping internal control parameters from upstream requests.
export const buildDevpostUrlFromQuery = (
  query: Request['query'],
  options?: {
    excludedKeys?: Set<string>;
    page?: number;
  },
): string => {
  const url = new URL(DEVPOST_API_URL);
  const excludedKeys = options?.excludedKeys ?? new Set<string>();

  for (const [key, value] of Object.entries(query)) {
    if (excludedKeys.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          url.searchParams.append(key, item);
        }
      }
      continue;
    }

    if (typeof value === 'string') {
      url.searchParams.set(key, value);
    }
  }

  if (typeof options?.page === 'number') {
    url.searchParams.set('page', String(options.page));
  }

  return url.toString();
};

export const buildDevpostUrl = (request: Request): string =>
  buildDevpostUrlFromQuery(request.query, { excludedKeys: SCRAPE_QUERY_KEYS_TO_EXCLUDE });

// The Devpost client wraps the shared JSON transport with the hackathon API's request/response contract.
export const fetchDevpostPage = async (
  sourceUrl: string,
): Promise<
  | {
      ok: true;
      payload: DevpostApiResponse;
    }
  | {
      ok: false;
      statusCode: number;
    }
> => {
  const upstreamResponse = await requestJson<DevpostApiResponse>(sourceUrl, {
    headers: { ...DEVPOST_REQUEST_HEADERS },
  });

  if (!upstreamResponse.ok) {
    return {
      ok: false,
      statusCode: upstreamResponse.statusCode,
    };
  }

  return {
    ok: true,
    payload: upstreamResponse.body,
  };
};
