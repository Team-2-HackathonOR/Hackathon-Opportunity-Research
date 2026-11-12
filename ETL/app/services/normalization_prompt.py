from __future__ import annotations

import json
from typing import Any, Mapping

from app.schemas import EventCreate
from app.services.normalization_types import WebContext


def build_prompt(
    raw_record: Mapping[str, Any],
    base_event: EventCreate,
    fetched_sources_text: str,
) -> str:
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


def format_web_context(web_context: WebContext) -> str:
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
