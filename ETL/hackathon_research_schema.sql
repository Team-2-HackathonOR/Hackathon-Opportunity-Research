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

CREATE TABLE events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_name TEXT NOT NULL,
    organizer_name TEXT,
    host_entity TEXT,
    official_website TEXT,
    registration_link TEXT,
    rules_faq_link TEXT,
    official_domain TEXT,
    registration_platform TEXT,
    city TEXT,
    state_region TEXT,
    country TEXT,
    venue TEXT,
    format event_format NOT NULL DEFAULT 'unknown',
    event_start_date DATE,
    event_end_date DATE,
    event_timezone TEXT,
    registration_deadline_at TIMESTAMPTZ,
    registration_status TEXT,
    acceptance_date DATE,
    waitlist_information TEXT,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    student_eligibility TEXT,
    outside_school_eligibility TEXT,
    international_student_wording TEXT,
    age_rules TEXT,
    geographic_restrictions TEXT,
    invitation_requirements TEXT,
    team_size_min SMALLINT,
    team_size_max SMALLINT,
    solo_participation_policy TEXT,
    team_formation_rules TEXT,
    all_members_must_register BOOLEAN,
    registration_fee_amount NUMERIC(10, 2),
    registration_fee_currency CHAR(3),
    registration_fee_notes TEXT,
    travel_support support_status NOT NULL DEFAULT 'not_confirmed',
    lodging_support support_status NOT NULL DEFAULT 'not_confirmed',
    meals_support support_status NOT NULL DEFAULT 'not_confirmed',
    local_transport_support support_status NOT NULL DEFAULT 'not_confirmed',
    travel_support_notes TEXT,
    reimbursement_conditions TEXT,
    expenses_paid_upfront BOOLEAN,
    judging_criteria TEXT,
    submission_format TEXT,
    project_start_rules TEXT,
    pre_existing_code_policy TEXT,
    ai_tool_policy TEXT,
    open_source_rules TEXT,
    data_restrictions TEXT,
    demo_video_requirements TEXT,
    intellectual_property_terms TEXT,
    application_requirements TEXT,
    organizer_contact_summary TEXT,
    unresolved_questions TEXT,
    legitimacy_notes TEXT,
    risk_flags TEXT,
    operational_status operational_status NOT NULL,
    evidence_confidence evidence_confidence NOT NULL,
    next_action TEXT,
    primary_researcher_id BIGINT REFERENCES team_members(member_id) ON DELETE SET NULL,
    verifier_id BIGINT REFERENCES team_members(member_id) ON DELETE SET NULL,
    duplicate_of_event_id BIGINT REFERENCES events(event_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_event_dates CHECK (
        event_end_date IS NULL
        OR event_start_date IS NULL
        OR event_end_date >= event_start_date
    ),
    CONSTRAINT chk_team_size CHECK (
        team_size_min IS NULL
        OR team_size_max IS NULL
        OR team_size_max >= team_size_min
    ),
    CONSTRAINT chk_fee_amount CHECK (
        registration_fee_amount IS NULL
        OR registration_fee_amount >= 0
    ),
    CONSTRAINT chk_currency_code CHECK (
        registration_fee_currency IS NULL
        OR registration_fee_currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT chk_not_self_duplicate CHECK (
        duplicate_of_event_id IS NULL
        OR duplicate_of_event_id <> event_id
    )
);

CREATE TABLE event_categories (
    category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name TEXT NOT NULL UNIQUE
);

CREATE TABLE event_category_assignments (
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES event_categories(category_id) ON DELETE RESTRICT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event_id, category_id)
);

CREATE TABLE event_tracks (
    track_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    track_type track_kind NOT NULL,
    track_name TEXT NOT NULL,
    description TEXT
);

CREATE TABLE event_benefits (
    benefit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    benefit_type benefit_type NOT NULL,
    title TEXT,
    description TEXT NOT NULL,
    is_guaranteed_to_all BOOLEAN NOT NULL DEFAULT FALSE,
    award_value TEXT
);

CREATE TABLE event_sources (
    source_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    source_type source_kind NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT,
    is_primary_source BOOLEAN NOT NULL DEFAULT TRUE,
    captured_on DATE,
    verified_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    CONSTRAINT uq_event_source UNIQUE (event_id, source_url)
);

CREATE TABLE event_milestones (
    milestone_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    milestone_type milestone_type NOT NULL,
    milestone_name TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    timezone_name TEXT,
    is_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shortlist_entries (
    event_id BIGINT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
    shortlisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    shortlisted_by_member_id BIGINT REFERENCES team_members(member_id) ON DELETE SET NULL,
    queue_type queue_type NOT NULL,
    confirmed_eligibility BOOLEAN,
    expected_cost_summary TEXT,
    schedule_feasibility TEXT,
    technical_relevance TEXT,
    organizer_credibility TEXT,
    learning_networking_potential TEXT,
    evidence_quality_notes TEXT,
    why_practical TEXT NOT NULL,
    still_needs_verification TEXT
);

CREATE TABLE application_requirements (
    requirement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    queue_type queue_type NOT NULL,
    requirement_type application_material_type NOT NULL,
    requirement_text TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    status readiness_status NOT NULL DEFAULT 'not_started',
    owner_member_id BIGINT REFERENCES team_members(member_id) ON DELETE SET NULL,
    notes TEXT
);

CREATE TABLE organizer_follow_ups (
    follow_up_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    contact_channel TEXT,
    contact_target TEXT,
    sent_at TIMESTAMPTZ,
    assigned_member_id BIGINT REFERENCES team_members(member_id) ON DELETE SET NULL,
    response_status response_status NOT NULL DEFAULT 'draft',
    confirmed_answer TEXT,
    answered_at TIMESTAMPTZ,
    evidence_source_id BIGINT REFERENCES event_sources(source_id) ON DELETE SET NULL,
    notes TEXT
);

CREATE TABLE event_verifications (
    verification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    checked_by_member_id BIGINT NOT NULL REFERENCES team_members(member_id) ON DELETE RESTRICT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verification_scope TEXT NOT NULL,
    result verification_result NOT NULL,
    notes TEXT
);

CREATE TABLE contribution_log (
    contribution_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES team_members(member_id) ON DELETE RESTRICT,
    event_id BIGINT REFERENCES events(event_id) ON DELETE SET NULL,
    contribution_type contribution_type NOT NULL,
    notes TEXT NOT NULL,
    hours_spent NUMERIC(5, 2),
    contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_hours_spent CHECK (
        hours_spent IS NULL
        OR hours_spent >= 0
    )
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_events_set_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX uq_events_master_identity
    ON events (
        event_name,
        COALESCE(event_start_date, DATE '1900-01-01'),
        COALESCE(city, ''),
        COALESCE(country, '')
    );

CREATE INDEX ix_events_status ON events (operational_status);
CREATE INDEX ix_events_confidence ON events (evidence_confidence);
CREATE INDEX ix_events_format ON events (format);
CREATE INDEX ix_events_deadline ON events (registration_deadline_at);
CREATE INDEX ix_event_milestones_due_at ON event_milestones (due_at);
CREATE INDEX ix_shortlist_queue ON shortlist_entries (queue_type);
CREATE INDEX ix_follow_ups_status ON organizer_follow_ups (response_status);
CREATE INDEX ix_application_requirements_status ON application_requirements (status);

CREATE VIEW v_apply_now_queue AS
SELECT
    e.event_id,
    e.event_name,
    e.organizer_name,
    e.registration_link,
    e.registration_deadline_at,
    e.registration_status,
    s.shortlisted_at,
    s.why_practical,
    s.still_needs_verification
FROM shortlist_entries AS s
JOIN events AS e
    ON e.event_id = s.event_id
WHERE s.queue_type = 'apply_now';

CREATE VIEW v_codyza_shortlist AS
SELECT
    e.event_id,
    e.event_name,
    e.organizer_name,
    e.operational_status,
    e.evidence_confidence,
    e.registration_status,
    e.registration_deadline_at,
    s.queue_type,
    s.confirmed_eligibility,
    s.why_practical,
    s.still_needs_verification
FROM shortlist_entries AS s
JOIN events AS e
    ON e.event_id = s.event_id
ORDER BY e.registration_deadline_at NULLS LAST, e.event_name;

CREATE VIEW v_prepare_before_opening_queue AS
SELECT
    e.event_id,
    e.event_name,
    e.organizer_name,
    e.official_website,
    e.registration_status,
    s.shortlisted_at,
    s.why_practical,
    s.still_needs_verification
FROM shortlist_entries AS s
JOIN events AS e
    ON e.event_id = s.event_id
WHERE s.queue_type = 'prepare_before_opening';

CREATE VIEW v_travel_supported_opportunities AS
SELECT
    event_id,
    event_name,
    organizer_name,
    city,
    state_region,
    country,
    travel_support,
    lodging_support,
    reimbursement_conditions,
    official_website
FROM events
WHERE travel_support IN ('provided', 'partially_reimbursed', 'application_based')
   OR lodging_support IN ('provided', 'partially_reimbursed', 'application_based');

CREATE VIEW v_virtual_hybrid_opportunities AS
SELECT
    event_id,
    event_name,
    organizer_name,
    format,
    event_start_date,
    event_end_date,
    registration_link,
    official_website
FROM events
WHERE format IN ('virtual', 'hybrid');

CREATE VIEW v_upcoming_monitoring_list AS
SELECT
    event_id,
    event_name,
    organizer_name,
    official_website,
    registration_status,
    operational_status,
    last_verified_at,
    unresolved_questions,
    next_action
FROM events
WHERE operational_status IN ('monitor', 'verified_registration_upcoming', 'needs_confirmation')
ORDER BY registration_deadline_at NULLS LAST, event_name;

CREATE VIEW v_deadlines_next_7_days AS
SELECT
    e.event_id,
    e.event_name,
    m.milestone_type,
    m.milestone_name,
    m.due_at,
    m.timezone_name,
    e.registration_link,
    e.official_website
FROM event_milestones AS m
JOIN events AS e
    ON e.event_id = m.event_id
WHERE m.due_at IS NOT NULL
  AND m.due_at >= NOW()
  AND m.due_at < NOW() + INTERVAL '7 days'
ORDER BY m.due_at;

CREATE VIEW v_deadlines_next_30_days AS
SELECT
    e.event_id,
    e.event_name,
    m.milestone_type,
    m.milestone_name,
    m.due_at,
    m.timezone_name,
    e.registration_link,
    e.official_website
FROM event_milestones AS m
JOIN events AS e
    ON e.event_id = m.event_id
WHERE m.due_at IS NOT NULL
  AND m.due_at >= NOW()
  AND m.due_at < NOW() + INTERVAL '30 days'
ORDER BY m.due_at;

CREATE VIEW v_source_evidence_appendix AS
SELECT
    e.event_id,
    e.event_name,
    s.source_type,
    s.source_title,
    s.source_url,
    s.is_primary_source,
    s.verified_on,
    s.notes
FROM event_sources AS s
JOIN events AS e
    ON e.event_id = s.event_id
ORDER BY e.event_name, s.verified_on DESC;
