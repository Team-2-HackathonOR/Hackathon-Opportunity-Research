from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Enum, ForeignKey, Numeric, PrimaryKeyConstraint, String, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

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


SCHEMA_NAME = "hackathon_research"


def schema_enum(enum_type: type, name: str) -> Enum:
    return Enum(
        enum_type,
        name=name,
        schema=SCHEMA_NAME,
        create_type=False,
        values_callable=lambda enum_cls: [member.value for member in enum_cls],
    )


class Base(DeclarativeBase):
    pass


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = {"schema": SCHEMA_NAME}

    member_id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[Optional[str]] = mapped_column(Text, unique=True)
    role_name: Mapped[Optional[str]] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
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


class EventCategory(Base):
    __tablename__ = "event_categories"
    __table_args__ = {"schema": SCHEMA_NAME}

    category_id: Mapped[int] = mapped_column(primary_key=True)
    category_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)


class EventCategoryAssignment(Base):
    __tablename__ = "event_category_assignments"
    __table_args__ = (
        PrimaryKeyConstraint("event_id", "category_id"),
        {"schema": SCHEMA_NAME},
    )

    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.event_categories.category_id", ondelete="RESTRICT"),
        nullable=False,
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    event: Mapped[Event] = relationship(back_populates="category_assignments")
    category: Mapped[EventCategory] = relationship()


class EventTrack(Base):
    __tablename__ = "event_tracks"
    __table_args__ = {"schema": SCHEMA_NAME}

    track_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    track_type: Mapped[TrackKind] = mapped_column(schema_enum(TrackKind, "track_kind"), nullable=False)
    track_name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="tracks")


class EventBenefit(Base):
    __tablename__ = "event_benefits"
    __table_args__ = {"schema": SCHEMA_NAME}

    benefit_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    benefit_type: Mapped[BenefitType] = mapped_column(schema_enum(BenefitType, "benefit_type"), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    is_guaranteed_to_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    award_value: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="benefits")


class EventSource(Base):
    __tablename__ = "event_sources"
    __table_args__ = (
        UniqueConstraint("event_id", "source_url", name="uq_event_source"),
        {"schema": SCHEMA_NAME},
    )

    source_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type: Mapped[SourceKind] = mapped_column(schema_enum(SourceKind, "source_kind"), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    source_title: Mapped[Optional[str]] = mapped_column(Text)
    is_primary_source: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    captured_on: Mapped[Optional[date]] = mapped_column(Date)
    verified_on: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="sources")


class EventMilestone(Base):
    __tablename__ = "event_milestones"
    __table_args__ = {"schema": SCHEMA_NAME}

    milestone_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    milestone_type: Mapped[MilestoneType] = mapped_column(
        schema_enum(MilestoneType, "milestone_type"),
        nullable=False,
    )
    milestone_name: Mapped[str] = mapped_column(Text, nullable=False)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    timezone_name: Mapped[Optional[str]] = mapped_column(Text)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    notes: Mapped[Optional[str]] = mapped_column(Text)
    last_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    event: Mapped[Event] = relationship(back_populates="milestones")


class ShortlistEntry(Base):
    __tablename__ = "shortlist_entries"
    __table_args__ = {"schema": SCHEMA_NAME}

    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        primary_key=True,
    )
    shortlisted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    shortlisted_by_member_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="SET NULL")
    )
    queue_type: Mapped[QueueType] = mapped_column(schema_enum(QueueType, "queue_type"), nullable=False)
    confirmed_eligibility: Mapped[Optional[bool]] = mapped_column(Boolean)
    expected_cost_summary: Mapped[Optional[str]] = mapped_column(Text)
    schedule_feasibility: Mapped[Optional[str]] = mapped_column(Text)
    technical_relevance: Mapped[Optional[str]] = mapped_column(Text)
    organizer_credibility: Mapped[Optional[str]] = mapped_column(Text)
    learning_networking_potential: Mapped[Optional[str]] = mapped_column(Text)
    evidence_quality_notes: Mapped[Optional[str]] = mapped_column(Text)
    why_practical: Mapped[str] = mapped_column(Text, nullable=False)
    still_needs_verification: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="shortlist_entry")


class ApplicationRequirement(Base):
    __tablename__ = "application_requirements"
    __table_args__ = {"schema": SCHEMA_NAME}

    requirement_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    queue_type: Mapped[QueueType] = mapped_column(schema_enum(QueueType, "queue_type"), nullable=False)
    requirement_type: Mapped[ApplicationMaterialType] = mapped_column(
        schema_enum(ApplicationMaterialType, "application_material_type"),
        nullable=False,
    )
    requirement_text: Mapped[str] = mapped_column(Text, nullable=False)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[ReadinessStatus] = mapped_column(
        schema_enum(ReadinessStatus, "readiness_status"),
        nullable=False,
        default=ReadinessStatus.NOT_STARTED,
        server_default=ReadinessStatus.NOT_STARTED.value,
    )
    owner_member_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="SET NULL")
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="requirement_items")


class OrganizerFollowUp(Base):
    __tablename__ = "organizer_follow_ups"
    __table_args__ = {"schema": SCHEMA_NAME}

    follow_up_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    contact_channel: Mapped[Optional[str]] = mapped_column(Text)
    contact_target: Mapped[Optional[str]] = mapped_column(Text)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    assigned_member_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="SET NULL")
    )
    response_status: Mapped[ResponseStatus] = mapped_column(
        schema_enum(ResponseStatus, "response_status"),
        nullable=False,
        default=ResponseStatus.DRAFT,
        server_default=ResponseStatus.DRAFT.value,
    )
    confirmed_answer: Mapped[Optional[str]] = mapped_column(Text)
    answered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    evidence_source_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.event_sources.source_id", ondelete="SET NULL")
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="follow_ups")


class EventVerification(Base):
    __tablename__ = "event_verifications"
    __table_args__ = {"schema": SCHEMA_NAME}

    verification_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    checked_by_member_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="RESTRICT"),
        nullable=False,
    )
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    verification_scope: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[VerificationResult] = mapped_column(
        schema_enum(VerificationResult, "verification_result"),
        nullable=False,
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)

    event: Mapped[Event] = relationship(back_populates="verifications")


class ContributionLog(Base):
    __tablename__ = "contribution_log"
    __table_args__ = (
        CheckConstraint("hours_spent IS NULL OR hours_spent >= 0", name="chk_hours_spent"),
        {"schema": SCHEMA_NAME},
    )

    contribution_id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.team_members.member_id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(f"{SCHEMA_NAME}.events.event_id", ondelete="SET NULL")
    )
    contribution_type: Mapped[ContributionType] = mapped_column(
        schema_enum(ContributionType, "contribution_type"),
        nullable=False,
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    hours_spent: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    contributed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    event: Mapped[Optional[Event]] = relationship(back_populates="contributions")
