from __future__ import annotations

from datetime import UTC, datetime
from typing import Callable

from sqlalchemy.orm import Session

from app.models import (
    Event,
    EventBenefit,
    EventCategory,
    EventCategoryAssignment,
    EventMilestone,
    EventSource,
    EventTrack,
)
from app.schemas import EventCreate


def add_event_details(session: Session, event: Event, payload: EventCreate, get_or_create_category: Callable[[str], EventCategory]) -> None:
    for category_input in payload.categories:
        category = get_or_create_category(category_input.category_name)
        session.add(
            EventCategoryAssignment(
                event_id=event.event_id,
                category_id=category.category_id,
                is_primary=category_input.is_primary,
            )
        )

    session.add_all(
        [
            EventTrack(
                event_id=event.event_id,
                track_type=track.track_type,
                track_name=track.track_name,
                description=track.description,
            )
            for track in payload.tracks
        ]
    )

    session.add_all(
        [
            EventBenefit(
                event_id=event.event_id,
                benefit_type=benefit.benefit_type,
                title=benefit.title,
                description=benefit.description,
                is_guaranteed_to_all=benefit.is_guaranteed_to_all,
                award_value=benefit.award_value,
            )
            for benefit in payload.benefits
        ]
    )

    session.add_all(
        [
            EventSource(
                event_id=event.event_id,
                source_type=source.source_type,
                source_url=source.source_url,
                source_title=source.source_title,
                is_primary_source=source.is_primary_source,
                captured_on=source.captured_on,
                verified_on=source.verified_on or datetime.now(UTC),
                notes=source.notes,
            )
            for source in payload.sources
        ]
    )

    session.add_all(
        [
            EventMilestone(
                event_id=event.event_id,
                milestone_type=milestone.milestone_type,
                milestone_name=milestone.milestone_name,
                due_at=milestone.due_at,
                timezone_name=milestone.timezone_name,
                is_confirmed=milestone.is_confirmed,
                notes=milestone.notes,
                last_verified_at=milestone.last_verified_at or datetime.now(UTC),
            )
            for milestone in payload.milestones
        ]
    )
