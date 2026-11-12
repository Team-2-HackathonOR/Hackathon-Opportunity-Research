from __future__ import annotations

from typing import Any, Mapping

import httpx

from app.config import Settings
from app.enums import SourceKind
from app.schemas import EventCreate
from app.services.normalization_documents import _extract_json_seed_context
from app.services.normalization_html import _extract_html_title, _extract_page_excerpt, _normalize_whitespace
from app.services.normalization_links import _candidate_source_urls, _extract_interesting_links, _merge_candidate_urls
from app.services.normalization_types import FetchedWebDocument, WebContext
from app.services.normalization_values import _first_non_empty


class WebContextFetcher:
    settings: Settings

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
