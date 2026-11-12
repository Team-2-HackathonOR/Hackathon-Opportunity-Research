from __future__ import annotations

from typing import Any

from app.enums import BenefitType, TrackKind
from app.services.normalization_values import _normalize_date_value


def _sanitize_track(track: Any) -> Any:
    if not isinstance(track, dict):
        return track
    sanitized = dict(track)
    track_type = sanitized.get("track_type")
    if not isinstance(track_type, str):
        return sanitized

    normalized = track_type.strip().lower()
    track_type_map = {
        "primary": TrackKind.THEME.value,
        "primary_track": TrackKind.THEME.value,
        "theme": TrackKind.THEME.value,
        "track": TrackKind.TRACK.value,
        "mini_challenge": TrackKind.SPONSOR_CHALLENGE.value,
        "challenge": TrackKind.SPONSOR_CHALLENGE.value,
        "sponsor_challenge": TrackKind.SPONSOR_CHALLENGE.value,
        "required_technology": TrackKind.REQUIRED_TECHNOLOGY.value,
        "technology": TrackKind.REQUIRED_TECHNOLOGY.value,
        "api_platform_requirement": TrackKind.API_PLATFORM_REQUIREMENT.value,
        "platform_requirement": TrackKind.API_PLATFORM_REQUIREMENT.value,
    }
    if normalized in track_type_map:
        sanitized["track_type"] = track_type_map[normalized]
    elif "challenge" in normalized:
        sanitized["track_type"] = TrackKind.SPONSOR_CHALLENGE.value
    elif "technology" in normalized:
        sanitized["track_type"] = TrackKind.REQUIRED_TECHNOLOGY.value
    elif "api" in normalized or "platform" in normalized:
        sanitized["track_type"] = TrackKind.API_PLATFORM_REQUIREMENT.value
    elif "theme" in normalized or "primary" in normalized:
        sanitized["track_type"] = TrackKind.THEME.value
    else:
        sanitized["track_type"] = TrackKind.TRACK.value
    return sanitized


def _sanitize_source(source: Any) -> Any:
    if not isinstance(source, dict):
        return source
    sanitized = dict(source)
    sanitized["captured_on"] = _normalize_date_value(sanitized.get("captured_on"))
    return sanitized


def _sanitize_benefit(benefit: Any) -> Any:
    if not isinstance(benefit, dict):
        return benefit
    sanitized = dict(benefit)
    benefit_type = sanitized.get("benefit_type")
    if not isinstance(benefit_type, str):
        return sanitized

    normalized = benefit_type.strip().lower()
    benefit_type_map = {
        "prize": BenefitType.PRIZE.value,
        "sponsor_prize": BenefitType.SPONSOR_PRIZE.value,
        "cash_prize": BenefitType.PRIZE.value,
        "recognition": BenefitType.CAREER_EXPOSURE.value,
        "career_exposure": BenefitType.CAREER_EXPOSURE.value,
        "career": BenefitType.CAREER_EXPOSURE.value,
        "participant_benefit": BenefitType.PARTICIPANT_BENEFIT.value,
        "participant": BenefitType.PARTICIPANT_BENEFIT.value,
        "certificate": BenefitType.CERTIFICATE.value,
        "credit": BenefitType.CREDIT.value,
        "incubator": BenefitType.INCUBATOR.value,
        "hardware": BenefitType.HARDWARE.value,
        "mentor": BenefitType.MENTOR.value,
        "mentorship": BenefitType.MENTOR.value,
        "workshop": BenefitType.WORKSHOP.value,
        "networking": BenefitType.NETWORKING.value,
        "recruiter": BenefitType.RECRUITER.value,
        "other": BenefitType.OTHER.value,
    }
    sanitized["benefit_type"] = benefit_type_map.get(normalized, BenefitType.OTHER.value)
    return sanitized


def _sanitize_milestone(milestone: Any) -> Any:
    if not isinstance(milestone, dict):
        return milestone
    sanitized = dict(milestone)
    milestone_name = sanitized.get("milestone_name")
    if not isinstance(milestone_name, str) or not milestone_name.strip():
        fallback_name = (
            sanitized.get("title")
            or sanitized.get("name")
            or sanitized.get("description")
            or sanitized.get("notes")
        )
        if isinstance(fallback_name, str) and fallback_name.strip():
            milestone_name = fallback_name.strip()
            sanitized["milestone_name"] = milestone_name

    milestone_type = sanitized.get("milestone_type")
    if isinstance(milestone_type, str):
        normalized_type = milestone_type.strip().lower()
        milestone_type_map = {
            "submission_period": "registration_open",
            "submission_window": "registration_open",
            "submission_deadline": "registration_deadline",
            "apply_deadline": "registration_deadline",
        }
        sanitized["milestone_type"] = milestone_type_map.get(normalized_type, milestone_type)

    if not sanitized.get("milestone_type") and isinstance(milestone_name, str):
        lowered = milestone_name.lower()
        if "registration" in lowered and "open" in lowered:
            sanitized["milestone_type"] = "registration_open"
        elif any(token in lowered for token in ("submission", "apply", "deadline", "register by")):
            sanitized["milestone_type"] = "registration_deadline"
        elif "travel grant" in lowered:
            sanitized["milestone_type"] = "travel_grant_deadline"
        elif "accept" in lowered:
            sanitized["milestone_type"] = "acceptance_date"
        elif "confirm" in lowered:
            sanitized["milestone_type"] = "confirmation_deadline"
        elif any(token in lowered for token in ("start", "kickoff", "begins")):
            sanitized["milestone_type"] = "event_start"
        elif any(token in lowered for token in ("end", "ends", "closing ceremony")):
            sanitized["milestone_type"] = "event_end"
        else:
            sanitized["milestone_type"] = "other"
    return sanitized
