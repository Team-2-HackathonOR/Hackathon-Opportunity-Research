-- Codyza Task 01: master hackathon research database (Day 1 core)

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.hackathons (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  event_name text not null,
  organizer text,
  official_website text not null,
  registration_link text,
  rules_faq_url text,

  city text,
  state_region text,
  country text,
  venue text,
  format text check (format in ('in_person', 'virtual', 'hybrid')),

  event_start date,
  event_end date,
  registration_deadline timestamptz,
  registration_status text,
  last_verified_date date,

  student_eligibility text,
  outside_school_eligibility text,
  international_student_wording text,
  age_rules text,
  team_size text,
  solo_team_formation_rules text,

  registration_fee text,
  travel_support text,
  lodging text,
  meals text,
  reimbursement_conditions text,

  technical_tracks text,
  ai_policy text,
  pre_existing_code_policy text,
  ip_terms text,
  judging_criteria text,
  prizes text,
  sponsor_recruiting_benefits text,
  application_requirements text,
  organizer_contact text,

  evidence_links jsonb not null default '[]'::jsonb,
  unresolved_questions text,

  researcher_name text,
  verifier_name text,

  status text not null default 'Needs Confirmation' check (
    status in (
      'Verified - Apply Now',
      'Verified - Registration Upcoming',
      'Monitor',
      'Needs Confirmation',
      'Not Eligible',
      'Closed/Expired',
      'Rejected as Unreliable'
    )
  ),
  confidence text not null default 'Low' check (
    confidence in ('High', 'Medium', 'Low')
  ),

  is_shortlisted boolean not null default false,
  shortlist_rationale text
);

create unique index if not exists hackathons_official_website_unique
  on public.hackathons (lower(trim(official_website)));

create index if not exists hackathons_status_idx on public.hackathons (status);
create index if not exists hackathons_registration_deadline_idx on public.hackathons (registration_deadline);
create index if not exists hackathons_format_idx on public.hackathons (format);

create trigger hackathons_set_updated_at
before update on public.hackathons
for each row execute function public.set_updated_at();

alter table public.hackathons enable row level security;

-- Day 1: service role (gateway) bypasses RLS. Add authenticated policies when client uses Supabase Auth.
create policy "service role full access"
  on public.hackathons
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.hackathons is 'Codyza Team 02 Task 01 master hackathon research records';
