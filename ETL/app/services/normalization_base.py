from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Mapping

from app.enums import BenefitType, EvidenceConfidence, SourceKind, SupportStatus, TrackKind
from app.schemas import EventBenefitInput, EventCategoryInput, EventCreate, EventSourceInput, EventTrackInput
from app.services.exceptions import NormalizationError
from app.services.normalization_contributions import _build_default_contributions
from app.services.normalization_values import (
    _coerce_datetime,
    _extract_domain,
    _extract_location_fields,
    _first_non_empty,
    _infer_source_type,
    _map_operational_status,
)


def build_base_event_payload(
    raw_record: Mapping[str, Any],
    primary_researcher_id: int | None,
    verifier_id: int | None,
) -> EventCreate:
    event_name = _first_non_empty(raw_record, "event_name", "title", "name")
    if event_name is None:
        raise NormalizationError("Record is missing an event name/title.")

    official_url = _first_non_empty(raw_record, "official_website", "url", "event_url")
    registration_link = _first_non_empty(raw_record, "registration_link", "startSubmissionUrl", "registration_url", "url")
    rules_faq_link = _first_non_empty(raw_record, "rules_faq_link", "rules_url", "faq_url")
    fetched_at = _coerce_datetime(raw_record.get("updatedAt") or raw_record.get("fetchedAt"))
    categories = _extract_categories(raw_record)
    tracks = _extract_tracks(raw_record)
    benefits = _extract_benefits(raw_record)
    sources = _extract_sources(raw_record, official_url)
    city, state_region, country, venue, format_value = _extract_location_fields(raw_record)
    status_text = _first_non_empty(raw_record, "registration_status", "status", "open_state")

    return EventCreate(
        event_name=event_name,
        organizer_name=_first_non_empty(raw_record, "organizer_name", "organization", "organization_name", "organizer"),
        host_entity=_first_non_empty(raw_record, "host_entity", "host"),
        official_website=official_url,
        registration_link=registration_link,
        rules_faq_link=rules_faq_link,
        official_domain=_extract_domain(official_url),
        registration_platform=_first_non_empty(raw_record, "registration_platform", "platform"),
        city=city,
        state_region=state_region,
        country=country,
        venue=venue,
        format=format_value,
        registration_status=status_text,
        last_verified_at=fetched_at or datetime.now(UTC),
        registration_fee_notes=_first_non_empty(raw_record, "registration_fee_notes", "price"),
        travel_support=SupportStatus.NOT_CONFIRMED,
        lodging_support=SupportStatus.NOT_CONFIRMED,
        meals_support=SupportStatus.NOT_CONFIRMED,
        local_transport_support=SupportStatus.NOT_CONFIRMED,
        pre_existing_code_policy=_first_non_empty(raw_record, "pre_existing_code_policy"),
        ai_tool_policy=_first_non_empty(raw_record, "ai_tool_policy"),
        application_requirements=_first_non_empty(raw_record, "application_requirements"),
        unresolved_questions="Imported from source data. Primary-source verification is still required.",
        legitimacy_notes="Imported lead requires official verification before recommendation.",
        operational_status=_map_operational_status(status_text),
        evidence_confidence=EvidenceConfidence.LOW,
        next_action="Verify official site, dates, eligibility, and support details from primary sources.",
        primary_researcher_id=primary_researcher_id,
        verifier_id=verifier_id,
        categories=categories,
        tracks=tracks,
        benefits=benefits,
        sources=sources,
        contributions=_build_default_contributions(
            event_name=event_name,
            primary_researcher_id=primary_researcher_id,
            verifier_id=verifier_id,
        ),
    )


def _extract_categories(raw_record: Mapping[str, Any]) -> list[EventCategoryInput]:
    candidates = raw_record.get("categories") or raw_record.get("themes") or []
    category_names: list[str] = []
    if isinstance(candidates, list):
        for item in candidates:
            if isinstance(item, Mapping):
                name = item.get("category_name") or item.get("name")
                if isinstance(name, str) and name.strip():
                    category_names.append(name.strip())
            elif isinstance(item, str) and item.strip():
                category_names.append(item.strip())
    return [
        EventCategoryInput(category_name=name, is_primary=index == 0)
        for index, name in enumerate(dict.fromkeys(category_names))
    ]


def _extract_tracks(raw_record: Mapping[str, Any]) -> list[EventTrackInput]:
    tracks = []
    for category in _extract_categories(raw_record):
        tracks.append(
            EventTrackInput(
                track_type=TrackKind.THEME,
                track_name=category.category_name,
            )
        )
    return tracks


def _extract_benefits(raw_record: Mapping[str, Any]) -> list[EventBenefitInput]:
    prize_amount = _first_non_empty(raw_record, "prizeAmount", "prize_amount")
    if prize_amount is None:
        return []
    return [
        EventBenefitInput(
            benefit_type=BenefitType.PRIZE,
            title="Prize Pool",
            description=f"Listed prize pool: {prize_amount}",
            award_value=prize_amount,
        )
    ]


def _extract_sources(raw_record: Mapping[str, Any], official_url: str | None) -> list[EventSourceInput]:
    sources: list[EventSourceInput] = []
    if official_url:
        sources.append(
            EventSourceInput(
                source_type=_infer_source_type(official_url),
                source_url=official_url,
                source_title="Imported source URL",
                is_primary_source=True,
                verified_on=datetime.now(UTC),
            )
        )

    registration_link = _first_non_empty(raw_record, "registration_link", "startSubmissionUrl", "registration_url")
    if registration_link and registration_link != official_url:
        sources.append(
            EventSourceInput(
                source_type=SourceKind.REGISTRATION_PAGE,
                source_url=registration_link,
                source_title="Registration page",
                is_primary_source=False,
                verified_on=datetime.now(UTC),
            )
        )

    rules_faq_link = _first_non_empty(raw_record, "rules_faq_link", "rules_url", "faq_url")
    if rules_faq_link and rules_faq_link not in {official_url, registration_link}:
        sources.append(
            EventSourceInput(
                source_type=SourceKind.RULES_FAQ,
                source_url=rules_faq_link,
                source_title="Rules or FAQ page",
                is_primary_source=False,
                verified_on=datetime.now(UTC),
            )
        )

    source_url = _first_non_empty(raw_record, "sourceUrl", "source_url")
    if source_url and source_url not in {official_url, registration_link, rules_faq_link}:
        sources.append(
            EventSourceInput(
                source_type=SourceKind.DIRECTORY,
                source_url=source_url,
                source_title="Source listing",
                is_primary_source=False,
                verified_on=datetime.now(UTC),
            )
        )

    return sources
