from __future__ import annotations

from sqlalchemy import Enum
from sqlalchemy.orm import DeclarativeBase


SCHEMA_NAME = "hackathon_research"


def schema_enum(enum_type: type, name: str) -> Enum:
    return Enum(
        enum_type,
        name=name,
        schema=SCHEMA_NAME,
        create_type=False,
        values_callable=lambda enum_cls: [member.value for member in enum_cls],
    )


class Base(DeclarativeBase):
    pass
