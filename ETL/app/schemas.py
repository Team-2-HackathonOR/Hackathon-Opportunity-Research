from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.enums import EvidenceConfidence, OperationalStatus
from app.schema_event import EventCreate
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


__all__ = [
    "ApiMessage",
    "ApplicationRequirementInput",
    "ContributionLogInput",
    "EventBenefitInput",
    "EventCategoryInput",
    "EventCreate",
    "EventMilestoneInput",
    "EventResponse",
    "EventSourceInput",
    "EventTrackInput",
    "EventVerificationInput",
    "ImportFailure",
    "ImportResult",
    "ImportSuccess",
    "MongoImportRequest",
    "OrganizerFollowUpInput",
    "RawImportRecord",
    "ShortlistEntryInput",
    "TeamMemberCreate",
    "TeamMemberResponse",
]


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


class EventResponse(BaseModel):
    event_id: int
    event_name: str
    operational_status: OperationalStatus
    evidence_confidence: EvidenceConfidence


class MongoImportRequest(BaseModel):
    database_name: str | None = None
    collection_name: str | None = None
    limit: int | None = Field(default=25, ge=1, le=1000)
    fetched_at: str | None = Field(default=None, min_length=1, max_length=40)
    cursor_mode: bool = False
    after_id: int | None = Field(default=None, ge=0)
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
    next_after_id: int | None = None


class RawImportRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    data: dict[str, Any]
