from __future__ import annotations

import json
from typing import Any, Mapping

from app.enums import SourceKind
from app.services.normalization_links import _merge_candidate_urls
from app.services.normalization_values import _first_non_empty, _get_string


def _extract_json_seed_context(
    raw_record: Mapping[str, Any],
    source_url: str,
    response_text: str,
    max_chars: int,
    max_discovered_urls: int,
) -> tuple[str, list[tuple[SourceKind, str]]]:
    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError:
        return "", []

    matching_entry = _find_matching_source_entry(raw_record, payload)
    if matching_entry is None:
        return "", []

    excerpt = json.dumps(matching_entry, indent=2, default=str)
    if len(excerpt) > max_chars:
        excerpt = excerpt[: max_chars - 3].rstrip() + "..."
    discovered_urls = _extract_discovered_urls_from_json_entry(matching_entry, max_discovered_urls)
    return excerpt, discovered_urls


def _find_matching_source_entry(raw_record: Mapping[str, Any], payload: Any) -> Mapping[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    entries = payload.get("hackathons")
    if not isinstance(entries, list):
        return None

    record_id = str(raw_record.get("id")).strip() if raw_record.get("id") is not None else None
    record_title = _first_non_empty(raw_record, "title", "event_name", "name")
    record_url = _first_non_empty(raw_record, "url", "official_website", "event_url")

    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        entry_id = entry.get("id")
        if record_id and entry_id is not None and str(entry_id).strip() == record_id:
            return entry
        entry_url = entry.get("url")
        if record_url and isinstance(entry_url, str) and entry_url.strip() == record_url:
            return entry
        entry_title = entry.get("title")
        if record_title and isinstance(entry_title, str) and entry_title.strip() == record_title:
            return entry
    return None


def _extract_discovered_urls_from_json_entry(
    entry: Mapping[str, Any],
    max_discovered_urls: int,
) -> list[tuple[SourceKind, str]]:
    candidates = [
        (SourceKind.OFFICIAL_SITE, _get_string(entry, "url")),
        (SourceKind.REGISTRATION_PAGE, _get_string(entry, "start_a_submission_url", "startSubmissionUrl")),
        (SourceKind.DIRECTORY, _get_string(entry, "submission_gallery_url")),
    ]
    return _merge_candidate_urls([], [(source_type, url) for source_type, url in candidates if url], max_discovered_urls)
