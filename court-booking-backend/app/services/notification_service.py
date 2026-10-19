import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.fcm_token import FCMToken
from app.models.message import Message
from app.models.notification import NotificationLog
from app.models.user import User
from app.models.venue import Venue
from app.models.web_push_subscription import WebPushSubscription
from app.services.apns import send_apns
from app.services.fcm import PushOutcome, send_push
from app.services.web_push import HIGH_URGENCY_EVENTS as WEB_PUSH_HIGH_URGENCY
from app.services.web_push import WebPushOutcome, keys_configured, send_web_push
from app.services.web_push import build_payload as build_web_push_payload
from app.services.web_push import topic_for as web_push_topic
from app.services.feature_flag_service import flag_on
from app.services.sms_service import SMSService
from app.services.whatsapp_service import WhatsAppService, describe_send_failure
from app.utils.timezone import format_date_relative, format_pkr, format_time_range, format_when, format_when_range
from app.services.whatsapp_templates import TEMPLATES

logger = structlog.get_logger(__name__)

def _when(starts_at: "datetime | str", ends_at: "datetime | None" = None) -> str:
    """The display text for a booking time inside a notification: "Wed, 23 Sep, 7:30 PM to 9:00 PM".

    Callers pass the booking's real datetimes and this is the only place they become text. They used to be
    interpolated straight into the message with `.isoformat()`, so players were sent things like
    "Your booking for Court 1 on 2026-09-23T14:30:00+00:00 is confirmed" -- a UTC ISO string. A plain str is
    treated as already-formatted display text (kept so older callers/tests don't break)."""
    if isinstance(starts_at, datetime):
        return format_when_range(starts_at, ends_at) if ends_at else format_when(starts_at)
    return starts_at


class MarketingSendLimitExceeded(Exception):
    pass


class NotificationService:
    """Routes notifications by tier (see Section 8):

    Tier 1 (push only, free): slot_reopened, booking_reminder.
    Tier 2 (push + WhatsApp): payment_approved/rejected, booking_confirmed/cancelled.
    payment_submitted: push to the *owner* now, then (Round 2 Stage 2) reminders +
    a final warning timed by the venue's timers (app/services/venue_timers.py),
    and auto-cancel at the venue's auto_cancel_after_min (default 120 = the old
    PAYMENT_REVIEW_HOURS; booking_service.expire_stale_bookings).
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
        payload: dict | None = None,
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
                payload=payload,
            )
        )
        await self.db.commit()

    async def has_sent(self, user_id: uuid.UUID, event_type: str, reference_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            select(NotificationLog.id).where(
                NotificationLog.user_id == user_id,
                NotificationLog.event_type == event_type,
                NotificationLog.reference_id == reference_id,
            ).limit(1)  # one event can have several rows (WhatsApp + push + web push)
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

    async def _push(
        self, token: str, title: str, body: str, data: dict[str, str] | None = None
    ) -> PushOutcome:
        # iOS tokens are raw APNs tokens (FCM rejects them), so they go straight to Apple.
        platform = await self.db.scalar(select(FCMToken.platform).where(FCMToken.token == token))
        if platform == "ios":
            return await send_apns(self.settings, token, title, body, data)
        return await send_push(self.settings.FCM_SERVICE_ACCOUNT_KEY, token, title, body, data)

    async def _deactivate_token(self, token: str) -> None:
        """FCM told us this device token is dead -- stop sending to it."""
        await self.db.execute(update(FCMToken).where(FCMToken.token == token).values(is_active=False))
        await self.db.commit()

    async def _send_push_tier(
        self,
        user: User,
        event_type: str,
        title: str,
        body: str,
        *,
        reference_id: uuid.UUID | None = None,
        bell: bool = False,
        payload: dict | None = None,
    ) -> None:
        """Tier 1: push only. The `data` payload is what the mobile app's tap handler
        deep-links from (apps/mobile/app/_layout.tsx, `routeForNotification`).

        `bell=True` (Owner Round 2 events): when the user has no device token, still write ONE `in_app` row so the
        event shows in the bell (GET /users/me/notifications/feed) and dedupes via has_sent -- otherwise a push-only
        event to a web-only user left no trace at all."""
        # Admin global kill switch (Section 32 Part 12): suppress the notification
        # side effect entirely; the booking/payment logic that triggered it is
        # unaffected. OTP delivery does NOT come through here, so it's unaffected.
        if not await flag_on(self.db, "push_notifications"):
            return
        data = {"event_type": event_type}
        if reference_id is not None:
            data["reference_id"] = str(reference_id)
        tokens = await self._active_tokens(user.id)
        web_subs = await self._active_web_push(user.id)
        if bell and not tokens and not web_subs:
            await self._log(
                user_id=user.id, channel="in_app", event_type=event_type, reference_id=reference_id, payload=payload
            )
        for token in tokens:
            outcome = await self._push(token, title, body, data)
            if outcome == PushOutcome.UNREGISTERED:
                await self._deactivate_token(token)
            # The log used to say "sent" for every attempt, whatever FCM/APNs answered, so a push that
            # never left the server (no credentials, provider error, dead token) looked delivered.
            # A test fake that returns nothing counts as sent (the real _push always returns an outcome).
            ok = outcome is None or outcome == PushOutcome.SENT
            await self._log(
                user_id=user.id,
                channel="push",
                event_type=event_type,
                reference_id=reference_id,
                status_value="sent" if ok else "failed",
                error_message=None if ok else f"push {outcome.value}",
                payload=payload,
            )
        # Round 2 Stage 2: browser Web Push, after the device tokens (docs/web-push-plan.md section 5).
        for sub in web_subs:
            await self._send_web_push(user, sub, event_type, title, body, reference_id=reference_id, payload=payload)

    async def _active_web_push(self, user_id: uuid.UUID) -> list[WebPushSubscription]:
        if not keys_configured(self.settings):
            return []
        result = await self.db.execute(
            select(WebPushSubscription).where(
                WebPushSubscription.user_id == user_id, WebPushSubscription.revoked_at.is_(None)
            )
        )
        return list(result.scalars().all())

    async def _send_web_push(
        self,
        user: User,
        sub: WebPushSubscription,
        event_type: str,
        title: str,
        body: str,
        *,
        reference_id: uuid.UUID | None,
        payload: dict | None,
    ) -> None:
        """One subscription: send, then log a `web_push` row that says what really happened. 404/410 revokes."""
        ref = str(reference_id) if reference_id else None
        family = "payment_reminder" if event_type.startswith("payment_reminder") else event_type
        result = await send_web_push(
            self.settings,
            endpoint=sub.endpoint,
            p256dh=sub.p256dh,
            auth=sub.auth,
            payload=build_web_push_payload(event_type, title, body, ref),
            urgency="high" if family in WEB_PUSH_HIGH_URGENCY else "normal",
            topic=web_push_topic(family, ref),
        )
        if result.outcome == WebPushOutcome.SKIPPED:
            return
        now = datetime.now(timezone.utc)
        if result.outcome == WebPushOutcome.UNREGISTERED:
            sub.revoked_at = now
        elif result.outcome == WebPushOutcome.SENT:
            sub.last_seen_at = now
        ok = result.outcome == WebPushOutcome.SENT
        await self._log(
            user_id=user.id,
            channel="web_push",
            event_type=event_type,
            reference_id=reference_id,
            status_value="sent" if ok else "failed",
            error_message=None if ok else (result.error or "web_push failed"),
            payload=payload,
        )

    async def _whatsapp_smart_best_effort(
        self, user: User, body: str, *, template_name: str, template_params: list[str]
    ) -> tuple[str | None, str | None]:
        """WhatsApp leg of a notification, which must NEVER fail the action that triggered it.

        Returns (template_used, error_message); error_message is None on success. Every caller
        runs AFTER its own state change has been committed (venue approved, payment approved,
        booking cancelled...), so raising here cannot undo that -- it can only turn a successful
        action into a 500. Production incident 2026-09-20: approving a venue saved, then Meta
        rejected the not-yet-registered `venue_approved` template (132001), the error escaped,
        and the admin saw a "server connection error" (a bare 500 has no CORS headers) for an
        approval that had actually worked. Failures are logged and recorded as a `failed`
        notification_log row instead. (OTP delivery is deliberately NOT routed through here: there
        a delivery failure is the answer, see AuthService.request_otp.)"""
        # Admin global kill switch (Section 32 Part 12): suppress the WhatsApp
        # notification side effect. OTP is not routed through here, so it stays on.
        if not await flag_on(self.db, "push_notifications"):
            return None, None
        last_inbound = await self.last_inbound_whatsapp_at(user.phone)
        try:
            _result, template_used = await self.whatsapp.send_smart(
                user.phone,
                body,
                last_inbound_at=last_inbound,
                template_name=template_name,
                template_params=template_params,
            )
            return template_used, None
        except Exception as exc:  # noqa: BLE001 -- see docstring: any failure must be contained
            outcome, code = describe_send_failure(exc)
            logger.warning(
                "notification.whatsapp_failed", event_type=template_name, outcome=outcome, meta_error_code=code
            )
            return None, f"{outcome}; meta_error_code={code}; {type(exc).__name__}: {str(exc)[:200]}"

    async def _send_push_and_whatsapp(
        self,
        user: User,
        event_type: str,
        title: str,
        body: str,
        *,
        reference_id: uuid.UUID | None = None,
        template_params: list[str] | None = None,
        template_name: str | None = None,
        bell: bool = False,
        payload: dict | None = None,
    ) -> None:
        """Tier 2: push + WhatsApp. `event_type` doubles as the template name
        to fall back to outside the 24h window (see whatsapp_templates.py);
        if there's no dedicated template for it, the generic one-param
        fallback is used automatically."""
        template_used, whatsapp_error = await self._whatsapp_smart_best_effort(
            user, body, template_name=template_name or event_type, template_params=template_params or [body]
        )
        # cost_category describes what *kind* of message this is (per Meta's
        # own template categorization), independent of whether this
        # particular send happened to be free (within-window session text)
        # or a paid template -- that's what lets "cost by category" reporting
        # stay meaningful even as the window opens and closes over time.
        template = TEMPLATES.get(template_name or event_type)
        cost_category = template.category if template else "utility"
        await self._log(
            user_id=user.id,
            channel="whatsapp",
            event_type=event_type,
            reference_id=reference_id,
            cost_category=cost_category,
            template_name=template_used,
            status_value="failed" if whatsapp_error else "sent",
            error_message=whatsapp_error,
            payload=payload,
        )
        # The WhatsApp row above already puts the event in the bell, so `bell` only matters when the WhatsApp leg was
        # suppressed entirely (push_notifications flag off -> nothing is sent at all, by design).
        await self._send_push_tier(user, event_type, title, body, reference_id=reference_id, bell=bell, payload=payload)

    # -- Tier 1 --------------------------------------------------------

    async def notify_waitlist_slot_available(
        self,
        *,
        user: User,
        court_name: str,
        starts_at: "datetime | str",
        ends_at: "datetime | None" = None,
        reference_id: uuid.UUID | None = None,
    ) -> None:
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
            f"A slot just opened up at {court_name} on {_when(starts_at, ends_at)} -- book fast, other "
            "waitlisted players were notified too.",
            reference_id=reference_id,
        )

    async def notify_booking_reminder(
        self, *, user: User, court_name: str, starts_at: "datetime | str", booking_id: uuid.UUID, ends_at: "datetime | None" = None
    ) -> None:
        if await self.has_sent(user.id, "booking_reminder", booking_id):
            return
        await self._send_push_tier(
            user,
            "booking_reminder",
            "Upcoming booking",
            f"Reminder: your booking at {court_name} is {_when(starts_at, ends_at)}.",
            reference_id=booking_id,
        )

    # -- Tier 2 ----------------------------------------------------------

    async def notify_booking_confirmed(
        self,
        *,
        user: User,
        court_name: str,
        starts_at: "datetime | str",
        amount_paid: float | None = None,
        ends_at: "datetime | None" = None,
        venue_name: str = "",
        reference_id: uuid.UUID | None = None,
    ) -> None:
        # The WhatsApp template lays out venue / date / time as separate lines. They used to be sent
        # as ["court", "", <iso>, "", paid], i.e. a blank venue, a UTC ISO string as the date and a
        # blank time -- the player got an empty "⏰" line.
        if isinstance(starts_at, datetime):
            date_text = format_date_relative(starts_at)
            time_text = format_time_range(starts_at, ends_at) if ends_at else format_when(starts_at).split(", ", 1)[-1]
        else:
            date_text, time_text = starts_at, ""
        await self._send_push_and_whatsapp(
            user,
            "booking_confirmed",
            "Booking confirmed",
            f"Your booking for {court_name} on {_when(starts_at, ends_at)} is confirmed. See you on court!",
            template_params=[court_name, venue_name, date_text, time_text, f"{amount_paid:,.0f}" if amount_paid else ""],
            reference_id=reference_id,
        )

    async def notify_booking_cancelled(
        self,
        *,
        user: User,
        court_name: str,
        starts_at: "datetime | str",
        ends_at: "datetime | None" = None,
        reference_id: uuid.UUID | None = None,
    ) -> None:
        await self._send_push_and_whatsapp(
            user,
            "booking_cancelled",
            "Booking cancelled",
            f"Your booking for {court_name} on {_when(starts_at, ends_at)} was cancelled.",
            template_params=[court_name, _when(starts_at, ends_at)],
            reference_id=reference_id,
        )

    async def notify_court_deactivated(
        self,
        *,
        user: User,
        court_name: str,
        starts_at: "datetime | str",
        ends_at: "datetime | None" = None,
        reference_id: uuid.UUID | None = None,
    ) -> None:
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
            f"{_when(starts_at, ends_at)} is still on file -- the venue will follow up with you directly.",
            template_params=[court_name, _when(starts_at, ends_at)],
            reference_id=reference_id,
        )

    async def notify_payment_rejected(
        self, *, user: User, court_name: str, reason: str, reference_id: uuid.UUID | None = None
    ) -> None:
        await self._send_push_and_whatsapp(
            user,
            "payment_rejected",
            "Payment rejected",
            f"Payment rejected: {reason}. Your slot has been released.",
            template_params=[court_name, reason],
            reference_id=reference_id,
        )

    async def notify_refund_paid(
        self, *, user: User, court_name: str, amount: float, reference: str, reference_id: uuid.UUID | None = None
    ) -> None:
        """Section 32 Part 10: the venue owner marked a manual (outside-the-app)
        refund as sent. This is a record of what the owner reported, not proof
        the transfer actually landed -- same trust model as the rest of this
        pilot's manual-payment flow."""
        await self._send_push_and_whatsapp(
            user,
            "refund_paid",
            "Refund sent",
            f"The venue for {court_name} recorded a refund of {format_pkr(amount)} (ref: {reference}).",
            template_params=[court_name, format_pkr(amount), reference],
            reference_id=reference_id,
        )

    async def notify_owner_new_booking(
        self,
        *,
        owner: User,
        court_name: str,
        starts_at: "datetime | str",
        ends_at: "datetime | None" = None,
        reference_id: uuid.UUID | None = None,
    ) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "owner_new_booking",
            "New booking",
            f"New booking on {court_name} for {_when(starts_at, ends_at)}.",
            reference_id=reference_id,
        )

    async def notify_owner_player_cancelled(
        self, *, owner: User, court_name: str, booking_id: uuid.UUID, starts_at: datetime, ends_at: datetime | None = None
    ) -> None:
        """Owner Round 2 (A5): the player cancelled while their payment screenshot was waiting for approval. Push only
        (a bell row); the approvals card turns grey on its own."""
        await self._send_push_tier(
            owner,
            "owner_player_cancelled",
            "Player cancelled",
            f"The player cancelled {court_name} on {_when(starts_at, ends_at)} while the payment was waiting for approval.",
            reference_id=booking_id,
            bell=True,
        )

    async def notify_owner_late_payment_proof(
        self, *, owner: User, court_name: str, booking_id: uuid.UUID, starts_at: datetime, ends_at: datetime | None = None
    ) -> None:
        """Owner Round 2 (B1): a payment screenshot arrived after the hold had expired. Push only (a bell row); the
        screenshot is in the approvals queue as an expired card."""
        await self._send_push_tier(
            owner,
            "late_payment_proof",
            "Late payment screenshot",
            f"A payment screenshot for {court_name} on {_when(starts_at, ends_at)} arrived after the hold expired. "
            "Please check it in Approvals.",
            reference_id=booking_id,
            bell=True,
        )

    async def notify_hold_expiring(
        self, *, user: User, court_name: str, booking_id: uuid.UUID, minutes_left: int, amount: float
    ) -> bool:
        """Owner Round 2 (B1): one reminder to the player before their unpaid hold runs out (sent by the expiry job at
        2/3 of the hold time). Push only, deduped per booking via notification_log. Returns True when sent now."""
        if await self.has_sent(user.id, "hold_expiring", booking_id):
            return False
        await self._send_push_tier(
            user,
            "hold_expiring",
            "Your slot is about to be released",
            f"Send your payment of {format_pkr(amount)} for {court_name} within {minutes_left} minutes, "
            "or the slot will be released.",
            reference_id=booking_id,
            bell=True,
        )
        return True

    async def notify_owner_refund_owed(
        self,
        *,
        owner: User,
        booking_id: uuid.UUID,
        court_name: str,
        starts_at: "datetime | str",
        ends_at: "datetime | None" = None,
        amount: float,
        player_name: str | None = None,
    ) -> None:
        """Owner Overview (spec 5.3): a PLAYER cancelled a booking they had paid for, so a refund is now owed.
        Push + best-effort WhatsApp (the generic template covers it outside the 24h window); the push data payload
        carries reference_id = the booking id so a tap can open that booking."""
        who = f"{player_name} " if player_name else "A player "
        await self._send_push_and_whatsapp(
            owner,
            "refund_owed",
            "Refund owed",
            f"{who}cancelled {court_name} on {_when(starts_at, ends_at)}. Refund owed: {format_pkr(amount)}.",
            reference_id=booking_id,
        )

    async def notify_owner_daily_digest(self, *, owner: User, body: str, payload: dict | None = None) -> None:
        """WhatsApp only -- the digest never had a push tier, so this doesn't add one.
        Goes through send_smart like every other notification in this file (Section 29
        Part B): digest_job.py used to call whatsapp.send_text directly, skipping the
        24h-window check. Since the digest is outbound-initiated (not a reply to
        anything), most owners won't have an open window on a given morning, so an
        unguarded send_text degrades to an uncaught RetryError -- and with no
        registered "owner_daily_digest" template, send_smart falls back to the
        generic one-param template outside the window, same as any other
        unregistered event_type."""
        last_inbound = await self.last_inbound_whatsapp_at(owner.phone)
        _result, template_used = await self.whatsapp.send_smart(
            owner.phone,
            body,
            last_inbound_at=last_inbound,
            template_name="owner_daily_digest",
            template_params=[body],
        )
        await self._log(
            user_id=owner.id,
            channel="whatsapp",
            event_type="owner_daily_digest",
            cost_category="utility",
            template_name=template_used,
            payload=payload,
        )

    async def notify_venue_pending_review(self, *, user: User, venue_name: str, venue_id: uuid.UUID | None = None) -> None:
        await self._send_push_and_whatsapp(
            user,
            "venue_pending_review",
            "New venue pending review",
            f'"{venue_name}" was just submitted and needs approval.',
            reference_id=venue_id,
        )

    async def notify_venue_approved(self, *, owner: User, venue_name: str, venue_id: uuid.UUID | None = None) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "venue_approved",
            "Venue approved",
            f'Your venue "{venue_name}" has been approved! \U0001f389',
            template_params=[venue_name],
            reference_id=venue_id,
        )

    async def notify_venue_changes_requested(
        self, *, owner: User, venue_name: str, reason: str, venue_id: uuid.UUID | None = None
    ) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "venue_changes_requested",
            "Changes requested",
            f'Changes were requested for "{venue_name}": {reason}',
            template_params=[venue_name, reason],
            reference_id=venue_id,
        )

    async def notify_venue_rejected(
        self, *, owner: User, venue_name: str, reason: str, venue_id: uuid.UUID | None = None
    ) -> None:
        await self._send_push_and_whatsapp(
            owner,
            "venue_rejected",
            "Venue rejected",
            f'Your venue "{venue_name}" was rejected: {reason}',
            template_params=[venue_name, reason],
            reference_id=venue_id,
        )

    # -- payment_submitted: immediate push, then the venue-timed reminders (Round 2 Stage 2) ---

    async def notify_payment_submitted(
        self, *, owner: User, court_name: str, amount: float, booking_id: uuid.UUID, ocr_verdict: str | None = None
    ) -> None:
        """Push immediately when a screenshot arrives (unchanged). The follow-ups are the venue-timed owner reminders
        (`notify_owner_payment_reminder`, driven by the expiry job from the pending payment's created_at)."""
        verdict_note = {
            "match": "✅ Amount matches",
            "mismatch": f"⚠️ Mismatch: screenshot doesn't match expected PKR {amount:,.0f}",
            "unreadable": "❓ Could not read amount from screenshot",
        }.get(ocr_verdict, "")
        body = f"Payment received for {court_name} (PKR {amount:,.0f}). {verdict_note} Tap to approve.".strip()
        await self._send_push_tier(
            owner, "payment_submitted", "Payment awaiting verification", body, reference_id=booking_id,
            # Owner Round 2 (A6): an owner with no device token (web only) must still see this in the bell.
            bell=True,
        )

    async def notify_owner_payment_reminder(
        self,
        *,
        owner: User,
        event_type: str,
        court_name: str,
        venue_name: str,
        amount: float,
        booking_id: uuid.UUID,
        starts_at: datetime,
        ends_at: datetime | None,
        player_name: str,
        minutes_waiting: int,
        minutes_to_cancel: int | None,
        reminder_no: int | None,
    ) -> bool:
        """Round 2 Stage 2: one owner reminder (`payment_reminder_<n>`) or the final warning (`payment_final_warning`)
        for a screenshot still waiting for approval, timed by the venue's timers (app/services/venue_timers.py +
        reminder_schedule). Replaces the old WhatsApp-after-5 / SMS-after-15 ladder. Push + best-effort WhatsApp,
        always a bell row; deduped per booking through notification_log. Returns True when sent now."""
        if await self.has_sent(owner.id, event_type, booking_id):
            return False
        final = event_type == "payment_final_warning"
        if final:
            title = "Booking will be cancelled soon"
            body = (
                f"Payment for {court_name} ({format_pkr(amount)}) is still waiting for approval. The booking will be "
                f"cancelled in {minutes_to_cancel or 0} minutes unless you approve or reject it."
            )
        else:
            title = "Payment still waiting for approval"
            body = (
                f"Still awaiting your review: payment for {court_name} ({format_pkr(amount)}), waiting "
                f"{minutes_waiting} minutes."
            )
        payload = {"amount": amount, "minutes_waiting": minutes_waiting}
        if minutes_to_cancel is not None:
            payload["minutes_to_cancel"] = minutes_to_cancel
        if reminder_no is not None:
            payload["reminder_no"] = reminder_no
        await self._send_push_and_whatsapp(
            owner,
            event_type,
            title,
            body,
            reference_id=booking_id,
            template_name="payment_submitted_owner",
            template_params=[court_name, venue_name, _when(starts_at, ends_at), player_name, format_pkr(amount)],
            bell=True,
            payload=payload,
        )
        return True

    async def notify_owner_payment_auto_cancelled(
        self,
        *,
        owner: User,
        court_name: str,
        booking_id: uuid.UUID,
        starts_at: datetime,
        ends_at: datetime | None,
        amount: float | None,
    ) -> None:
        """Round 2 Stage 2: a booking was auto-cancelled because its payment screenshot was not approved in time
        while a screenshot WAS sent. The slot is free again; if the money really arrived it has to go back
        ("paisa wapas dena hai") -- the expired card in Approvals has "Paisa aa gaya - Refund banayein", which queues
        the refund through the existing payment_disputes path. Push + WhatsApp + bell."""
        if await self.has_sent(owner.id, "owner_payment_auto_cancelled", booking_id):
            return
        amount_text = f" ({format_pkr(amount)})" if amount else ""
        await self._send_push_and_whatsapp(
            owner,
            "owner_payment_auto_cancelled",
            "Booking auto-cancelled",
            f"The booking for {court_name} on {_when(starts_at, ends_at)} was cancelled because its payment"
            f"{amount_text} was not approved in time. If the money arrived it has to be returned: open Approvals and "
            "choose 'money received' to add it to Refunds.",
            reference_id=booking_id,
            bell=True,
            payload={"amount": amount, "refund_may_be_owed": True} if amount else {"refund_may_be_owed": True},
        )

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
        # plan_tier is retired: the Announcements premium feature includes one monthly allowance (what Pro used to get).
        return self.settings.MARKETING_CAP_PRO

    async def can_send_marketing(self, venue: Venue) -> bool:
        cap = self._marketing_cap(venue)
        if cap <= 0:
            return False
        return await self._marketing_sends_this_month(venue.id) < cap

    async def send_marketing_announcement(self, *, venue: Venue, user: User, title: str, body: str) -> None:
        if not await self.can_send_marketing(venue):
            raise MarketingSendLimitExceeded(f"Venue {venue.id} has hit its monthly announcement allowance")

        payload = {"title": title, "venue_name": venue.name}
        await self._send_push_tier(user, "tournament_announcement", title, body, reference_id=venue.id, payload=payload)
        await self.whatsapp.send_text(user.phone, body)
        await self._log(
            user_id=user.id,
            channel="whatsapp",
            event_type="tournament_announcement",
            reference_id=venue.id,
            cost_category="marketing",
            payload=payload,
        )
