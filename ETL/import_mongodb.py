from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from app.config import get_settings
from app.schemas import ImportFailure, ImportResult, ImportSuccess
from app.services.etl import EtlService
from app.services.mongo_source import fetch_mongo_records


@dataclass
class ImportRunSummary:
    initial_result: ImportResult
    retry_result: ImportResult | None = None

    @property
    def processed_count(self) -> int:
        return self.initial_result.processed_count

    @property
    def inserted_count(self) -> int:
        retry_inserted = self.retry_result.inserted_count if self.retry_result else 0
        return self.initial_result.inserted_count + retry_inserted

    @property
    def failed_count(self) -> int:
        if self.retry_result is None:
            return self.initial_result.failed_count
        return self.retry_result.failed_count

    @property
    def successes(self) -> list[ImportSuccess]:
        retry_successes = self.retry_result.successes if self.retry_result else []
        return [*self.initial_result.successes, *retry_successes]

    @property
    def failures(self) -> list[ImportFailure]:
        if self.retry_result is None:
            return list(self.initial_result.failures)
        return list(self.retry_result.failures)

    def to_dict(self) -> dict[str, Any]:
        return {
            "processed_count": self.processed_count,
            "inserted_count": self.inserted_count,
            "failed_count": self.failed_count,
            "successes": [item.model_dump(mode="json") for item in self.successes],
            "failures": [item.model_dump(mode="json") for item in self.failures],
            "initial_result": self.initial_result.model_dump(mode="json"),
            "retry_result": self.retry_result.model_dump(mode="json") if self.retry_result else None,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract hackathon records from MongoDB and insert them into PostgreSQL."
    )
    parser.add_argument("--database-name", help="Override the MongoDB database name from settings.")
    parser.add_argument("--collection-name", help="Override the MongoDB collection name from settings.")
    parser.add_argument("--limit", type=int, default=25, help="Maximum number of MongoDB records to import.")
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Disable AI normalization and use deterministic base normalization only.",
    )
    parser.add_argument(
        "--retry-failed-without-ai",
        action="store_true",
        help="Retry only AI-pass failures once with AI normalization disabled.",
    )
    parser.add_argument("--primary-researcher-id", type=int, help="Optional team member id to stamp on imports.")
    parser.add_argument("--verifier-id", type=int, help="Optional verifier team member id to stamp on imports.")
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Print the full machine-readable import summary as JSON.",
    )
    return parser.parse_args()


def retry_failed_records(
    records: Sequence[dict[str, Any]],
    failures: Sequence[ImportFailure],
) -> list[dict[str, Any]]:
    failed_indexes = {failure.record_index for failure in failures}
    return [record for index, record in enumerate(records) if index in failed_indexes]


def print_human_summary(summary: ImportRunSummary) -> None:
    print(f"Processed: {summary.processed_count}")
    print(f"Inserted:  {summary.inserted_count}")
    print(f"Failed:    {summary.failed_count}")

    if summary.successes:
        print("\nInserted events:")
        for success in summary.successes:
            print(f"- [{success.event_id}] {success.event_name}")

    if summary.failures:
        print("\nFailures:")
        for failure in summary.failures:
            identifier = f" ({failure.source_identifier})" if failure.source_identifier else ""
            print(f"- record {failure.record_index}{identifier}: {failure.reason}")


def main() -> int:
    args = parse_args()
    settings = get_settings()
    records = fetch_mongo_records(
        settings=settings,
        limit=args.limit,
        database_name=args.database_name,
        collection_name=args.collection_name,
    )

    service = EtlService(settings)
    initial_result = service.import_records(
        records=records,
        source_name="mongodb",
        use_ai_normalization=not args.no_ai,
        primary_researcher_id=args.primary_researcher_id,
        verifier_id=args.verifier_id,
    )

    retry_result: ImportResult | None = None
    if args.retry_failed_without_ai and not args.no_ai and initial_result.failures:
        retry_records = retry_failed_records(records, initial_result.failures)
        retry_result = service.import_records(
            records=retry_records,
            source_name="mongodb-retry-no-ai",
            use_ai_normalization=False,
            primary_researcher_id=args.primary_researcher_id,
            verifier_id=args.verifier_id,
        )

    summary = ImportRunSummary(initial_result=initial_result, retry_result=retry_result)

    if args.output_json:
        print(json.dumps(summary.to_dict(), indent=2, default=str))
    else:
        print_human_summary(summary)

    return 1 if summary.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
