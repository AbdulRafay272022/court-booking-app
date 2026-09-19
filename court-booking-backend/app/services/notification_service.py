import json
import uuid
from datetime import datetime, timezone

import httpx
import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.fcm_token import FCMToken
from app.models.message import Message
from app.models.notification import NotificationLog
from app.models.user import User
from app.models.venue import PlanTier, Venue
from app.services.sms_service import SMSService
from app.services.whatsapp_service import WhatsAppService
from app.services.whatsapp_templates import TEMPLATES

logger = structlog.get_logger(__name__)

MARKETING_CAP_BY_TIER = {
    PlanTier.FREE: "MARKETING_CAP_FREE",
    PlanTier.PRO: "MARKETING_CAP_PRO",
    PlanTier.BUSINESS: "MARKETING_CAP_BUSINESS",
}


class MarketingSendLimitExceeded(Exception):
    pass


class NotificationService:
    """Routes notifications by tier (see Section 8):

    Tier 1 (push only, free): slot_reopened, booking_reminder.
    Tier 2 (push + WhatsApp): payment_approved/rejected, booking_confirmed/cancelled.
    payment_submitted gets its own escalation ladder to the *owner*: push now,
    WhatsApp after ESCALATION_WHATSAPP_MINUTES, SMS after
    ESCALATION_SMS_MINUTES, then the booking auto-releases at
    PAYMENT_REVIEW_HOURS (handled by booking_service.expire_stale_bookings).
    Tier 3 (paid marketing, tier-gated): tournament/promo announcements.

    Every WhatsApp send goes through the 24h free-window check (Section 9.3):
    inside the window it's a plain text message; outside it, a registered
    template from whatsapp_templates.py. Every send (any channel) is logged
    to notification_log for delivery/cost reporting, and for the escalation
    ladder, so the next check knows what's already gone out.
    """

    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.whatsapp = WhatsAppService(settings)
        self.sms = SMSService(settings)

    async def _log(
        self,
        *,
        user_id: uuid.UUID,
        channel: str,
        event_type: str,
        reference_id: uuid.UUID | None = None,
        cost_category: str = "utility",
        status_value: str = "sent",
        error_message: str | None = None,
        template_name: str | None = None,
    ) -> None:
        self.db.add(
            NotificationLog(
                user_id=user_id,
                channel=channel,
                event_type=event_type,
                reference_id=reference_id,
                cost_category=cost_category,
                status=status_value,
                error_message=error_message,
                template_name=template_name,
            )
        )
        await self.db.commit()

    async def has_sent(self, user_id: uuid.UUID, event_type: str, reference_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            select(NotificationLog.id).where(
                NotificationLog.user_id == user_id,
                NotificationLog.event_type == event_type,
                NotificationLog.reference_id == reference_id,
            )
        )
        return result.scalar_one_or_none() is not None

    async def last_inbound_whatsapp_at(self, phone: str) -> datetime | None:
        """Drives the 24h free-window check: the customer-service window
        resets on every message the customer sends us."""
        result = await self.db.execute(
            select(Message.created_at)
            .join(User, User.id == Message.sender_id)
            .where(Message.channel == "whatsapp", Message.sender_type == "player", User.phone == phone)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _active_tokens(self, user_id: uuid.UUID) -> list[str]:
        result = await self.db.execute(
            select(FCMToken.token).where(FCMToken.user_id == user_id, FCMToken.is_active.is_(True))
        )
        return [row[0] for row in result.all()]

    async def _push(self, token: str, title: str, body: str) -> None:
        if not self.settings.FCM_SERVICE_ACCOUNT_KEY:
            logger.info("push.skipped", reason="no_credentials")
            return
        try:
            # A production build mints a short-lived OAuth2 access token from the
            # service-account JSON via google-auth and posts to the FCM v1 endpoint.
            # Kept as a best-effort no-op here when that plumbing isn't configured.
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    "https://fcm.googleapis.com/v1/projects/placeholder/messages:send",
                    headers={"Content-Type": "application/json"},
                    content=json.dumps(
                        {"message": {"token": token, "notification": {"title": title, "body": body}}}
                    ),
                )
        except httpx.HTTPError:
            logger.warning("push.failed", exc_info=True)

    async def _send_push_tier(
        self, user: User, event_type: str, title: str, body: str, *, reference_id: uuid.UUID | None = None
    ) -> None:
        """Tier 1: push only."""
        for token in await self._active_tokens(user.id):
            await self._push(token, title, body)
            await self._log(
                user_id=user.id, channel="push", event_type=event_type, reference_id=reference_id
            )

    async def _send_push_and_whatsapp(
        self,
        user: User,
        event_type: str,
        title: str,
        body: str,
        *,
        reference_id: uuid.UUID | None = None,
        template_params: list[str] | None = None,
    ) -> None:
        """Tier 2: push + WhatsApp. `event_type` doubles as the template name
        to fall back to outside the 24h window (see whatsapp_templates.py);
        if there's no dedicated template for it, the generic one-param
        fallback is used automatically."""
        last_inbound = await self.last_inbound_whatsapp_at(user.phone)
        _result, template_used = await self.whatsapp.send_smart(
            user.phone,
            body,
            last_inbound_at=last_inbound,
            template_name=event_type,
            template_params=template_params or [body],
        )
        # cost_category describes what *kind* of message this is (per Meta's
        # own template categorization), independent of whether this
        # particular send happened to be free (within-window session text)
        # or a paid template -- that's what lets "cost by category" reporting
        # stay meaningful even as the window opens and closes over time.
        template = TEMPLATES.get(event_type)
        cost_category = template.category if template else "utility"
        await self._log(
            user_id=user.id,
            channel="whatsapp",
            event_type=event_type,
            reference_id=reference_id,
            cost_category=cost_category,
            template_name=template_used,
        )
        await self._send_push_tier(user, event_type, title, body, reference_id=reference_id)

    # -- Tier 1 --------------------------------------------------------

    async def notify_waitlist_slot_available(self, *, user: User, court_name: str, starts_at: str) -> None:
        # Deliberately makes the race explicit rather than implying an
        # exclusive hold or a protected place in line -- every matching
        # waitlist entry is notified at once (see
        # WaitlistService.notify_matching_entries), so whoever actually
        # completes a hold first gets the slot. See AUDIT_FINDINGS.md
        # finding #15.
        await self._send_push_tier(
            user,
            "slot_reopened",
            "Slot available",
            f"A slot just opened up at {court_name} on {starts_at} -- book fast, other "
            "waitlisted players were notified too.",
        )

    async def notify_booking_reminder(self, *, user: User, court_name: str, starts_at: str, booking_id: uuid.UUID) -> None:
        if await self.has_sent(user.id, "booking_reminder", booking_id):
            return
        await self._send_push_tier(
            user,
            "booking_reminder",
            "Upcoming booking",
            f"Reminder: your booking at {court_name} is at {starts_at}.",
            reference_id=booking_id,
        )

    # -- Tier 2 ----------------------------------------------------------

    async def notify_booking_confirmed(
        self, *, user: User, court_name: str, starts_at: str, amount_paid: float | None = None
    ) -> None:
        await self._send_push_and_whatsapp(
            user,
            "booking_confirmed",
            "Booking confirmed",
            f"Your booking for {court_name} on {starts_at} is confirmed. See you on court!",
            template_params=[court_name, "", starts_at, "", f"{amount_paid:,.0f}" if amount_paid else ""],
        )

    async def notify_booking_cancelled(self, *, user: User, court_name: str, starts_at: str) -> None:
        await self._send_push_and_whatsapp(
            user,
            "booking_cancelled",
            "Booking cancelled",
            f"Your booking for {court_name} on {starts_at} was cancelled.",
            template_params=[court_name, starts_at],
        )

    async def notify_court_deactivated(self, *, user: User, court_name: str, starts_at: str) -> None:
        """A court with a live future booking on it was deactivated -- the
        booking itself is deliberately NOT auto-cancelled (see
        AUDIT_FINDINGS.md finding #27: a court going inactive might be
        temporary, and auto-cancelling a paid booking has the same
        refund-tracking gap as finding #5/#13), so the player at least
        knows to expect the venue to follow up rather than the booking
        silently sitting there with no signal anything changed."""
        await self._send_push_and_whatsapp(
            user,
            "court_deactivated",
            "Court unavailable",
            f"Heads up: {court_name} was marked unavailable by the venue. Your booking on "
            f"{starts_at} is still on file -- the venue will follow up with you directly.",
            template_params=[court_name, starts_at],
        )

    async def notify_payment_rejected(self, *, user: User, court_name: str, reason: str) -> None:
        await self._send_push_and_whatsapp(
            user,
            "payment_rejected",
            "Payment rejected",
            f"Payment rejected: {reason}. Your slot has been released.",
            template_params=[court_name, reason],
        )

    async def notify_owner_new_booking(self, *, owner: User, court_name: str, starts_at: str) -> None:
        await self._send_push_and_whatsapp(
            owner, "owner_new_booking", "New booking", f"New booking on {court_name} for {starts_at}."
        )

    async def notify_venue_pending_review(self, *, user: User, venue_name: str) -> None:
        await self._send_push_and_whatsapp(
            user,
            "venue_pending_review",
            "New venue pending review",
            f'"{venue_name}" was just submitted and needs approval.',
        )

    async def notify_venue_approved(self, *, owner: User, venue_name: str) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "venue_approved",
            "Venue approved",
            f'Your venue "{venue_name}" has been approved! \U0001f389',
            template_params=[venue_name],
        )

    async def notify_venue_changes_requested(self, *, owner: User, venue_name: str, reason: str) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "venue_changes_requested",
            "Changes requested",
            f'Changes were requested for "{venue_name}": {reason}',
            template_params=[venue_name, reason],
        )

    async def notify_venue_rejected(self, *, owner: User, venue_name: str, reason: str) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "venue_rejected",
            "Venue rejected",
            f'Your venue "{venue_name}" was rejected: {reason}',
            template_params=[venue_name, reason],
        )

    # -- payment_submitted escalation ladder (push -> WhatsApp -> SMS) ---

    async def notify_payment_submitted(
        self, *, owner: User, court_name: str, amount: float, booking_id: uuid.UUID, ocr_verdict: str | None = None
    ) -> None:
        """Step 0 of the escalation ladder: push immediately. Steps 1/2
        (WhatsApp/SMS) are advanced later by escalate_payment_submitted, which
        a periodic job calls -- this app has no task scheduler to fire timed
        callbacks, so elapsed time is computed from booking.payment_deadline
        instead of a stored "sent at" timestamp."""
        verdict_note = {
            "match": "✅ Amount matches",
            "mismatch": f"⚠️ Mismatch: screenshot doesn't match expected PKR {amount:,.0f}",
            "unreadable": "❓ Could not read amount from screenshot",
        }.get(ocr_verdict, "")
        body = f"Payment received for {court_name} (PKR {amount:,.0f}). {verdict_note} Tap to approve.".strip()
        await self._send_push_tier(
            owner, "payment_submitted", "Payment awaiting verification", body, reference_id=booking_id
        )

    async def escalate_payment_submitted(
        self,
        *,
        owner: User,
        court_name: str,
        amount: float,
        booking_id: uuid.UUID,
        minutes_elapsed: float,
        player_name: str = "",
    ) -> list[str]:
        """Called by the expiry job for every still-PAYMENT_SUBMITTED booking.
        Sends every escalation step that's due and not yet sent (both, if the
        job hasn't run in a while and elapsed time has jumped past both
        thresholds at once) and returns which steps fired."""
        body = f"Still awaiting your review: payment for {court_name} (PKR {amount:,.0f})."
        fired: list[str] = []

        if minutes_elapsed >= self.settings.ESCALATION_WHATSAPP_MINUTES and not await self.has_sent(
            owner.id, "payment_submitted_whatsapp", booking_id
        ):
            last_inbound = await self.last_inbound_whatsapp_at(owner.phone)
            _result, template_used = await self.whatsapp.send_smart(
                owner.phone,
                body,
                last_inbound_at=last_inbound,
                template_name="payment_submitted_owner",
                template_params=[court_name, "", "", player_name, f"PKR {amount:,.0f}"],
            )
            await self._log(
                user_id=owner.id,
                channel="whatsapp",
                event_type="payment_submitted_whatsapp",
                reference_id=booking_id,
                template_name=template_used,
            )
            fired.append("whatsapp")

        if minutes_elapsed >= self.settings.ESCALATION_SMS_MINUTES and not await self.has_sent(
            owner.id, "payment_submitted_sms", booking_id
        ):
            await self.sms.send_text(owner.phone, body)
            await self._log(
                user_id=owner.id,
                channel="sms",
                event_type="payment_submitted_sms",
                reference_id=booking_id,
                cost_category="sms",
            )
            fired.append("sms")

        return fired

    # -- Tier 3: paid marketing, tier-gated -------------------------------

    async def _marketing_sends_this_month(self, venue_id: uuid.UUID) -> int:
        month_start = datetime.now(timezone.utc).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        count = await self.db.scalar(
            select(func.count(NotificationLog.id)).where(
                NotificationLog.cost_category == "marketing",
                NotificationLog.reference_id == venue_id,
                NotificationLog.created_at >= month_start,
            )
        )
        return count or 0

    def _marketing_cap(self, venue: Venue) -> int:
        return getattr(self.settings, MARKETING_CAP_BY_TIER[venue.plan_tier])

    async def can_send_marketing(self, venue: Venue) -> bool:
        cap = self._marketing_cap(venue)
        if cap <= 0:
            return False
        return await self._marketing_sends_this_month(venue.id) < cap

    async def send_marketing_announcement(self, *, venue: Venue, user: User, title: str, body: str) -> None:
        if not await self.can_send_marketing(venue):
            raise MarketingSendLimitExceeded(f"Venue {venue.id} has hit its {venue.plan_tier.value} monthly cap")

        await self._send_push_tier(user, "tournament_announcement", title, body, reference_id=venue.id)
        await self.whatsapp.send_text(user.phone, body)
        await self._log(
            user_id=user.id,
            channel="whatsapp",
            event_type="tournament_announcement",
            reference_id=venue.id,
            cost_category="marketing",
        )
