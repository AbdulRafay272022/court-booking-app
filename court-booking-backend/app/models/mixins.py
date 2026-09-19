import enum
import uuid
from datetime import datetime
from typing import TypeVar

from sqlalchemy import DateTime, Enum, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

E = TypeVar("E", bound=enum.Enum)


def pg_enum(enum_cls: type[E], name: str) -> Enum:
    """A Postgres ENUM column that stores each member's .value ('held', not
    'HELD') -- matches the raw-SQL schema's lowercase string literals, which
    partial-index predicates and hand-written queries both rely on."""
    return Enum(enum_cls, name=name, values_callable=lambda cls: [e.value for e in cls])


class UUIDPkMixin:
    """PKs are generated in Postgres itself (gen_random_uuid(), built into PG13+)
    rather than client-side, matching the raw-SQL schema this app is built from."""

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class CreatedAtMixin:
    """For tables that only track created_at (no updates expected after insert)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
