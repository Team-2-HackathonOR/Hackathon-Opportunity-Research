SET search_path TO hackathon_research, public;

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
