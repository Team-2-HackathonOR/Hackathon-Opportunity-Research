from __future__ import annotations

from typing import Any

from pymongo import MongoClient

from app.config import Settings


def fetch_mongo_records(
    settings: Settings,
    limit: int,
    database_name: str | None = None,
    collection_name: str | None = None,
) -> list[dict[str, Any]]:
    client = MongoClient(settings.mongodb_connection_string)
    try:
        database = client[database_name or settings.mongodb_database_name]
        collection = database[collection_name or settings.mongodb_collection_name]
        documents = collection.find({}, {"_id": 0}).limit(limit)
        return [dict(document) for document in documents]
    finally:
        client.close()

