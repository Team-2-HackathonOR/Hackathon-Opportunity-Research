from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import (
    ApplicationRequirement,
    ContributionLog,
    Event,
    EventVerification,
    OrganizerFollowUp,
    ShortlistEntry,
)
from app.schemas import EventCreate


def add_event_research(session: Session, event: Event, payload: EventCreate) -> None:
    if payload.shortlist_entry is not None:
        shortlist = payload.shortlist_entry
        session.add(
            ShortlistEntry(
                event_id=event.event_id,
                shortlisted_at=shortlist.shortlisted_at or datetime.now(UTC),
                shortlisted_by_member_id=shortlist.shortlisted_by_member_id,
                queue_type=shortlist.queue_type,
                confirmed_eligibility=shortlist.confirmed_eligibility,
                expected_cost_summary=shortlist.expected_cost_summary,
                schedule_feasibility=shortlist.schedule_feasibility,
                technical_relevance=shortlist.technical_relevance,
                organizer_credibility=shortlist.organizer_credibility,
                learning_networking_potential=shortlist.learning_networking_potential,
                evidence_quality_notes=shortlist.evidence_quality_notes,
                why_practical=shortlist.why_practical,
                still_needs_verification=shortlist.still_needs_verification,
            )
        )

    session.add_all(
        [
            ApplicationRequirement(
                event_id=event.event_id,
                queue_type=item.queue_type,
                requirement_type=item.requirement_type,
                requirement_text=item.requirement_text,
                due_at=item.due_at,
                status=item.status,
                owner_member_id=item.owner_member_id,
                notes=item.notes,
            )
            for item in payload.application_requirement_items
        ]
    )

    session.add_all(
        [
            OrganizerFollowUp(
                event_id=event.event_id,
                question_text=item.question_text,
                contact_channel=item.contact_channel,
                contact_target=item.contact_target,
                sent_at=item.sent_at,
                assigned_member_id=item.assigned_member_id,
                response_status=item.response_status,
                confirmed_answer=item.confirmed_answer,
                answered_at=item.answered_at,
                evidence_source_id=item.evidence_source_id,
                notes=item.notes,
            )
            for item in payload.organizer_follow_ups
        ]
    )

    session.add_all(
        [
            EventVerification(
                event_id=event.event_id,
                checked_by_member_id=item.checked_by_member_id,
                checked_at=item.checked_at or datetime.now(UTC),
                verification_scope=item.verification_scope,
                result=item.result,
                notes=item.notes,
            )
            for item in payload.verifications
        ]
    )

    session.add_all(
        [
            ContributionLog(
                event_id=event.event_id,
                member_id=item.member_id,
                contribution_type=item.contribution_type,
                notes=item.notes,
                hours_spent=item.hours_spent,
                contributed_at=item.contributed_at or datetime.now(UTC),
            )
            for item in payload.contributions
        ]
    )
