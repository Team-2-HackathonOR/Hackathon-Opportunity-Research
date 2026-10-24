from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from app.services.exceptions import UnsupportedFileTypeError


def parse_uploaded_records(filename: str, content: bytes) -> list[dict[str, Any]]:
    suffix = Path(filename).suffix.lower()

    if suffix == ".json":
        payload = json.loads(content.decode("utf-8"))
        if isinstance(payload, list):
            return _ensure_record_list(payload)
        if isinstance(payload, dict):
            if isinstance(payload.get("records"), list):
                return _ensure_record_list(payload["records"])
            return [payload]
        raise UnsupportedFileTypeError("JSON payload must be an object or array of objects.")

    if suffix == ".jsonl":
        records: list[dict[str, Any]] = []
        for line_number, line in enumerate(content.decode("utf-8").splitlines(), start=1):
            stripped = line.strip()
            if not stripped:
                continue
            payload = json.loads(stripped)
            if not isinstance(payload, dict):
                raise UnsupportedFileTypeError(
                    f"JSONL line {line_number} must contain an object record."
                )
            records.append(payload)
        return records

    if suffix == ".csv":
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        return [dict(row) for row in reader]

    raise UnsupportedFileTypeError(
        "Supported file types are .json, .jsonl, and .csv."
    )


def _ensure_record_list(payload: list[Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise UnsupportedFileTypeError(
                f"Record at index {index} must be a JSON object."
            )
        records.append(item)
    return records

