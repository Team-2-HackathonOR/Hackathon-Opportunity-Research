from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import (
    ApplicationMaterialType,
    ContributionType,
    QueueType,
    ReadinessStatus,
    ResponseStatus,
    VerificationResult,
)
from app.model_base import Base, SCHEMA_NAME, schema_enum
from app.model_event import Event


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
