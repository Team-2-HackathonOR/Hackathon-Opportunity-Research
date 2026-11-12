from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, PrimaryKeyConstraint, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import BenefitType, MilestoneType, SourceKind, TrackKind
from app.model_base import Base, SCHEMA_NAME, schema_enum
from app.model_event import Event


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
