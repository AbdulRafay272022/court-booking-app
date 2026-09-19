import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_usage import AIUsageLog


async def log_ai_usage(
    db: AsyncSession,
    *,
    provider: str,
    model: str,
    purpose: str,  # "chat" | "vision"
    raw_usage: dict[str, int],
    reference_id: uuid.UUID | None = None,
) -> None:
    """Records one AI provider call for cost tracking (Section 21.4). Callers
    still need to `db.commit()` -- this only adds the row, matching every
    other service in this codebase's convention of the call site owning the
    transaction boundary."""
    db.add(
        AIUsageLog(
            provider=provider,
            model=model,
            purpose=purpose,
            input_tokens=raw_usage.get("input_tokens", 0),
            output_tokens=raw_usage.get("output_tokens", 0),
            reference_id=reference_id,
        )
    )
