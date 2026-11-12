from __future__ import annotations

import re
from typing import Any, Mapping
from urllib.parse import urljoin, urlparse

from app.enums import SourceKind
from app.schemas import EventCreate
from app.services.normalization_html import _normalize_whitespace, _strip_tags
from app.services.normalization_values import _first_non_empty


def _candidate_source_urls(
    raw_record: Mapping[str, Any],
    base_event: EventCreate,
    max_urls: int,
) -> list[tuple[SourceKind, str]]:
    candidates = [
        (SourceKind.OFFICIAL_SITE, base_event.official_website),
        (SourceKind.REGISTRATION_PAGE, base_event.registration_link),
        (SourceKind.RULES_FAQ, base_event.rules_faq_link or _first_non_empty(raw_record, "rules_url", "faq_url")),
        (SourceKind.ORGANIZER_PAGE, _first_non_empty(raw_record, "organizer_url", "host_url")),
    ]
    unique_urls: list[tuple[SourceKind, str]] = []
    seen: set[str] = set()
    for source_type, url in candidates:
        if not url:
            continue
        normalized_url = url.strip()
        if not normalized_url or normalized_url in seen:
            continue
        parsed = urlparse(normalized_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        unique_urls.append((source_type, normalized_url))
        seen.add(normalized_url)
        if len(unique_urls) >= max_urls:
            break
    return unique_urls


def _merge_candidate_urls(
    primary_urls: list[tuple[SourceKind, str]],
    secondary_urls: list[tuple[SourceKind, str]],
    limit: int,
) -> list[tuple[SourceKind, str]]:
    merged: list[tuple[SourceKind, str]] = []
    seen: set[str] = set()
    for source_type, url in [*primary_urls, *secondary_urls]:
        normalized_url = url.strip()
        if not normalized_url or normalized_url in seen:
            continue
        merged.append((source_type, normalized_url))
        seen.add(normalized_url)
        if len(merged) >= limit:
            break
    return merged


def _extract_interesting_links(
    html_content: str,
    base_url: str,
    max_links: int,
) -> list[tuple[SourceKind, str]]:
    matches = re.findall(r"""<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)</a>""", html_content, flags=re.IGNORECASE | re.DOTALL)
    candidates: list[tuple[SourceKind, str]] = []
    for href, anchor_html in matches:
        text = _normalize_whitespace(_strip_tags(anchor_html))
        lowered = f"{href} {text}".lower()
        source_type: SourceKind | None = None
        if any(token in lowered for token in ("rule", "faq", "eligib", "terms")):
            source_type = SourceKind.RULES_FAQ
        elif any(token in lowered for token in ("register", "submit", "apply", "submission")):
            source_type = SourceKind.REGISTRATION_PAGE
        elif any(token in lowered for token in ("prize", "track", "schedule", "detail", "about")):
            source_type = SourceKind.OFFICIAL_SITE
        if source_type is None:
            continue

        absolute_url = urljoin(base_url, href.strip())
        parsed = urlparse(absolute_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        candidates.append((source_type, absolute_url))
    return _merge_candidate_urls([], candidates, max_links)
