from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, EventCategory, TeamMember
from app.schemas import EventCreate
from app.services.event_details import add_event_details
from app.services.event_research import add_event_research


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

        add_event_details(self.session, event, payload, self._get_or_create_category)
        add_event_research(self.session, event, payload)

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
