from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Mapping

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db import SessionLocal
from app.schemas import EventCreate, ImportFailure, ImportResult, ImportSuccess
from app.services.event_writer import EventWriter
from app.services.exceptions import NormalizationError
from app.services.normalization import AiNormalizer, build_base_event_payload


class EtlService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def import_records(
        self,
        records: Sequence[Mapping[str, Any]],
        source_name: str,
        use_ai_normalization: bool,
        primary_researcher_id: int | None,
        verifier_id: int | None,
    ) -> ImportResult:
        ai_normalizer = AiNormalizer(self.settings) if use_ai_normalization else None

        successes: list[ImportSuccess] = []
        failures: list[ImportFailure] = []

        for index, record in enumerate(records):
            identifier = _source_identifier(record)
            try:
                payload = build_base_event_payload(record, primary_researcher_id, verifier_id)
                if ai_normalizer is not None:
                    payload = ai_normalizer.normalize(record, payload)
                else:
                    payload = EventCreate.model_validate(payload.model_dump(mode="json"))
            except (NormalizationError, ValidationError) as exc:
                failures.append(
                    ImportFailure(
                        record_index=index,
                        source_identifier=identifier,
                        reason=str(exc),
                    )
                )
                continue

            session = SessionLocal()
            try:
                writer = EventWriter(session)
                event = writer.create_event(payload)
            except IntegrityError as exc:
                session.rollback()
                failures.append(
                    ImportFailure(
                        record_index=index,
                        source_identifier=identifier,
                        reason=_format_integrity_error(exc),
                    )
                )
            except ValueError as exc:
                session.rollback()
                failures.append(
                    ImportFailure(
                        record_index=index,
                        source_identifier=identifier,
                        reason=str(exc),
                    )
                )
            finally:
                session.close()
            if 'event' in locals():
                successes.append(
                    ImportSuccess(
                        record_index=index,
                        source_identifier=identifier,
                        event_id=event.event_id,
                        event_name=event.event_name,
                    )
                )
                del event

        return ImportResult(
            source=source_name,
            processed_count=len(records),
            inserted_count=len(successes),
            failed_count=len(failures),
            successes=successes,
            failures=failures,
        )


def _source_identifier(record: Mapping[str, Any]) -> str | None:
    for key in ("id", "event_name", "title", "name", "url"):
        value = record.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return None


def _format_integrity_error(exc: IntegrityError) -> str:
    original = exc.orig
    if original is None:
        return "Database integrity error while inserting the event."
    return str(original)

