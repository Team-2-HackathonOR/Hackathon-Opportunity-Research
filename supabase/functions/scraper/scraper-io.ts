import { stagingStore,type StagingStore } from '../_shared/staging-storage.ts';
import { analyzePagination } from '../_shared/scraper/analyzer.ts';
import { requestJson,type JsonResult } from '../_shared/scraper/http.ts';
import type { DevpostApiResponse,DevpostHackathon,ScrapedHackathon } from '../_shared/scraper/models.ts';


export const DEVPOST_URL = 'https://devpost.com/api/hackathons';

export const MAX_PAGE_ITEMS = 1000;

export const MAX_CACHE_ITEMS = 10000;

export const mapHackathon = (hackathon: DevpostHackathon): ScrapedHackathon => ({
  id: hackathon.id,
  title: hackathon.title,
  organization: hackathon.organization_name,
  location: hackathon.displayed_location?.location ?? 'Unknown',
  status: hackathon.open_state,
  url: hackathon.url,
  thumbnailUrl: hackathon.thumbnail_url.startsWith('//') ? `https:${hackathon.thumbnail_url}` : hackathon.thumbnail_url,
  submissionPeriod: hackathon.submission_period_dates,
  timeLeft: hackathon.time_left_to_submission,
  prizeAmount: hackathon.prize_amount.replace(/<[^>]*>/g, '').trim(),
  prizeCounts: hackathon.prizes_counts,
  registrationsCount: hackathon.registrations_count,
  themes: hackathon.themes?.map((theme) => theme.name) ?? [],
  featured: hackathon.featured,
  winnersAnnounced: hackathon.winners_announced,
  submissionGalleryUrl: hackathon.submission_gallery_url,
  startSubmissionUrl: hackathon.start_a_submission_url,
  inviteOnly: hackathon.invite_only,
  managedByDevpost: hackathon.managed_by_devpost_badge,
});

export const buildDevpostUrl = (query: URLSearchParams, batch: boolean, page?: number): string => {
  const url = new URL(DEVPOST_URL);
  const excluded = new Set(batch ? ['persist', 'page', 'startPage', 'maxPages'] : ['persist']);
  for (const [key, value] of query) {
    if (!excluded.has(key)) url.searchParams.append(key, value);
  }
  if (page !== undefined) url.searchParams.set('page', String(page));
  return url.toString();
};

export const validPipelineTimestamp = (value: string): boolean =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export type Dependencies = {
  store: StagingStore;
  page: (url: string) => Promise<JsonResult<DevpostApiResponse>>;
  analyze: typeof analyzePagination;
  now: () => string;
};

export const defaults: Dependencies = {
  store: stagingStore,
  page: (url) => requestJson<DevpostApiResponse>(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'devpost-scraper/1.0' },
    timeoutMs: 20000,
  }),
  analyze: analyzePagination,
  now: () => new Date().toISOString(),
};

export async function persist(deps: Dependencies, hackathons: ScrapedHackathon[], sourceUrl: string, fetchedAt: string) {
  if (!hackathons.length) return;
  const updatedAt = deps.now();
  await deps.store.persist(hackathons.map((hackathon) => ({ ...hackathon, fetchedAt, sourceUrl, updatedAt })));
}

export async function loadPage(deps: Dependencies, url: string) {
  const response = await deps.page(url);
  if (response.ok && (!response.body || !Array.isArray(response.body.hackathons) ||
      response.body.hackathons.length > MAX_PAGE_ITEMS)) {
    throw new Error('Invalid or oversized Devpost response.');
  }
  return response;
}
