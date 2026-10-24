from __future__ import annotations

from pathlib import Path

import psycopg
from psycopg import sql
from sqlalchemy.engine import URL, make_url

from app.config import get_settings


SCHEMA_NAME = "hackathon_research"
SENTINEL_TABLE = "team_members"
SCHEMA_FILE = Path(__file__).with_name("hackathon_research_schema.sql")


def to_postgres_admin_url(database_url: str) -> str:
    url = make_url(database_url).set(drivername="postgresql", database="postgres")
    return url.render_as_string(hide_password=False)


def to_target_url(database_url: str) -> URL:
    return make_url(database_url).set(drivername="postgresql")


def database_exists(admin_dsn: str, database_name: str) -> bool:
    with psycopg.connect(admin_dsn, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database_name,))
            return cursor.fetchone() is not None


def create_database(admin_dsn: str, database_name: str) -> None:
    with psycopg.connect(admin_dsn, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
            )


def schema_is_initialized(target_dsn: str) -> bool:
    with psycopg.connect(target_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = %s
                      AND table_name = %s
                )
                """,
                (SCHEMA_NAME, SENTINEL_TABLE),
            )
            row = cursor.fetchone()
            return bool(row and row[0])


def apply_schema(target_dsn: str, schema_sql: str) -> None:
    with psycopg.connect(target_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(schema_sql)
        connection.commit()


def main() -> None:
    settings = get_settings()
    target_url = to_target_url(settings.database_url)
    admin_dsn = to_postgres_admin_url(settings.database_url)
    target_dsn = target_url.render_as_string(hide_password=False)
    database_name = target_url.database

    if not database_name:
        raise RuntimeError("DATABASE_URL must include a database name.")

    if not SCHEMA_FILE.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_FILE}")

    if database_exists(admin_dsn, database_name):
        print(f"Database '{database_name}' already exists.")
    else:
        create_database(admin_dsn, database_name)
        print(f"Created database '{database_name}'.")

    if schema_is_initialized(target_dsn):
        print(
            f"Schema '{SCHEMA_NAME}' is already initialized in database '{database_name}'. "
            "Skipping schema apply."
        )
        return

    apply_schema(target_dsn, SCHEMA_FILE.read_text(encoding="utf-8"))
    print(f"Applied schema from '{SCHEMA_FILE.name}' to database '{database_name}'.")


if __name__ == "__main__":
    main()
