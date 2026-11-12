SET search_path TO hackathon_research, public;

DO $split_schema$
BEGIN
IF to_regclass('hackathon_research.v_source_evidence_appendix') IS NULL THEN
-- Live Codyza research model. The hackathon service reads and writes this schema.
-- public.hackathons is the retired flat table and is not used by the API.
CREATE SCHEMA IF NOT EXISTS hackathon_research;

SET search_path TO hackathon_research, public;

CREATE TYPE event_format AS ENUM (
    'in_person',
    'virtual',
    'hybrid',
    'unknown'
);

CREATE TYPE operational_status AS ENUM (
    'verified_apply_now',
    'verified_registration_upcoming',
    'monitor',
    'needs_confirmation',
    'not_eligible',
    'closed_expired',
    'rejected_unreliable'
);

CREATE TYPE evidence_confidence AS ENUM (
    'high',
    'medium',
    'low'
);

CREATE TYPE support_status AS ENUM (
    'provided',
    'partially_reimbursed',
    'application_based',
    'not_provided',
    'not_confirmed'
);

CREATE TYPE source_kind AS ENUM (
    'official_site',
    'registration_page',
    'rules_faq',
    'organizer_page',
    'official_social',
    'directory',
    'email_response',
    'pdf',
    'other'
);

CREATE TYPE track_kind AS ENUM (
    'theme',
    'track',
    'sponsor_challenge',
    'required_technology',
    'api_platform_requirement'
);

CREATE TYPE benefit_type AS ENUM (
    'prize',
    'sponsor_prize',
    'workshop',
    'mentor',
    'recruiter',
    'networking',
    'certificate',
    'credit',
    'incubator',
    'hardware',
    'participant_benefit',
    'career_exposure',
    'other'
);

CREATE TYPE milestone_type AS ENUM (
    'registration_deadline',
    'travel_grant_deadline',
    'acceptance_date',
    'confirmation_deadline',
    'pre_event_requirement',
    'registration_open',
    'event_start',
    'event_end',
    'other'
);

CREATE TYPE queue_type AS ENUM (
    'apply_now',
    'prepare_before_opening'
);

CREATE TYPE application_material_type AS ENUM (
    'registration_account',
    'resume',
    'portfolio_github',
    'student_verification',
    'essay_questions',
    'team_information',
    'project_idea',
    'referral_invite',
    'deadline',
    'post_acceptance_step',
    'other'
);

CREATE TYPE readiness_status AS ENUM (
    'not_started',
    'in_progress',
    'ready',
    'submitted',
    'not_applicable'
);

CREATE TYPE response_status AS ENUM (
    'draft',
    'sent',
    'responded',
    'closed',
    'no_response'
);

CREATE TYPE verification_result AS ENUM (
    'confirmed',
    'partially_confirmed',
    'needs_follow_up',
    'conflicting'
);

CREATE TYPE contribution_type AS ENUM (
    'discovery',
    'research',
    'verification',
    'shortlist',
    'follow_up',
    'deadline_tracking',
    'qa',
    'other'
);

CREATE TABLE team_members (
    member_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE,
    role_name TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
END IF;
END
$split_schema$;
