import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from app import models
from app.schemas import EventCreate
from app.services.event_writer import EventWriter


class EventWriterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = MagicMock(spec=Session)
        self.session.scalars.return_value = [1, 2]
        self.session.scalar.return_value = models.EventCategory(category_id=9, category_name="AI")
        self.payload = EventCreate.model_validate({
            "event_name": "Research Hack",
            "operational_status": "monitor",
            "evidence_confidence": "low",
            "primary_researcher_id": 1,
            "verifier_id": 2,
            "registration_fee_amount": "12.50",
            "registration_fee_currency": "eur",
            "categories": [{"category_name": "AI", "is_primary": True}],
            "tracks": [{"track_type": "theme", "track_name": "AI"}],
            "benefits": [{"benefit_type": "prize", "description": "Cash prize"}],
            "sources": [{"source_type": "official_site", "source_url": "https://event.example/"}],
            "milestones": [{"milestone_type": "registration_deadline", "milestone_name": "Apply"}],
            "shortlist_entry": {"queue_type": "apply_now", "why_practical": "Relevant", "shortlisted_by_member_id": 1},
            "application_requirement_items": [
                {"queue_type": "apply_now", "requirement_type": "resume", "requirement_text": "CV", "owner_member_id": 1},
            ],
            "organizer_follow_ups": [{"question_text": "Eligibility?", "assigned_member_id": 1}],
            "verifications": [{"checked_by_member_id": 2, "verification_scope": "Dates", "result": "confirmed"}],
            "contributions": [{"member_id": 1, "contribution_type": "research", "notes": "Reviewed source"}],
        })

        def assign_ids() -> None:
            for call in self.session.add.call_args_list:
                item = call.args[0]
                if isinstance(item, models.Event):
                    item.event_id = 42
                elif isinstance(item, models.EventCategory):
                    item.category_id = 9

        self.session.flush.side_effect = assign_ids

    def test_complete_event_graph_is_linked_and_committed_together(self) -> None:
        verified_at = datetime(2026, 11, 12, tzinfo=UTC)
        self.payload.last_verified_at = verified_at
        event = EventWriter(self.session).create_event(self.payload)
        children = [
            call.args[0] for call in self.session.add.call_args_list
            if not isinstance(call.args[0], models.Event)
        ]
        children.extend(item for call in self.session.add_all.call_args_list for item in call.args[0])

        self.assertEqual(event.event_id, 42)
        self.assertEqual(event.registration_fee_currency, "EUR")
        self.assertEqual(event.registration_fee_amount, self.payload.registration_fee_amount)
        self.assertEqual(event.last_verified_at, verified_at)
        self.assertEqual({type(item) for item in children}, {
            models.EventCategoryAssignment, models.EventTrack, models.EventBenefit,
            models.EventSource, models.EventMilestone, models.ShortlistEntry,
            models.ApplicationRequirement, models.OrganizerFollowUp,
            models.EventVerification, models.ContributionLog,
        })
        self.assertTrue(all(item.event_id == 42 for item in children))
        assignment = next(item for item in children if isinstance(item, models.EventCategoryAssignment))
        self.assertEqual(assignment.category_id, 9)
        self.assertTrue(assignment.is_primary)
        source = next(item for item in children if isinstance(item, models.EventSource))
        self.assertIsNotNone(source.verified_on)
        self.session.commit.assert_called_once_with()
        self.session.refresh.assert_called_once_with(event)

    def test_missing_nested_member_is_rejected_before_any_write(self) -> None:
        self.session.scalars.return_value = [1]
        self.payload.verifier_id = None
        with self.assertRaisesRegex(ValueError, "Unknown team member ids: 2"):
            EventWriter(self.session).create_event(self.payload)
        self.session.add.assert_not_called()
        self.session.add_all.assert_not_called()
        self.session.commit.assert_not_called()

    def test_category_creation_stays_in_event_transaction(self) -> None:
        self.session.scalar.return_value = None
        EventWriter(self.session).create_event(self.payload)
        categories = [
            call.args[0] for call in self.session.add.call_args_list
            if isinstance(call.args[0], models.EventCategory)
        ]
        self.assertEqual(len(categories), 1)
        self.assertEqual(categories[0].category_name, "AI")
        self.assertEqual(self.session.flush.call_count, 2)
        self.session.commit.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
