from __future__ import annotations

from typing import Any

from app.services.normalization_values import _coerce_datetime


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
