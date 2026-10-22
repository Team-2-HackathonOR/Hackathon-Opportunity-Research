from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.enums import (
    ApplicationMaterialType,
    BenefitType,
    ContributionType,
    EventFormat,
    EvidenceConfidence,
    MilestoneType,
    OperationalStatus,
    QueueType,
    ReadinessStatus,
    ResponseStatus,
    SourceKind,
    SupportStatus,
    TrackKind,
    VerificationResult,
)


class ApiMessage(BaseModel):
    detail: str


class TeamMemberCreate(BaseModel):
    full_name: str = Field(min_length=1)
    email: str | None = None
    role_name: str | None = None
    active: bool = True


class TeamMemberResponse(TeamMemberCreate):
    model_config = ConfigDict(from_attributes=True)

    member_id: int
    created_at: datetime


class EventCategoryInput(BaseModel):
    category_name: str = Field(min_length=1)
    is_primary: bool = False


class EventTrackInput(BaseModel):
    track_type: TrackKind
    track_name: str = Field(min_length=1)
    description: str | None = None


class EventBenefitInput(BaseModel):
    benefit_type: BenefitType
    title: str | None = None
    description: str = Field(min_length=1)
    is_guaranteed_to_all: bool = False
    award_value: str | None = None


class EventSourceInput(BaseModel):
    source_type: SourceKind
    source_url: str = Field(min_length=1)
    source_title: str | None = None
    is_primary_source: bool = True
    captured_on: date | None = None
    verified_on: datetime | None = None
    notes: str | None = None


class EventMilestoneInput(BaseModel):
    milestone_type: MilestoneType
    milestone_name: str = Field(min_length=1)
    due_at: datetime | None = None
    timezone_name: str | None = None
    is_confirmed: bool = True
    notes: str | None = None
    last_verified_at: datetime | None = None


class ShortlistEntryInput(BaseModel):
    queue_type: QueueType
    shortlisted_by_member_id: int | None = None
    shortlisted_at: datetime | None = None
    confirmed_eligibility: bool | None = None
    expected_cost_summary: str | None = None
    schedule_feasibility: str | None = None
    technical_relevance: str | None = None
    organizer_credibility: str | None = None
    learning_networking_potential: str | None = None
    evidence_quality_notes: str | None = None
    why_practical: str = Field(min_length=1)
    still_needs_verification: str | None = None


class ApplicationRequirementInput(BaseModel):
    queue_type: QueueType
    requirement_type: ApplicationMaterialType
    requirement_text: str = Field(min_length=1)
    due_at: datetime | None = None
    status: ReadinessStatus = ReadinessStatus.NOT_STARTED
    owner_member_id: int | None = None
    notes: str | None = None


class OrganizerFollowUpInput(BaseModel):
    question_text: str = Field(min_length=1)
    contact_channel: str | None = None
    contact_target: str | None = None
    sent_at: datetime | None = None
    assigned_member_id: int | None = None
    response_status: ResponseStatus = ResponseStatus.DRAFT
    confirmed_answer: str | None = None
    answered_at: datetime | None = None
    evidence_source_id: int | None = None
    notes: str | None = None


class EventVerificationInput(BaseModel):
    checked_by_member_id: int
    checked_at: datetime | None = None
    verification_scope: str = Field(min_length=1)
    result: VerificationResult
    notes: str | None = None


class ContributionLogInput(BaseModel):
    member_id: int
    contribution_type: ContributionType
    notes: str = Field(min_length=1)
    hours_spent: Decimal | None = None
    contributed_at: datetime | None = None


class EventCreate(BaseModel):
    event_name: str = Field(min_length=1)
    organizer_name: str | None = None
    host_entity: str | None = None
    official_website: str | None = None
    registration_link: str | None = None
    rules_faq_link: str | None = None
    official_domain: str | None = None
    registration_platform: str | None = None
    city: str | None = None
    state_region: str | None = None
    country: str | None = None
    venue: str | None = None
    format: EventFormat = EventFormat.UNKNOWN
    event_start_date: date | None = None
    event_end_date: date | None = None
    event_timezone: str | None = None
    registration_deadline_at: datetime | None = None
    registration_status: str | None = None
    acceptance_date: date | None = None
    waitlist_information: str | None = None
    last_verified_at: datetime | None = None
    student_eligibility: str | None = None
    outside_school_eligibility: str | None = None
    international_student_wording: str | None = None
    age_rules: str | None = None
    geographic_restrictions: str | None = None
    invitation_requirements: str | None = None
    team_size_min: int | None = None
    team_size_max: int | None = None
    solo_participation_policy: str | None = None
    team_formation_rules: str | None = None
    all_members_must_register: bool | None = None
    registration_fee_amount: Decimal | None = None
    registration_fee_currency: str | None = None
    registration_fee_notes: str | None = None
    travel_support: SupportStatus = SupportStatus.NOT_CONFIRMED
    lodging_support: SupportStatus = SupportStatus.NOT_CONFIRMED
    meals_support: SupportStatus = SupportStatus.NOT_CONFIRMED
    local_transport_support: SupportStatus = SupportStatus.NOT_CONFIRMED
    travel_support_notes: str | None = None
    reimbursement_conditions: str | None = None
    expenses_paid_upfront: bool | None = None
    judging_criteria: str | None = None
    submission_format: str | None = None
    project_start_rules: str | None = None
    pre_existing_code_policy: str | None = None
    ai_tool_policy: str | None = None
    open_source_rules: str | None = None
    data_restrictions: str | None = None
    demo_video_requirements: str | None = None
    intellectual_property_terms: str | None = None
    application_requirements: str | None = None
    organizer_contact_summary: str | None = None
    unresolved_questions: str | None = None
    legitimacy_notes: str | None = None
    risk_flags: str | None = None
    operational_status: OperationalStatus
    evidence_confidence: EvidenceConfidence
    next_action: str | None = None
    primary_researcher_id: int | None = None
    verifier_id: int | None = None
    duplicate_of_event_id: int | None = None
    categories: list[EventCategoryInput] = Field(default_factory=list)
    tracks: list[EventTrackInput] = Field(default_factory=list)
    benefits: list[EventBenefitInput] = Field(default_factory=list)
    sources: list[EventSourceInput] = Field(default_factory=list)
    milestones: list[EventMilestoneInput] = Field(default_factory=list)
    shortlist_entry: ShortlistEntryInput | None = None
    application_requirement_items: list[ApplicationRequirementInput] = Field(default_factory=list)
    organizer_follow_ups: list[OrganizerFollowUpInput] = Field(default_factory=list)
    verifications: list[EventVerificationInput] = Field(default_factory=list)
    contributions: list[ContributionLogInput] = Field(default_factory=list)

    @field_validator("registration_fee_currency")
    @classmethod
    def uppercase_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.upper()


class EventResponse(BaseModel):
    event_id: int
    event_name: str
    operational_status: OperationalStatus
    evidence_confidence: EvidenceConfidence


class MongoImportRequest(BaseModel):
    database_name: str | None = None
    collection_name: str | None = None
    limit: int = Field(default=25, ge=1, le=1000)
    use_ai_normalization: bool = True
    primary_researcher_id: int | None = None
    verifier_id: int | None = None


class ImportFailure(BaseModel):
    record_index: int
    source_identifier: str | None = None
    reason: str


class ImportSuccess(BaseModel):
    record_index: int
    source_identifier: str | None = None
    event_id: int
    event_name: str


class ImportResult(BaseModel):
    source: str
    processed_count: int
    inserted_count: int
    failed_count: int
    successes: list[ImportSuccess]
    failures: list[ImportFailure]


class RawImportRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    data: dict[str, Any]

