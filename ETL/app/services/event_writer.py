from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ApplicationRequirement,
    ContributionLog,
    Event,
    EventBenefit,
    EventCategory,
    EventCategoryAssignment,
    EventMilestone,
    EventSource,
    EventTrack,
    EventVerification,
    OrganizerFollowUp,
    ShortlistEntry,
    TeamMember,
)
from app.schemas import EventCreate


class EventWriter:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create_team_member(self, full_name: str, email: str | None, role_name: str | None, active: bool) -> TeamMember:
        team_member = TeamMember(
            full_name=full_name,
            email=email,
            role_name=role_name,
            active=active,
        )
        self.session.add(team_member)
        self.session.commit()
        self.session.refresh(team_member)
        return team_member

    def create_event(self, payload: EventCreate) -> Event:
        self._ensure_member_ids_exist(
            [
                payload.primary_researcher_id,
                payload.verifier_id,
                payload.shortlist_entry.shortlisted_by_member_id if payload.shortlist_entry else None,
                *[item.owner_member_id for item in payload.application_requirement_items],
                *[item.assigned_member_id for item in payload.organizer_follow_ups],
                *[item.checked_by_member_id for item in payload.verifications],
                *[item.member_id for item in payload.contributions],
            ]
        )

        event = Event(
            event_name=payload.event_name,
            organizer_name=payload.organizer_name,
            host_entity=payload.host_entity,
            official_website=payload.official_website,
            registration_link=payload.registration_link,
            rules_faq_link=payload.rules_faq_link,
            official_domain=payload.official_domain,
            registration_platform=payload.registration_platform,
            city=payload.city,
            state_region=payload.state_region,
            country=payload.country,
            venue=payload.venue,
            format=payload.format,
            event_start_date=payload.event_start_date,
            event_end_date=payload.event_end_date,
            event_timezone=payload.event_timezone,
            registration_deadline_at=payload.registration_deadline_at,
            registration_status=payload.registration_status,
            acceptance_date=payload.acceptance_date,
            waitlist_information=payload.waitlist_information,
            last_verified_at=payload.last_verified_at or datetime.now(UTC),
            student_eligibility=payload.student_eligibility,
            outside_school_eligibility=payload.outside_school_eligibility,
            international_student_wording=payload.international_student_wording,
            age_rules=payload.age_rules,
            geographic_restrictions=payload.geographic_restrictions,
            invitation_requirements=payload.invitation_requirements,
            team_size_min=payload.team_size_min,
            team_size_max=payload.team_size_max,
            solo_participation_policy=payload.solo_participation_policy,
            team_formation_rules=payload.team_formation_rules,
            all_members_must_register=payload.all_members_must_register,
            registration_fee_amount=payload.registration_fee_amount,
            registration_fee_currency=payload.registration_fee_currency,
            registration_fee_notes=payload.registration_fee_notes,
            travel_support=payload.travel_support,
            lodging_support=payload.lodging_support,
            meals_support=payload.meals_support,
            local_transport_support=payload.local_transport_support,
            travel_support_notes=payload.travel_support_notes,
            reimbursement_conditions=payload.reimbursement_conditions,
            expenses_paid_upfront=payload.expenses_paid_upfront,
            judging_criteria=payload.judging_criteria,
            submission_format=payload.submission_format,
            project_start_rules=payload.project_start_rules,
            pre_existing_code_policy=payload.pre_existing_code_policy,
            ai_tool_policy=payload.ai_tool_policy,
            open_source_rules=payload.open_source_rules,
            data_restrictions=payload.data_restrictions,
            demo_video_requirements=payload.demo_video_requirements,
            intellectual_property_terms=payload.intellectual_property_terms,
            application_requirements=payload.application_requirements,
            organizer_contact_summary=payload.organizer_contact_summary,
            unresolved_questions=payload.unresolved_questions,
            legitimacy_notes=payload.legitimacy_notes,
            risk_flags=payload.risk_flags,
            operational_status=payload.operational_status,
            evidence_confidence=payload.evidence_confidence,
            next_action=payload.next_action,
            primary_researcher_id=payload.primary_researcher_id,
            verifier_id=payload.verifier_id,
            duplicate_of_event_id=payload.duplicate_of_event_id,
        )
        self.session.add(event)
        self.session.flush()

        for category_input in payload.categories:
            category = self._get_or_create_category(category_input.category_name)
            self.session.add(
                EventCategoryAssignment(
                    event_id=event.event_id,
                    category_id=category.category_id,
                    is_primary=category_input.is_primary,
                )
            )

        self.session.add_all(
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

        self.session.add_all(
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

        self.session.add_all(
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

        self.session.add_all(
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

        if payload.shortlist_entry is not None:
            shortlist = payload.shortlist_entry
            self.session.add(
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

        self.session.add_all(
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

        self.session.add_all(
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

        self.session.add_all(
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

        self.session.add_all(
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

        self.session.commit()
        self.session.refresh(event)
        return event

    def _get_or_create_category(self, category_name: str) -> EventCategory:
        normalized_name = category_name.strip()
        category = self.session.scalar(
            select(EventCategory).where(EventCategory.category_name == normalized_name)
        )
        if category is not None:
            return category

        category = EventCategory(category_name=normalized_name)
        self.session.add(category)
        self.session.flush()
        return category

    def _ensure_member_ids_exist(self, member_ids: Iterable[int | None]) -> None:
        concrete_ids = sorted({member_id for member_id in member_ids if member_id is not None})
        if not concrete_ids:
            return

        existing_ids = set(
            self.session.scalars(
                select(TeamMember.member_id).where(TeamMember.member_id.in_(concrete_ids))
            )
        )
        missing_ids = [str(member_id) for member_id in concrete_ids if member_id not in existing_ids]
        if missing_ids:
            raise ValueError(f"Unknown team member ids: {', '.join(missing_ids)}")
