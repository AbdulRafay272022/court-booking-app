"""audit 2026-10-28 items 17 + 18: who hears about a no-show or a short payment ("kam mila").

- item 17: the venue OWNER, at once, when a STAFF member did it (the owner doing it themselves needs no message);
- item 18: the PLAYER (if the booking has an account): booking ID, total, paid, due, and the venue's WhatsApp.

Channels: push + web push + bell now; WhatsApp only while the `whatsapp_templates` flag is on (NotificationService._audit_tier).
Strictly best effort: a notification problem never fails the no-show / completion that already committed.
"""

from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.booking import Booking
from app.models.court import Court
from app.models.user import User, UserRole
from app.models.venue import Venue

logger = structlog.get_logger()


async def notify_unsettled(
    db: AsyncSession, settings: Settings, booking: Booking, actor: User, kind: str, short_pkr: int = 0
) -> None:
    """`kind` is "no_show" or "short"."""
    try:
        from app.services.notification_service import NotificationService
        from app.services.owner_overview_service import short_code

        court = await db.get(Court, booking.court_id)
        venue = await db.get(Venue, court.venue_id) if court is not None else None
        if court is None or venue is None:
            return
        notifications = NotificationService(db, settings)
        total = int(round(float(booking.price)))
        paid = int(round(float(booking.amount_paid or 0)))
        due = max(total - paid, 0)
        player = await db.get(User, booking.player_id) if booking.player_id else None
        if actor.role == UserRole.STAFF:
            owner = await db.get(User, venue.owner_id)
            if owner is not None:
                await notifications.notify_owner_staff_action(
                    owner=owner,
                    staff_name=actor.name or actor.phone,
                    kind=kind,
                    booking_id=booking.id,
                    starts_at=booking.starts_at,
                    court_name=court.name,
                    player_name=booking.player_name or (player.name if player else None),
                    short_pkr=short_pkr,
                    due_pkr=due,
                )
        if player is not None and (kind == "no_show" or due > 0):
            await notifications.notify_player_unsettled(
                player=player,
                kind=kind,
                booking_id=booking.id,
                code=short_code(booking.id),
                starts_at=booking.starts_at,
                court_name=court.name,
                total_pkr=total,
                paid_pkr=paid,
                due_pkr=due,
                venue_whatsapp=venue.whatsapp or venue.phone,
            )
    except Exception as exc:  # noqa: BLE001 -- best effort by design (see module docstring)
        logger.warning("unsettled_notice.failed", kind=kind, error=type(exc).__name__)
