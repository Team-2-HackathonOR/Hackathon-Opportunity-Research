from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = Field(default="development", alias="APP_ENV")
    database_url: str = Field(alias="DATABASE_URL")
    mongodb_connection_string: str = Field(alias="MONGODB_CONNECTION_STRING")
    mongodb_database_name: str = Field(
        default="hackathon-opportunity-research",
        alias="MONGODB_DATABASE_NAME",
    )
    mongodb_collection_name: str = Field(
        default="hackathons",
        alias="MONGODB_COLLECTION_NAME",
    )
    ai_base_url: str = Field(default="https://api.openai.com/v1", alias="AI_BASE_URL")
    ai_api_key: str = Field(default="", alias="AI_API_KEY")
    ai_model: str = Field(default="gpt-4.1-mini", alias="AI_MODEL")
    ai_timeout_seconds: int = Field(default=60, alias="AI_TIMEOUT_SECONDS", ge=5, le=300)
    ai_web_fetch_timeout_seconds: int = Field(default=20, alias="AI_WEB_FETCH_TIMEOUT_SECONDS", ge=5, le=120)
    ai_web_fetch_max_chars: int = Field(default=12000, alias="AI_WEB_FETCH_MAX_CHARS", ge=2000, le=50000)
    ai_web_fetch_max_urls: int = Field(default=3, alias="AI_WEB_FETCH_MAX_URLS", ge=1, le=6)
    ai_web_fetch_max_discovered_urls: int = Field(default=3, alias="AI_WEB_FETCH_MAX_DISCOVERED_URLS", ge=0, le=10)

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        if value.startswith(("postgresql://", "postgres://")):
            return "postgresql+psycopg://" + value.split("://", 1)[1]
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
