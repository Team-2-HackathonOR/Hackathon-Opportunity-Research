from __future__ import annotations

import json
import logging
from hmac import compare_digest
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from starlette.responses import JSONResponse
from pydantic import ValidationError
from pymongo.errors import PyMongoError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.schemas import (
    ApiMessage,
    EventCreate,
    EventResponse,
    ImportResult,
    MongoImportRequest,
    TeamMemberCreate,
    TeamMemberResponse,
)
from app.services.etl import EtlService
from app.services.event_writer import EventWriter
from app.services.exceptions import ConfigurationError, NormalizationError, UnsupportedFileTypeError
from app.services.file_parser import parse_uploaded_records
from app.services.mongo_source import fetch_mongo_records


app = FastAPI(
    title="Hackathon Research ETL API",
    version="1.0.0",
    description="Insert-only FastAPI service for the hackathon research PostgreSQL schema.",
)

settings = get_settings()
etl_service = EtlService(settings)


@app.middleware("http")
async def require_gateway(request: Request, call_next):
    if request.url.path.startswith(("/etl/", "/events", "/team-members")):
        expected = settings.gateway_internal_secret
        if not expected:
            logging.getLogger(__name__).error("ETL gateway authorization is not configured.")
            return JSONResponse(status_code=503, content={"detail": "Gateway authorization is not configured."})
        supplied = request.headers.get("x-gateway-secret", "")
        if request.headers.get("x-gateway-caller") != "team-2-gateway" or not compare_digest(
            supplied.encode("utf-8"), expected.encode("utf-8")
        ):
            logging.getLogger(__name__).warning("Direct ETL API access denied.")
            return JSONResponse(status_code=403, content={"detail": "Use the main gateway to access ETL."})
    return await call_next(request)


@app.get("/", response_model=ApiMessage)
def root() -> ApiMessage:
    return ApiMessage(detail="Hackathon Research ETL API is running.")


@app.post("/team-members", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED)
def create_team_member(payload: TeamMemberCreate, db: Session = Depends(get_db)) -> TeamMemberResponse:
    try:
        member = EventWriter(db).create_team_member(
            full_name=payload.full_name,
            email=payload.email,
            role_name=payload.role_name,
            active=payload.active,
        )
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc.orig) if exc.orig else "Could not insert team member.",
        ) from exc
    return TeamMemberResponse.model_validate(member)


@app.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, db: Session = Depends(get_db)) -> EventResponse:
    try:
        event = EventWriter(db).create_event(payload)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc.orig) if exc.orig else "Could not insert event.",
        ) from exc
    return EventResponse(
        event_id=event.event_id,
        event_name=event.event_name,
        operational_status=event.operational_status,
        evidence_confidence=event.evidence_confidence,
    )


@app.post("/etl/import/mongodb", response_model=ImportResult)
def import_from_mongodb(
    payload: MongoImportRequest,
    ai_api_key: Annotated[str | None, Header(alias="x-ai-api-key", max_length=4096)] = None,
) -> ImportResult:
    if payload.limit is None and not payload.fetched_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An unlimited import requires a scraper fetched_at timestamp.",
        )
    if payload.cursor_mode and (not payload.fetched_at or payload.limit != 1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cursor imports require fetched_at and a one-record limit.",
        )
    if payload.after_id is not None and not payload.cursor_mode:
        raise HTTPException(status_code=400, detail="after_id requires cursor_mode.")
    run_settings = settings.model_copy(update={"ai_api_key": ai_api_key.strip()}) if ai_api_key else settings
    if payload.cursor_mode:
        run_settings = run_settings.model_copy(update={
            "ai_timeout_seconds": min(run_settings.ai_timeout_seconds, 45),
            "ai_web_fetch_timeout_seconds": min(run_settings.ai_web_fetch_timeout_seconds, 10),
            "ai_web_fetch_max_urls": min(run_settings.ai_web_fetch_max_urls, 3),
            "ai_web_fetch_max_discovered_urls": min(run_settings.ai_web_fetch_max_discovered_urls, 2),
        })
    try:
        records = fetch_mongo_records(
            settings=run_settings,
            limit=payload.limit,
            database_name=payload.database_name,
            collection_name=payload.collection_name,
            fetched_at=payload.fetched_at,
            **({"cursor_mode": True, "after_id": payload.after_id} if payload.cursor_mode else {}),
        )
        if payload.cursor_mode and any(
            not isinstance(record.get("id"), int) or isinstance(record.get("id"), bool) for record in records
        ):
            raise HTTPException(status_code=422, detail="Cursor imports require numeric source IDs.")
        result = EtlService(run_settings).import_records(
            records=records,
            source_name="mongodb",
            use_ai_normalization=payload.use_ai_normalization,
            primary_researcher_id=payload.primary_researcher_id,
            verifier_id=payload.verifier_id,
        )
        if payload.cursor_mode and records:
            result.next_after_id = records[-1]["id"]
        if result.failed_count:
            logging.getLogger(__name__).warning(
                "MongoDB ETL import had %s failed records out of %s processed.",
                result.failed_count,
                result.processed_count,
            )
        return result
    except ConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    except NormalizationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"MongoDB extraction failed: {exc}",
        ) from exc


@app.post("/etl/import/file", response_model=ImportResult)
async def import_from_file(
    file: UploadFile = File(...),
    use_ai_normalization: Annotated[bool, Form()] = True,
    primary_researcher_id: Annotated[int | None, Form()] = None,
    verifier_id: Annotated[int | None, Form()] = None,
) -> ImportResult:
    try:
        content = await file.read()
        records = parse_uploaded_records(file.filename or "upload", content)
        return etl_service.import_records(
            records=records,
            source_name=file.filename or "uploaded-file",
            use_ai_normalization=use_ai_normalization,
            primary_researcher_id=primary_researcher_id,
            verifier_id=verifier_id,
        )
    except UnsupportedFileTypeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uploaded file contains invalid JSON: {exc}",
        ) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
