import os
import sys
import unittest
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

os.environ["GATEWAY_INTERNAL_SECRET"] = "test-gateway-secret-value"
os.environ["SMTP_HOST"] = "smtp.example.com"
os.environ["SMTP_FROM"] = "research@example.com"
os.environ["SMTP_TLS"] = "false"
os.environ["SMTP_USER"] = ""

from main import app  # noqa: E402


class MailServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.headers = {
            "x-gateway-caller": "team-2-gateway",
            "x-gateway-secret": "test-gateway-secret-value",
        }

    def test_rejects_a_caller_without_the_gateway_secret(self) -> None:
        response = self.client.post(
            "/send",
            json={"to": "person@example.com", "subject": "Invite", "text": "hello"},
        )
        self.assertEqual(response.status_code, 403)

    def test_sends_through_smtp_without_logging_the_message(self) -> None:
        sent: list[EmailMessage] = []

        class FakeSmtp:
            def __init__(self, host: str, port: int, timeout: int | None = None) -> None:
                self.host = host
                self.port = port

            def __enter__(self) -> "FakeSmtp":
                return self

            def __exit__(self, *args: object) -> bool:
                return False

            def starttls(self) -> None:
                raise AssertionError("TLS was disabled")

            def login(self, username: str, password: str) -> None:
                raise AssertionError("login should be skipped when SMTP_USER is empty")

            def send_message(self, message: EmailMessage) -> None:
                sent.append(message)

        with patch("main.smtplib.SMTP", FakeSmtp):
            response = self.client.post(
                "/send",
                headers=self.headers,
                json={"to": "person@example.com", "subject": "Invite", "text": "open the link"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"sent": True})
        self.assertEqual(sent[0]["To"], "person@example.com")
        self.assertIn("open the link", sent[0].get_content())

    def test_readiness_fails_when_smtp_host_is_missing(self) -> None:
        with patch.dict(os.environ, {"SMTP_HOST": ""}):
            response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["smtp"], "unavailable")


if __name__ == "__main__":
    unittest.main()
