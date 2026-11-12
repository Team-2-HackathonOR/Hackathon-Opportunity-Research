from __future__ import annotations

import html, re


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
