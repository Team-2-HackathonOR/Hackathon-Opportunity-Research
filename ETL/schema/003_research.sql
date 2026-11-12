SET search_path TO hackathon_research, public;

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
