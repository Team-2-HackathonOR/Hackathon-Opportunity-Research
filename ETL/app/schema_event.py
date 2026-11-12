from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.enums import EventFormat, EvidenceConfidence, OperationalStatus, SupportStatus
from app.schema_inputs import (
    ApplicationRequirementInput,
    ContributionLogInput,
    EventBenefitInput,
    EventCategoryInput,
    EventMilestoneInput,
    EventSourceInput,
    EventTrackInput,
    EventVerificationInput,
    OrganizerFollowUpInput,
    ShortlistEntryInput,
)


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
