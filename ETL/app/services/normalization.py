from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Mapping
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.enums import BenefitType, ContributionType, EventFormat, EvidenceConfidence, OperationalStatus, SourceKind, SupportStatus, TrackKind
from app.schemas import ContributionLogInput, EventBenefitInput, EventCategoryInput, EventCreate, EventSourceInput, EventTrackInput
from app.services.exceptions import ConfigurationError, NormalizationError


@dataclass(frozen=True)
class FetchedWebDocument:
    source_type: SourceKind
    requested_url: str
    resolved_url: str
    title: str | None
    content_kind: str
    excerpt: str


@dataclass(frozen=True)
class WebContext:
    documents: list[FetchedWebDocument]
    errors: list[str]


class AiNormalizer:
    def __init__(self, settings: Settings) -> None:
        if not settings.ai_api_key.strip():
            raise ConfigurationError("AI_API_KEY is required when AI normalization is enabled.")
        self.settings = settings

    def normalize(self, raw_record: Mapping[str, Any], base_event: EventCreate) -> EventCreate:
        web_context = self._fetch_web_context(raw_record, base_event)
        prompt = self._build_prompt(raw_record, base_event, web_context)
        response_json = self._request_completion(prompt)
        normalized_payload = self._extract_json_payload(response_json)

        if not isinstance(normalized_payload, dict):
            raise NormalizationError("AI normalization response must be a JSON object.")

        normalized_payload = self._sanitize_ai_payload(normalized_payload)
        merged = self._merge_payloads(base_event.model_dump(mode="json"), normalized_payload)
        merged = _ensure_default_contributions(merged, base_event.event_name)
        if web_context.errors:
            merged["unresolved_questions"] = _append_note(
                merged.get("unresolved_questions"),
                "Website fetch issues: " + "; ".join(web_context.errors),
            )
        try:
            return EventCreate.model_validate(merged)
        except ValidationError as exc:
            raise NormalizationError(f"AI normalization returned invalid event data: {exc}") from exc

    def _request_completion(self, prompt: str) -> Any:
        endpoint = f"{self.settings.ai_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.ai_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.ai_model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You normalize raw hackathon research records into a validated JSON object. "
                        "Never guess unknown facts. Use null for unknown values. Preserve verified URLs. "
                        "Return JSON only."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }

        with httpx.Client(timeout=self.settings.ai_timeout_seconds) as client:
            response = client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()

        try:
            return body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise NormalizationError("AI completion response did not contain a message content payload.") from exc

    def _build_prompt(
        self,
        raw_record: Mapping[str, Any],
        base_event: EventCreate,
        web_context: WebContext,
    ) -> str:
        fetched_sources_text = self._format_web_context(web_context)
        return (
            "Normalize this hackathon record into the target schema.\n"
            "Rules:\n"
            "- Keep unknown facts as null.\n"
            "- Prefer facts from fetched official or registration pages over directory listings when they conflict.\n"
            "- Do not invent deadlines, fees, rules, eligibility, travel support, or application requirements.\n"
            "- Allowed format values: in_person, virtual, hybrid, unknown.\n"
            "- Allowed operational_status values: verified_apply_now, verified_registration_upcoming, "
            "monitor, needs_confirmation, not_eligible, closed_expired, rejected_unreliable.\n"
            "- Allowed evidence_confidence values: high, medium, low.\n"
            "- Allowed support status values: provided, partially_reimbursed, application_based, "
            "not_provided, not_confirmed.\n"
            "- Populate as many EventCreate fields as the fetched website text supports.\n"
            "- Use source_type official_site for organizer-owned pages, registration_page for submission pages, "
            "and rules_faq for rules or FAQ pages.\n"
            "- categories is a list of {category_name, is_primary}.\n"
            "- tracks is a list of {track_type, track_name, description}.\n"
            "- benefits is a list of {benefit_type, title, description, is_guaranteed_to_all, award_value}.\n"
            "- sources is a list of {source_type, source_url, source_title, is_primary_source, captured_on, verified_on, notes}.\n"
            "- application_requirement_items is a list of "
            "{queue_type, requirement_type, requirement_text, due_at, status, owner_member_id, notes}.\n"
            "- Allowed queue_type values: apply_now, prepare_before_opening.\n"
            "- Allowed requirement_type values: registration_account, resume, portfolio_github, "
            "student_verification, essay_questions, team_information, project_idea, referral_invite, "
            "deadline, post_acceptance_step, other.\n"
            "- Allowed readiness status values: not_started, in_progress, ready, submitted, not_applicable.\n"
            "- Create application_requirement_items when the fetched evidence explicitly describes steps, "
            "materials, deadlines, or post-acceptance actions needed to participate or submit.\n"
            "- Use queue_type=apply_now when the event is open and the requirement is actionable now.\n"
            "- Use queue_type=prepare_before_opening when the event is not open yet but the requirement can be prepared early.\n"
            "- Set requirement_type=deadline only for explicit deadline actions.\n"
            "- Put a human-readable summary of overall application steps into application_requirements when supported.\n"
            "- shortlist_entry may be null, but if the evidence clearly supports a recommendation queue then populate it "
            "with queue_type and why_practical.\n"
            "- verifications is a list of {checked_by_member_id, checked_at, verification_scope, result, notes}.\n"
            "- Allowed verification result values: confirmed, partially_confirmed, needs_follow_up, conflicting.\n"
            "- If the fetched evidence is sufficient to evaluate organizer/publisher legitimacy, official source ownership, "
            "or source consistency, create verification entries.\n"
            "- Prefer a verification_scope like 'publisher legitimacy and official source ownership' or "
            "'event details cross-check between source feed and official pages'.\n"
            "- Use the base draft verifier_id as checked_by_member_id when present; otherwise use primary_researcher_id when present.\n"
            "- If both verifier_id and primary_researcher_id are null, leave verifications empty instead of inventing a member id.\n"
            "- Return a single JSON object using the EventCreate field names.\n\n"
            f"Base normalized draft:\n{json.dumps(base_event.model_dump(mode='json'), indent=2)}\n\n"
            f"Raw source record:\n{json.dumps(raw_record, indent=2, default=str)}\n\n"
            f"Fetched website evidence:\n{fetched_sources_text}"
        )

    def _fetch_web_context(self, raw_record: Mapping[str, Any], base_event: EventCreate) -> WebContext:
        documents: list[FetchedWebDocument] = []
        errors: list[str] = []
        headers = {"User-Agent": "Team2ETL/1.0 (+website enrichment)"}
        urls = _candidate_source_urls(raw_record, base_event, self.settings.ai_web_fetch_max_urls)
        source_seed_url = _first_non_empty(raw_record, "sourceUrl", "source_url")
        discovered_from_seed: list[tuple[SourceKind, str]] = []

        with httpx.Client(
            timeout=self.settings.ai_web_fetch_timeout_seconds,
            follow_redirects=True,
            headers=headers,
        ) as client:
            if source_seed_url:
                source_seed_document, seed_errors, discovered_from_seed = self._fetch_source_seed_document(
                    client,
                    raw_record,
                    source_seed_url,
                )
                if source_seed_document is not None:
                    documents.append(source_seed_document)
                errors.extend(seed_errors)

            if discovered_from_seed:
                urls = _merge_candidate_urls(
                    discovered_from_seed,
                    urls,
                    self.settings.ai_web_fetch_max_urls,
                )

            if not urls and not documents:
                return WebContext(documents=[], errors=["No candidate source URLs were available for website enrichment."])

            for source_type, url in urls:
                try:
                    response = client.get(url)
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    errors.append(f"{source_type.value} {url}: {exc}")
                    continue

                response_documents, discovered_urls, response_errors = self._extract_documents_from_response(
                    response=response,
                    source_type=source_type,
                    requested_url=url,
                )
                documents.extend(response_documents)
                errors.extend(response_errors)

                if discovered_urls:
                    extra_urls = _merge_candidate_urls(
                        urls,
                        discovered_urls,
                        self.settings.ai_web_fetch_max_urls + self.settings.ai_web_fetch_max_discovered_urls,
                    )
                    urls = extra_urls

        return WebContext(documents=documents, errors=errors)

    def _fetch_source_seed_document(
        self,
        client: httpx.Client,
        raw_record: Mapping[str, Any],
        source_seed_url: str,
    ) -> tuple[FetchedWebDocument | None, list[str], list[tuple[SourceKind, str]]]:
        errors: list[str] = []
        try:
            response = client.get(source_seed_url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            return None, [f"directory {source_seed_url}: {exc}"], []

        content_type = response.headers.get("content-type", "")
        if "json" in content_type.lower():
            excerpt, discovered_urls = _extract_json_seed_context(
                raw_record=raw_record,
                source_url=source_seed_url,
                response_text=response.text,
                max_chars=self.settings.ai_web_fetch_max_chars,
                max_discovered_urls=self.settings.ai_web_fetch_max_discovered_urls,
            )
            if not excerpt:
                errors.append(f"directory {source_seed_url}: JSON source did not contain a matching record snippet")
                return None, errors, discovered_urls
            return (
                FetchedWebDocument(
                    source_type=SourceKind.DIRECTORY,
                    requested_url=source_seed_url,
                    resolved_url=str(response.url),
                    title="Source directory JSON",
                    content_kind="json",
                    excerpt=excerpt,
                ),
                errors,
                discovered_urls,
            )

        excerpt = _extract_page_excerpt(response.text, self.settings.ai_web_fetch_max_chars)
        if not excerpt:
            errors.append(f"directory {source_seed_url}: fetched page had no usable text content")
            return None, errors, []
        discovered_urls = _extract_interesting_links(
            html_content=response.text,
            base_url=str(response.url),
            max_links=self.settings.ai_web_fetch_max_discovered_urls,
        )
        return (
            FetchedWebDocument(
                source_type=SourceKind.DIRECTORY,
                requested_url=source_seed_url,
                resolved_url=str(response.url),
                title=_extract_html_title(response.text),
                content_kind="html",
                excerpt=excerpt,
            ),
            errors,
            discovered_urls,
        )

    def _extract_documents_from_response(
        self,
        response: httpx.Response,
        source_type: SourceKind,
        requested_url: str,
    ) -> tuple[list[FetchedWebDocument], list[tuple[SourceKind, str]], list[str]]:
        content_type = response.headers.get("content-type", "")
        if "json" in content_type.lower():
            excerpt = _normalize_whitespace(response.text)
            if len(excerpt) > self.settings.ai_web_fetch_max_chars:
                excerpt = excerpt[: self.settings.ai_web_fetch_max_chars - 3].rstrip() + "..."
            if not excerpt:
                return [], [], [f"{source_type.value} {requested_url}: fetched JSON had no usable text content"]
            return (
                [
                    FetchedWebDocument(
                        source_type=source_type,
                        requested_url=requested_url,
                        resolved_url=str(response.url),
                        title=None,
                        content_kind="json",
                        excerpt=excerpt,
                    )
                ],
                [],
                [],
            )

        excerpt = _extract_page_excerpt(response.text, self.settings.ai_web_fetch_max_chars)
        if not excerpt:
            return [], [], [f"{source_type.value} {requested_url}: fetched page had no usable text content"]
        discovered_urls = _extract_interesting_links(
            html_content=response.text,
            base_url=str(response.url),
            max_links=self.settings.ai_web_fetch_max_discovered_urls,
        )
        return (
            [
                FetchedWebDocument(
                    source_type=source_type,
                    requested_url=requested_url,
                    resolved_url=str(response.url),
                    title=_extract_html_title(response.text),
                    content_kind="html",
                    excerpt=excerpt,
                )
            ],
            discovered_urls,
            [],
        )

    def _format_web_context(self, web_context: WebContext) -> str:
        sections: list[str] = []
        if web_context.documents:
            for index, document in enumerate(web_context.documents, start=1):
                title_line = f"title={document.title}" if document.title else "title=<none>"
                sections.append(
                    f"[{index}] source_type={document.source_type.value}\n"
                    f"requested_url={document.requested_url}\n"
                    f"resolved_url={document.resolved_url}\n"
                    f"content_kind={document.content_kind}\n"
                    f"{title_line}\n"
                    f"content_excerpt=\n{document.excerpt}"
                )
        else:
            sections.append("No website content was fetched.")

        if web_context.errors:
            sections.append("Fetch errors:\n- " + "\n- ".join(web_context.errors))

        return "\n\n".join(sections)

    def _extract_json_payload(self, response_content: Any) -> Any:
        if isinstance(response_content, dict):
            return response_content
        if not isinstance(response_content, str):
            raise NormalizationError("AI normalization response content is not JSON text.")

        stripped = response_content.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
            stripped = re.sub(r"\s*```$", "", stripped)

        try:
            return json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise NormalizationError("AI normalization response was not valid JSON.") from exc

    def _merge_payloads(self, base_payload: dict[str, Any], ai_payload: dict[str, Any]) -> dict[str, Any]:
        merged = dict(base_payload)
        for key, value in ai_payload.items():
            if value in (None, "", [], {}):
                continue
            merged[key] = value
        return merged

    def _sanitize_ai_payload(self, ai_payload: dict[str, Any]) -> dict[str, Any]:
        sanitized = dict(ai_payload)
        for field_name in ("event_start_date", "event_end_date", "acceptance_date"):
            sanitized[field_name] = _normalize_date_value(sanitized.get(field_name))

        if isinstance(sanitized.get("tracks"), list):
            sanitized["tracks"] = [_sanitize_track(track) for track in sanitized["tracks"]]

        if isinstance(sanitized.get("benefits"), list):
            sanitized["benefits"] = [_sanitize_benefit(benefit) for benefit in sanitized["benefits"]]

        if isinstance(sanitized.get("sources"), list):
            sanitized["sources"] = [_sanitize_source(source) for source in sanitized["sources"]]

        if isinstance(sanitized.get("milestones"), list):
            sanitized["milestones"] = [_sanitize_milestone(milestone) for milestone in sanitized["milestones"]]

        if isinstance(sanitized.get("application_requirement_items"), list):
            sanitized["application_requirement_items"] = [
                _sanitize_application_requirement_item(item)
                for item in sanitized["application_requirement_items"]
            ]

        if isinstance(sanitized.get("shortlist_entry"), dict):
            sanitized["shortlist_entry"] = _sanitize_shortlist_entry(sanitized["shortlist_entry"])

        if isinstance(sanitized.get("verifications"), list):
            fallback_member_id = _coalesce_member_id(
                sanitized.get("verifier_id"),
                sanitized.get("primary_researcher_id"),
            )
            sanitized["verifications"] = [
                item
                for item in (
                    _sanitize_verification_item(item, fallback_member_id)
                    for item in sanitized["verifications"]
                )
                if item is not None
            ]

        return sanitized


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


def _get_string(mapping: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_html_title(content: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", content, flags=re.IGNORECASE | re.DOTALL)
    if match is None:
        return None
    title = _normalize_whitespace(_strip_tags(match.group(1)))
    return title or None


def _extract_page_excerpt(content: str, max_chars: int) -> str:
    content_without_scripts = re.sub(
        r"<(script|style)[^>]*>.*?</\1>",
        " ",
        content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    text = _normalize_whitespace(_strip_tags(content_without_scripts))
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def _strip_tags(content: str) -> str:
    without_comments = re.sub(r"<!--.*?-->", " ", content, flags=re.DOTALL)
    without_tags = re.sub(r"<[^>]+>", " ", without_comments)
    return html.unescape(without_tags)


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


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


def _sanitize_application_requirement_item(item: Any) -> Any:
    if not isinstance(item, dict):
        return item
    sanitized = dict(item)

    queue_type = sanitized.get("queue_type")
    if isinstance(queue_type, str):
        normalized_queue_type = queue_type.strip().lower()
        queue_type_map = {
            "apply_now": "apply_now",
            "apply": "apply_now",
            "open": "apply_now",
            "registration_open": "apply_now",
            "prepare_before_opening": "prepare_before_opening",
            "prepare": "prepare_before_opening",
            "upcoming": "prepare_before_opening",
            "pre_open": "prepare_before_opening",
        }
        sanitized["queue_type"] = queue_type_map.get(normalized_queue_type, queue_type)

    requirement_type = sanitized.get("requirement_type")
    if isinstance(requirement_type, str):
        normalized_requirement_type = requirement_type.strip().lower()
        requirement_type_map = {
            "registration_account": "registration_account",
            "account": "registration_account",
            "signup": "registration_account",
            "resume": "resume",
            "cv": "resume",
            "portfolio": "portfolio_github",
            "portfolio_github": "portfolio_github",
            "github": "portfolio_github",
            "student_verification": "student_verification",
            "student_id": "student_verification",
            "essay": "essay_questions",
            "essay_questions": "essay_questions",
            "team_information": "team_information",
            "team": "team_information",
            "project_idea": "project_idea",
            "idea": "project_idea",
            "referral": "referral_invite",
            "invite": "referral_invite",
            "deadline": "deadline",
            "demo_video_requirements": "other",
            "demo_video": "other",
            "video": "other",
            "post_acceptance": "post_acceptance_step",
            "post_acceptance_step": "post_acceptance_step",
            "other": "other",
        }
        sanitized["requirement_type"] = requirement_type_map.get(normalized_requirement_type, requirement_type)

    status = sanitized.get("status")
    if isinstance(status, str):
        normalized_status = status.strip().lower()
        status_map = {
            "not_started": "not_started",
            "not started": "not_started",
            "in_progress": "in_progress",
            "in progress": "in_progress",
            "ready": "ready",
            "submitted": "submitted",
            "not_applicable": "not_applicable",
            "n/a": "not_applicable",
        }
        sanitized["status"] = status_map.get(normalized_status, status)

    due_at = sanitized.get("due_at")
    if isinstance(due_at, str):
        parsed_due_at = _coerce_datetime(due_at)
        if parsed_due_at is not None:
            sanitized["due_at"] = parsed_due_at.isoformat()

    requirement_text = sanitized.get("requirement_text")
    if not isinstance(requirement_text, str) or not requirement_text.strip():
        fallback_text = sanitized.get("description") or sanitized.get("name") or sanitized.get("title")
        if isinstance(fallback_text, str) and fallback_text.strip():
            sanitized["requirement_text"] = fallback_text.strip()

    notes = sanitized.get("notes")
    if isinstance(notes, bool):
        sanitized["notes"] = str(notes)

    return sanitized


def _sanitize_shortlist_entry(entry: Any) -> Any:
    if not isinstance(entry, dict):
        return entry
    sanitized = dict(entry)
    queue_type = sanitized.get("queue_type")
    if isinstance(queue_type, str):
        normalized_queue_type = queue_type.strip().lower()
        queue_type_map = {
            "apply_now": "apply_now",
            "apply": "apply_now",
            "prepare_before_opening": "prepare_before_opening",
            "prepare": "prepare_before_opening",
            "upcoming": "prepare_before_opening",
        }
        sanitized["queue_type"] = queue_type_map.get(normalized_queue_type, queue_type)

    why_practical = sanitized.get("why_practical")
    if (not isinstance(why_practical, str) or not why_practical.strip()) and isinstance(
        sanitized.get("technical_relevance"), str
    ):
        sanitized["why_practical"] = sanitized["technical_relevance"].strip()
    return sanitized


def _sanitize_verification_item(item: Any, fallback_member_id: int | None) -> Any:
    if not isinstance(item, dict):
        return item
    sanitized = dict(item)

    checked_by_member_id = sanitized.get("checked_by_member_id")
    if checked_by_member_id in (None, "") and fallback_member_id is not None:
        sanitized["checked_by_member_id"] = fallback_member_id

    checked_at = sanitized.get("checked_at")
    if isinstance(checked_at, str):
        parsed_checked_at = _coerce_datetime(checked_at)
        if parsed_checked_at is not None:
            sanitized["checked_at"] = parsed_checked_at.isoformat()

    result = sanitized.get("result")
    if isinstance(result, str):
        normalized_result = result.strip().lower()
        result_map = {
            "confirmed": "confirmed",
            "confirm": "confirmed",
            "partially_confirmed": "partially_confirmed",
            "partially confirmed": "partially_confirmed",
            "partial": "partially_confirmed",
            "needs_follow_up": "needs_follow_up",
            "needs follow up": "needs_follow_up",
            "follow_up": "needs_follow_up",
            "conflicting": "conflicting",
            "conflict": "conflicting",
        }
        sanitized["result"] = result_map.get(normalized_result, result)

    verification_scope = sanitized.get("verification_scope")
    if not isinstance(verification_scope, str) or not verification_scope.strip():
        fallback_scope = sanitized.get("scope") or sanitized.get("title") or sanitized.get("notes")
        if isinstance(fallback_scope, str) and fallback_scope.strip():
            sanitized["verification_scope"] = fallback_scope.strip()

    notes = sanitized.get("notes")
    if isinstance(notes, bool):
        sanitized["notes"] = str(notes)

    if sanitized.get("checked_by_member_id") in (None, ""):
        return None

    return sanitized


def _coalesce_member_id(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int):
            return value
    return None


def _build_default_contributions(
    event_name: str,
    primary_researcher_id: int | None,
    verifier_id: int | None,
) -> list[ContributionLogInput]:
    contributions: list[ContributionLogInput] = []
    if primary_researcher_id is not None:
        contributions.append(
            ContributionLogInput(
                member_id=primary_researcher_id,
                contribution_type=ContributionType.RESEARCH,
                notes=f"Imported and normalized ETL source material for {event_name}.",
            )
        )
    if verifier_id is not None:
        contributions.append(
            ContributionLogInput(
                member_id=verifier_id,
                contribution_type=ContributionType.VERIFICATION,
                notes=f"Reviewed imported evidence and verification signals for {event_name}.",
            )
        )
    return contributions


def _ensure_default_contributions(merged_payload: dict[str, Any], event_name: str) -> dict[str, Any]:
    payload = dict(merged_payload)
    existing_items = payload.get("contributions")
    if not isinstance(existing_items, list):
        existing_items = []

    seen_pairs: set[tuple[int, str]] = set()
    for item in existing_items:
        if not isinstance(item, dict):
            continue
        member_id = item.get("member_id")
        contribution_type = item.get("contribution_type")
        if isinstance(member_id, int) and isinstance(contribution_type, str):
            seen_pairs.add((member_id, contribution_type))

    default_items = _build_default_contributions(
        event_name=event_name,
        primary_researcher_id=_coalesce_member_id(payload.get("primary_researcher_id")),
        verifier_id=_coalesce_member_id(payload.get("verifier_id")),
    )
    for item in default_items:
        pair = (item.member_id, item.contribution_type.value)
        if pair not in seen_pairs:
            existing_items.append(item.model_dump(mode="json"))
            seen_pairs.add(pair)

    payload["contributions"] = existing_items
    return payload
