import json
import unittest
from unittest.mock import patch

import httpx

from app.config import Settings
from app.enums import BenefitType, ContributionType, EventFormat, SourceKind, TrackKind
from app.services.exceptions import NormalizationError
from app.services.normalization import AiNormalizer, build_base_event_payload


class NormalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            _env_file=None,
            DATABASE_URL="postgresql://user:password@localhost/test",
            MONGODB_CONNECTION_STRING="mongodb://localhost:27017",
            AI_API_KEY="test-completion-key",
        )
        self.record = {
            "id": 7,
            "title": "Research Hack",
            "url": "https://event.example/",
            "sourceUrl": "https://directory.example/feed",
            "themes": [{"name": "AI"}, {"name": "AI"}, "Climate"],
            "location": "Online",
            "status": "open",
            "prizeAmount": "$500",
        }

    def test_base_mapping_preserves_nested_records_and_research_credits(self) -> None:
        event = build_base_event_payload(self.record, 1, 2)

        self.assertEqual(event.event_name, "Research Hack")
        self.assertEqual(event.format, EventFormat.VIRTUAL)
        self.assertEqual([item.category_name for item in event.categories], ["AI", "Climate"])
        self.assertEqual([item.is_primary for item in event.categories], [True, False])
        self.assertEqual([item.track_type for item in event.tracks], [TrackKind.THEME] * 2)
        self.assertEqual(event.benefits[0].award_value, "$500")
        self.assertEqual(event.sources[-1].source_type, SourceKind.DIRECTORY)
        self.assertEqual(
            [(item.member_id, item.contribution_type) for item in event.contributions],
            [(1, ContributionType.RESEARCH), (2, ContributionType.VERIFICATION)],
        )
        with self.assertRaisesRegex(NormalizationError, "missing an event name"):
            build_base_event_payload({}, None, None)

    def test_ai_flow_fetches_evidence_sanitizes_aliases_and_preserves_base_fields(self) -> None:
        requests = []
        completion = {
            "official_website": None,
            "event_start_date": "2026-12-01T10:00:00Z",
            "tracks": [{"track_type": "mini_challenge", "track_name": "Sponsor"}],
            "benefits": [{"benefit_type": "recognition", "description": "Career exposure"}],
            "application_requirement_items": [
                {"queue_type": "apply", "requirement_type": "cv", "title": "Upload CV", "notes": False},
            ],
            "verifier_id": 2,
            "verifications": [{"scope": "Source ownership", "result": "confirm"}],
        }

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "POST":
                prompt = json.loads(request.content)["messages"][1]["content"]
                self.assertIn("Verified official evidence", prompt)
                self.assertIn("Source directory JSON", prompt)
                self.assertEqual(request.headers["authorization"], "Bearer test-completion-key")
                return httpx.Response(200, json={
                    "choices": [{"message": {"content": "```json\n" + json.dumps(completion) + "\n```"}}],
                })
            self.assertNotIn("authorization", request.headers)
            if request.url.host == "directory.example":
                return httpx.Response(200, json={"hackathons": [self.record]})
            return httpx.Response(200, text="<title>Official</title><p>Verified official evidence</p>")

        client_type = httpx.Client
        transport = httpx.MockTransport(respond)
        with patch(
            "app.services.normalization.httpx.Client",
            side_effect=lambda **kwargs: client_type(transport=transport, **kwargs),
        ):
            base = build_base_event_payload(self.record, 1, 2)
            event = AiNormalizer(self.settings).normalize(self.record, base)

        self.assertEqual(event.official_website, self.record["url"])
        self.assertEqual(event.event_start_date.isoformat(), "2026-12-01")
        self.assertEqual(event.tracks[0].track_type, TrackKind.SPONSOR_CHALLENGE)
        self.assertEqual(event.benefits[0].benefit_type, BenefitType.CAREER_EXPOSURE)
        self.assertEqual(event.application_requirement_items[0].requirement_text, "Upload CV")
        self.assertEqual(event.application_requirement_items[0].notes, "False")
        self.assertEqual(event.verifications[0].checked_by_member_id, 2)
        self.assertEqual(len(event.contributions), 2)
        self.assertEqual(len([request for request in requests if request.method == "POST"]), 1)

    def test_fetch_failures_remain_visible_and_invalid_completion_is_rejected(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})
            raise httpx.ConnectError("unavailable", request=request)

        client_type = httpx.Client
        transport = httpx.MockTransport(respond)
        with patch(
            "app.services.normalization.httpx.Client",
            side_effect=lambda **kwargs: client_type(transport=transport, **kwargs),
        ):
            normalizer = AiNormalizer(self.settings)
            event = normalizer.normalize(self.record, build_base_event_payload(self.record, None, None))
        self.assertIn("Website fetch issues:", event.unresolved_questions)
        self.assertIn("unavailable", event.unresolved_questions)
        with self.assertRaisesRegex(NormalizationError, "not valid JSON"):
            normalizer._extract_json_payload("not JSON")


if __name__ == "__main__":
    unittest.main()
