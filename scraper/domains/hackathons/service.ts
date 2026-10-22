import { getHackathonsCollection, type StoredHackathon } from '../../mongodb';
import type { DevpostHackathon, ScrapedHackathon } from '../../models/hackathon';

// Hackathon normalization keeps the public API shape stable even when the upstream payload changes.
const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, '').trim();

const normalizeThumbnailUrl = (url: string): string => {
  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  return url;
};

export const mapHackathon = (hackathon: DevpostHackathon): ScrapedHackathon => ({
  id: hackathon.id,
  title: hackathon.title,
  organization: hackathon.organization_name,
  location: hackathon.displayed_location?.location ?? 'Unknown',
  status: hackathon.open_state,
  url: hackathon.url,
  thumbnailUrl: normalizeThumbnailUrl(hackathon.thumbnail_url),
  submissionPeriod: hackathon.submission_period_dates,
  timeLeft: hackathon.time_left_to_submission,
  prizeAmount: stripHtml(hackathon.prize_amount),
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

// Persistence uses bulk upserts so repeated crawls refresh records without creating duplicates.
export const persistHackathons = async (
  hackathons: ScrapedHackathon[],
  sourceUrl: string,
  fetchedAt: string,
): Promise<number> => {
  if (hackathons.length === 0) {
    return 0;
  }

  const collection = await getHackathonsCollection();
  const updatedAt = new Date().toISOString();
  const operations = hackathons.map((hackathon) => {
    const storedHackathon: StoredHackathon = {
      ...hackathon,
      fetchedAt,
      sourceUrl,
      updatedAt,
    };

    return {
      updateOne: {
        filter: { id: hackathon.id },
        update: {
          $set: storedHackathon,
        },
        upsert: true,
      },
    };
  });

  await collection.bulkWrite(operations, { ordered: false });

  return hackathons.length;
};

// Cache reads return a stable, presentation-ready snapshot sorted for deterministic client output.
export const readCachedHackathons = async (): Promise<StoredHackathon[]> =>
  getHackathonsCollection()
    .then((collection) => collection.find({}, { projection: { _id: 0 } }).toArray())
    .then((documents) => documents.sort((left, right) => left.title.localeCompare(right.title)));
