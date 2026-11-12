from __future__ import annotations

from typing import Any, Mapping

import httpx, json, re
from pydantic import ValidationError

from app.config import Settings
from app.schemas import EventCreate
from app.services.exceptions import ConfigurationError, NormalizationError
from app.services.normalization_base import build_base_event_payload
from app.services.normalization_contributions import _ensure_default_contributions
from app.services.normalization_prompt import build_prompt, format_web_context
from app.services.normalization_requirements import (
    _sanitize_application_requirement_item,
    _sanitize_shortlist_entry,
    _sanitize_verification_item,
)
from app.services.normalization_sanitize import (
    _sanitize_benefit,
    _sanitize_milestone,
    _sanitize_source,
    _sanitize_track,
)
from app.services.normalization_types import FetchedWebDocument, WebContext
from app.services.normalization_values import _append_note, _coalesce_member_id, _normalize_date_value
from app.services.normalization_web import WebContextFetcher


__all__ = ["AiNormalizer", "FetchedWebDocument", "WebContext", "build_base_event_payload"]


class AiNormalizer(WebContextFetcher):
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

    def _build_prompt(self, raw_record: Mapping[str, Any], base_event: EventCreate, web_context: WebContext) -> str:
        return build_prompt(raw_record, base_event, self._format_web_context(web_context))

    def _format_web_context(self, web_context: WebContext) -> str:
        return format_web_context(web_context)

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
