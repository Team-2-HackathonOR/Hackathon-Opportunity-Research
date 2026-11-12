from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.enums import (
    ApplicationMaterialType,
    BenefitType,
    ContributionType,
    MilestoneType,
    QueueType,
    ReadinessStatus,
    ResponseStatus,
    SourceKind,
    TrackKind,
    VerificationResult,
)


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
