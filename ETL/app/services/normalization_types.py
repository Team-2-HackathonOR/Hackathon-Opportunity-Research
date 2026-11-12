from __future__ import annotations

from dataclasses import dataclass

from app.enums import SourceKind


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
