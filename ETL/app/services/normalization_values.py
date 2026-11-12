from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any, Mapping

from app.enums import EventFormat, OperationalStatus, SourceKind


def _first_non_empty(raw_record: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = raw_record.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
        else:
            return str(value)
    return None


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def _extract_domain(url: str | None) -> str | None:
    if not url:
        return None
    match = re.match(r"https?://([^/]+)", url)
    return match.group(1) if match else None


def _extract_location_fields(
    raw_record: Mapping[str, Any],
) -> tuple[str | None, str | None, str | None, str | None, EventFormat]:
    raw_location = raw_record.get("location") or raw_record.get("venue") or raw_record.get("displayed_location")
    if isinstance(raw_location, Mapping):
        raw_location = raw_location.get("location")
    if not isinstance(raw_location, str) or not raw_location.strip():
        return None, None, None, None, EventFormat.UNKNOWN

    location = raw_location.strip()
    lowered = location.lower()
    if "virtual" in lowered or "online" in lowered or "remote" in lowered:
        return None, None, None, location, EventFormat.VIRTUAL
    if "hybrid" in lowered:
        return None, None, None, location, EventFormat.HYBRID

    parts = [part.strip() for part in location.split(",") if part.strip()]
    if len(parts) >= 3:
        return parts[0], parts[1], parts[2], location, EventFormat.IN_PERSON
    if len(parts) == 2:
        return parts[0], parts[1], None, location, EventFormat.IN_PERSON
    return parts[0], None, None, location, EventFormat.IN_PERSON


def _map_operational_status(status_text: str | None) -> OperationalStatus:
    if status_text is None:
        return OperationalStatus.MONITOR

    lowered = status_text.lower()
    if any(token in lowered for token in ("closed", "ended", "expired")):
        return OperationalStatus.CLOSED_EXPIRED
    if any(token in lowered for token in ("open", "accepting", "live")):
        return OperationalStatus.VERIFIED_APPLY_NOW
    if any(token in lowered for token in ("upcoming", "soon", "opens")):
        return OperationalStatus.VERIFIED_REGISTRATION_UPCOMING
    return OperationalStatus.MONITOR


def _get_string(mapping: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _append_note(existing: Any, note: str) -> str:
    current = str(existing).strip() if existing is not None else ""
    if not current:
        return note
    if note in current:
        return current
    return f"{current} {note}"


def _infer_source_type(url: str) -> SourceKind:
    lowered = url.lower()
    if "faq" in lowered or "rules" in lowered:
        return SourceKind.RULES_FAQ
    if any(token in lowered for token in ("devpost.com", "register", "submission", "signup", "apply")):
        return SourceKind.REGISTRATION_PAGE
    return SourceKind.OFFICIAL_SITE


def _normalize_date_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    parsed = _coerce_datetime(value)
    if parsed is None:
        return value
    return parsed.date().isoformat()


def _coalesce_member_id(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int):
            return value
    return None
