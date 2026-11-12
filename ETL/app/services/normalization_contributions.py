from __future__ import annotations

from typing import Any

from app.enums import ContributionType
from app.schemas import ContributionLogInput
from app.services.normalization_values import _coalesce_member_id


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
