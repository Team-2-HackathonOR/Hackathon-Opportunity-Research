from __future__ import annotations

from typing import Any

from pymongo import MongoClient

from app.config import Settings


def fetch_mongo_records(
    settings: Settings,
    limit: int | None,
    database_name: str | None = None,
    collection_name: str | None = None,
    fetched_at: str | None = None,
    cursor_mode: bool = False,
    after_id: int | None = None,
) -> list[dict[str, Any]]:
    client = MongoClient(settings.mongodb_connection_string)
    try:
        database = client[database_name or settings.mongodb_database_name]
        collection = database[collection_name or settings.mongodb_collection_name]
        query = {"fetchedAt": fetched_at} if fetched_at else {}
        if cursor_mode and after_id is not None:
            query["id"] = {"$gt": after_id}
        documents = collection.find(query, {"_id": 0})
        if cursor_mode:
            documents = documents.sort("id", 1)
        if limit is not None:
            documents = documents.limit(limit)
        return [dict(document) for document in documents]
    finally:
        client.close()
