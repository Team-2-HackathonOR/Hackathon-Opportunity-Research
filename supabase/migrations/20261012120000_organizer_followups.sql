-- Organizer follow-up log (Codyza Task 01 Section 16)

create table if not exists public.organizer_followups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  hackathon_id uuid references public.hackathons(id) on delete set null,
  event_name text not null,
  question text not null,
  contact_channel text,
  assigned_member text,
  sent_date date,
  response_status text not null default 'Pending' check (
    response_status in ('Pending', 'Sent', 'Replied', 'No response', 'Closed')
  ),
  confirmed_answer text
);

create index if not exists organizer_followups_hackathon_id_idx
  on public.organizer_followups (hackathon_id);

create index if not exists organizer_followups_response_status_idx
  on public.organizer_followups (response_status);

create trigger organizer_followups_set_updated_at
before update on public.organizer_followups
for each row execute function public.set_updated_at();

alter table public.organizer_followups enable row level security;

create policy "service role full access followups"
  on public.organizer_followups
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.organizer_followups is 'Codyza organizer contact and response log';
