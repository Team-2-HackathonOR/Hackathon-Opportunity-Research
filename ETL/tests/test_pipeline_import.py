import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.config import Settings
from app.schemas import ImportResult, MongoImportRequest
from app.services.mongo_source import fetch_mongo_records


test_settings = Settings(
    _env_file=None,
    DATABASE_URL="postgresql://user:password@localhost/test",
    MONGODB_CONNECTION_STRING="mongodb://localhost:27017",
    AI_API_KEY="environment-key-fixture",
    GATEWAY_INTERNAL_SECRET="gateway-test-secret",
)
with patch("app.config.get_settings", return_value=test_settings):
    import main


class PipelineImportTests(unittest.TestCase):
    def test_api_rejects_direct_calls_and_accepts_gateway_caller(self) -> None:
        result = ImportResult(
            source="mongodb", processed_count=0, inserted_count=0,
            failed_count=0, successes=[], failures=[],
        )
        with (
            patch.object(main, "settings", test_settings),
            patch.object(main, "fetch_mongo_records", return_value=[]) as fetch,
            patch.object(main, "EtlService") as service,
            TestClient(main.app) as client,
        ):
            service.return_value.import_records.return_value = result
            direct = client.post("/etl/import/mongodb", json={"use_ai_normalization": False})
            self.assertEqual(direct.status_code, 403)
            fetch.assert_not_called()
            trusted = client.post(
                "/etl/import/mongodb",
                json={"use_ai_normalization": False},
                headers={
                    "x-gateway-caller": "team-2-gateway",
                    "x-gateway-secret": "gateway-test-secret",
                },
            )
            self.assertEqual(trusted.status_code, 200)
            fetch.assert_called_once()
    def test_mongo_fetch_filters_run_and_does_not_limit_full_import(self) -> None:
        client = MagicMock()
        cursor = client.__getitem__.return_value.__getitem__.return_value.find.return_value
        cursor.__iter__.return_value = iter([{"id": 1}])
        with patch("app.services.mongo_source.MongoClient", return_value=client):
            records = fetch_mongo_records(test_settings, None, fetched_at="run-timestamp")
        self.assertEqual(records, [{"id": 1}])
        client.__getitem__.return_value.__getitem__.return_value.find.assert_called_once_with(
            {"fetchedAt": "run-timestamp"}, {"_id": 0}
        )
        cursor.limit.assert_not_called()
        client.close.assert_called_once()

    def test_run_key_is_request_scoped_and_all_records_are_imported(self) -> None:
        result = ImportResult(
            source="mongodb", processed_count=0, inserted_count=0,
            failed_count=0, successes=[], failures=[],
        )
        with (
            patch.object(main, "settings", test_settings),
            patch.object(main, "fetch_mongo_records", return_value=[]) as fetch,
            patch.object(main, "EtlService") as service,
        ):
            service.return_value.import_records.return_value = result
            payload = MongoImportRequest(limit=None, fetched_at="run-timestamp")
            self.assertEqual(main.import_from_mongodb(payload, "run-key-fixture"), result)
            scoped = service.call_args.args[0]
            self.assertEqual(scoped.ai_api_key, "run-key-fixture")
            self.assertEqual(test_settings.ai_api_key, "environment-key-fixture")
            self.assertIsNot(scoped, test_settings)
            self.assertIsNone(fetch.call_args.kwargs["limit"])
            self.assertEqual(fetch.call_args.kwargs["fetched_at"], "run-timestamp")
            self.assertTrue(service.return_value.import_records.call_args.kwargs["use_ai_normalization"])

    def test_unlimited_import_without_run_timestamp_is_rejected(self) -> None:
        with patch.object(main, "fetch_mongo_records") as fetch:
            with self.assertRaises(HTTPException) as raised:
                main.import_from_mongodb(MongoImportRequest(limit=None))
            self.assertEqual(raised.exception.status_code, 400)
            fetch.assert_not_called()

    def test_normal_import_keeps_default_limit(self) -> None:
        self.assertEqual(MongoImportRequest().limit, 25)


if __name__ == "__main__":
    unittest.main()
