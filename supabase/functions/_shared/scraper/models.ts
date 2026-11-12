export type DevpostTheme = {
  id: number;
  name: string;
};

export type DevpostLocation = {
  icon: string;
  location: string;
};

export type DevpostPrizeCounts = {
  cash: number;
  other: number;
};

export type DevpostApiMeta = Record<string, unknown> & {
  total_count?: number;
  per_page?: number;
  page?: number;
  current_page?: number;
  total_pages?: number;
  next_page?: number | null;
  prev_page?: number | null;
  fuzzy?: boolean;
};

export type DevpostHackathon = {
  id: number;
  title: string;
  displayed_location?: DevpostLocation | null;
  open_state: string;
  thumbnail_url: string;
  url: string;
  time_left_to_submission: string;
  submission_period_dates: string;
  themes?: DevpostTheme[];
  prize_amount: string;
  prizes_counts: DevpostPrizeCounts;
  registrations_count: number;
  featured: boolean;
  organization_name: string;
  winners_announced: boolean;
  submission_gallery_url: string;
  start_a_submission_url: string;
  invite_only: boolean;
  managed_by_devpost_badge: boolean;
};

export type DevpostApiResponse = {
  hackathons: DevpostHackathon[];
  meta?: DevpostApiMeta;
};

export type ScrapedHackathon = {
  id: number;
  title: string;
  organization: string;
  location: string;
  status: string;
  url: string;
  thumbnailUrl: string;
  submissionPeriod: string;
  timeLeft: string;
  prizeAmount: string;
  prizeCounts: DevpostPrizeCounts;
  registrationsCount: number;
  themes: string[];
  featured: boolean;
  winnersAnnounced: boolean;
  submissionGalleryUrl: string;
  startSubmissionUrl: string;
  inviteOnly: boolean;
  managedByDevpost: boolean;
};
