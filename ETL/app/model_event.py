from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import EventFormat, EvidenceConfidence, OperationalStatus, SupportStatus
from app.model_base import Base, SCHEMA_NAME, schema_enum


if TYPE_CHECKING:
    from app.model_catalog import (
        EventBenefit, EventCategoryAssignment, EventMilestone, EventSource, EventTrack,
    )
    from app.model_research import (
        ApplicationRequirement, ContributionLog, EventVerification, OrganizerFollowUp, ShortlistEntry,
    )


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint(
            "event_end_date IS NULL OR event_start_date IS NULL OR event_end_date >= event_start_date",
            name="chk_event_dates",
        ),
        CheckConstraint(
            "team_size_min IS NULL OR team_size_max IS NULL OR team_size_max >= team_size_min",
            name="chk_team_size",
        ),
        CheckConstraint(
            "registration_fee_amount IS NULL OR registration_fee_amount >= 0",
            name="chk_fee_amount",
        ),
        CheckConstraint(
            "registration_fee_currency IS NULL OR registration_fee_currency ~ '^[A-Z]{3}$'",
            name="chk_currency_code",
        ),
        CheckConstraint(
            "duplicate_of_event_id IS NULL OR duplicate_of_event_id <> event_id",
            name="chk_not_self_duplicate",
        ),
        {"schema": SCHEMA_NAME},
    )

    event_id: Mapped[int] = mapped_column(primary_key=True)
    event_name: Mapped[str] = mapped_column(Text, nullable=False)
    organizer_name: Mapped[Optional[str]] = mapped_column(Text)
    host_entity: Mapped[Optional[str]] = mapped_column(Text)
    official_website: Mapped[Optional[str]] = mapped_column(Text)
    registration_link: Mapped[Optional[str]] = mapped_column(Text)
    rules_faq_link: Mapped[Optional[str]] = mapped_column(Text)
    official_domain: Mapped[Optional[str]] = mapped_column(Text)
    registration_platform: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(Text)
    state_region: Mapped[Optional[str]] = mapped_column(Text)
    country: Mapped[Optional[str]] = mapped_column(Text)
    venue: Mapped[Optional[str]] = mapped_column(Text)
    format: Mapped[EventFormat] = mapped_column(
        schema_enum(EventFormat, "event_format"),
        nullable=False,
        default=EventFormat.UNKNOWN,
        server_default=EventFormat.UNKNOWN.value,
    )
    event_start_date: Mapped[Optional[date]] = mapped_column(Date)
    event_end_date: Mapped[Optional[date]] = mapped_column(Date)
    event_timezone: Mapped[Optional[str]] = mapped_column(Text)
    registration_deadline_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    registration_status: Mapped[Optional[str]] = mapped_column(Text)
    acceptance_date: Mapped[Optional[date]] = mapped_column(Date)
    waitlist_information: Mapped[Optional[str]] = mapped_column(Text)
    last_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    student_eligibility: Mapped[Optional[str]] = mapped_column(Text)
    outside_school_eligibility: Mapped[Optional[str]] = mapped_column(Text)
    international_student_wording: Mapped[Optional[str]] = mapped_column(Text)
    age_rules: Mapped[Optional[str]] = mapped_column(Text)
    geographic_restrictions: Mapped[Optional[str]] = mapped_column(Text)
    invitation_requirements: Mapped[Optional[str]] = mapped_column(Text)
    team_size_min: Mapped[Optional[int]] = mapped_column()
    team_size_max: Mapped[Optional[int]] = mapped_column()
    solo_participation_policy: Mapped[Optional[str]] = mapped_column(Text)
    team_formation_rules: Mapped[Optional[str]] = mapped_column(Text)
    all_members_must_register: Mapped[Optional[bool]] = mapped_column(Boolean)
    registration_fee_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    registration_fee_currency: Mapped[Optional[str]] = mapped_column(String(3))
    registration_fee_notes: Mapped[Optional[str]] = mapped_column(Text)
    travel_support: Mapped[SupportStatus] = mapped_column(
        schema_enum(SupportStatus, "support_status"),
        nullable=False,
        default=SupportStatus.NOT_CONFIRMED,
        server_default=SupportStatus.NOT_CONFIRMED.value,
    )
    lodging_support: Mapped[SupportStatus] = mapped_column(
        schema_enum(SupportStatus, "support_status"),
        nullable=False,
        default=SupportStatus.NOT_CONFIRMED,
        server_default=SupportStatus.NOT_CONFIRMED.value,
    )
    meals_support: Mapped[SupportStatus] = mapped_column(
        schema_enum(SupportStatus, "support_status"),
        nullable=False,
        default=SupportStatus.NOT_CONFIRMED,
        server_default=SupportStatus.NOT_CONFIRMED.value,
    )
    local_transport_support: Mapped[SupportStatus] = mapped_column(
        schema_enum(SupportStatus, "support_status"),
        nullable=False,
        default=SupportStatus.NOT_CONFIRMED,
        server_default=SupportStatus.NOT_CONFIRMED.value,
    )
    travel_support_notes: Mapped[Optional[str]] = mapped_column(Text)
    reimbursement_conditions: Mapped[Optional[str]] = mapped_column(Text)
    expenses_paid_upfront: Mapped[Optional[bool]] = mapped_column(Boolean)
    judging_criteria: Mapped[Optional[str]] = mapped_column(Text)
    submission_format: Mapped[Optional[str]] = mapped_column(Text)
    project_start_rules: Mapped[Optional[str]] = mapped_column(Text)
    pre_existing_code_policy: Mapped[Optional[str]] = mapped_column(Text)
    ai_tool_policy: Mapped[Optional[str]] = mapped_column(Text)
    open_source_rules: Mapped[Optional[str]] = mapped_column(Text)
    data_restrictions: Mapped[Optional[str]] = mapped_column(Text)
    demo_video_requirements: Mapped[Optional[str]] = mapped_column(Text)
    intellectual_property_terms: Mapped[Optional[str]] = mapped_column(Text)
    application_requirements: Mapped[Optional[str]] = mapped_column(Text)
    organizer_contact_summary: Mapped[Optional[str]] = mapped_column(Text)
    unresolved_questions: Mapped[Optional[str]] = mapped_column(Text)
    legitimacy_notes: Mapped[Optional[str]] = mapped_column(Text)
    risk_flags: Mapped[Optional[str]] = mapped_column(Text)
    operational_status: Mapped[OperationalStatus] = mapped_column(
        schema_enum(OperationalStatus, "operational_status"),
        nullable=False,
    )
    evidence_confidence: Mapped[EvidenceConfidence] = mapped_column(
        schema_enum(EvidenceConfidence, "evidence_confidence"),
        nullable=False,
    )
    next_action: Mapped[Optional[str]] = mapped_column(Text)
    primary_researcher_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="SET NULL")
    )
    verifier_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="SET NULL")
    )
    duplicate_of_event_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    category_assignments: Mapped[list["EventCategoryAssignment"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )
    tracks: Mapped[list["EventTrack"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    benefits: Mapped[list["EventBenefit"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    sources: Mapped[list["EventSource"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    milestones: Mapped[list["EventMilestone"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    shortlist_entry: Mapped[Optional["ShortlistEntry"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
        uselist=False,
    )
    requirement_items: Mapped[list["ApplicationRequirement"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )
    follow_ups: Mapped[list["OrganizerFollowUp"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )
    verifications: Mapped[list["EventVerification"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )
    contributions: Mapped[list["ContributionLog"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )
