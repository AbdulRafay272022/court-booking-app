"""Owner Overview / Bookings history / booking detail / "Booking completed" (docs/owner-overview-contract.md).

No schema change. Everything is read from `bookings`, `payment_entries`, `payments`, `payment_disputes` and
`audit_log`; the only write is the completion endpoint, which goes through the payment ledger.

=== OPERATING DAY ===
A booking belongs to the schedule day that OPENS its start (see `overview_slots.operating_day_expr`): a 1:00 AM
Friday start on a Thursday 3 PM to 3 AM court is a THURSDAY booking. Overview, History, Approvals, Refunds and the
slot counts all use that one rule.

=== STATUS MAPPING (code state -> row) ===
A booking yields one MAIN row, plus a REFUND row when its payment_disputes row has refund_amount > 0.

  bookings.status      other condition                              status_key          kind
  -------------------  -------------------------------------------  ------------------  ---------
  held                                                              held                booked
  payment_submitted                                                 awaiting_approval   booked
  booked | completed                                                booked              booked
  no_show                                                           no_show             booked
  cancelled            cancelled_by=system AND reason in            expired             cancelled
                       (hold_expired, payment_review_expired)
  cancelled            anything else                                cancelled           cancelled
  (any)                dispute refund_amount>0, refund_status=owed  refund_owed         refund   (extra row)
  (any)                dispute refund_amount>0, refund_status!=owed refunded            refund   (extra row)

Chips (not status keys): `checked_in` = bookings.checked_in_at is not null (check-in also sets status=completed);
`completion` = latest audit_log row `booking.completion_marked` (yes = Mukammal, no = Adhoora), confirmed rows only.
`refund_status` in the API is "owed" | "paid" (the dispute column stores "owed" | "refunded"; "owed" with a partial
refunded_amount stays "owed" until the full amount is paid).

=== MONEY (one definition, used by Overview cards, History totals and the detail) ===
  total_paid  = bookings.amount_paid = SUM(payment_entries.amount_pkr) incl. negative entries (refunds paid out,
                corrections). `recompute_payment_totals` is its only writer.
  collected   = money actually received and still kept, net of refunds: per booking
                  amount_paid - remaining_owed_refund
                where remaining_owed_refund = max(refund_amount - refunded_amount, 0) of its dispute, EXCEPT disputes
                with reason `overpayment_excess` (that money was never credited to the ledger, so nothing to subtract).
                Refunds already paid out are already negative entries inside amount_paid, so they are not subtracted
                twice. Summed over EVERY booking of the selected operating day and courts (held / awaiting bookings
                hold 0).  A cancelled booking whose whole payment is owed back contributes 0.
  due         = max(price - amount_paid, 0) summed over CONFIRMED bookings (booked, completed, no_show), cancelled /
                held / awaiting-approval / expired never. `due_bookings` = how many of them have due > 0.
  refunds     = bookings whose dispute has refund_amount > 0: count, and the sum of refund_amount.
These differ on purpose from the Ledger page: the Ledger sums payment entries by the DATE THE ENTRY WAS RECORDED,
Overview sums by the OPERATING DAY OF THE BOOKING, and Overview nets out refunds still owed. For bookings played on the
day they were paid for, with no refund pending, the two agree (tests/test_owner_overview.py proves it).
The Ledger's all-time `outstanding_balance` counts booked + completed only; Overview's Due also counts no_show (the
owner's spec: "total minus collected for non-cancelled bookings").

=== COMPLETION ===
Current state of a booking = its latest `booking.completion_marked` audit row (DISTINCT ON for a whole page).
"""
import csv
import io
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from fastapi import status
from sqlalchemy import String, and_, case, cast, func, literal, not_, or_, select, true, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.audit import AuditLog
from app.models.booking import Booking, BookingStatus, CancelledBy
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.schemas.owner_overview import (
    BookingCompletionOut,
    BookingTimelineEventOut,
    DetailApprovalOut,
    DetailCancellationOut,
    DetailRefundOut,
    HistoryTotalsOut,
    OperatingDayOut,
    OverviewBookingsOut,
    OverviewCourtBookingCountOut,
    OverviewMoneyOut,
    OverviewPendingOut,
    OverviewRefundsOut,
    OverviewSlotsOut,
    OwnerBadgesOut,
    OwnerBookingDetailOut,
    OwnerBookingRowOut,
    OwnerBookingsPageOut,
    OwnerOverviewOut,
    SlotCourtCountsOut,
)
from app.services.booking_service import BookingService
from app.services.payment_service import AWAITING_STATES
from app.services.overview_slots import (
    CONFIRMED_STATUSES,
    count_slots,
    operating_day_expr,
    starts_between_prefilter,
)
from app.services.live_bookings import hold_not_expired
from app.services.payment_ledger_service import UNCREDITED_REFUND_REASONS, PaymentLedgerService
from app.services.staff_service import resolve_owner_context, staffed_venue_ids
from app.utils.timezone import pkt_today

COMPLETION_ACTION = "booking.completion_marked"
EXPIRY_REASONS = ("hold_expired", "payment_review_expired")
OVERVIEW_STATUS_KEYS = ("booked", "no_show", "cancelled", "refund_owed", "refunded")
CONFIRMED_VALUES = tuple(s.value for s in CONFIRMED_STATUSES)
GRID_MINUTES = 30
MAX_PAGE_SIZE = 100

SORT_FIELDS = ("starts_at", "player", "court", "total", "advance", "due", "total_paid", "status")
STATUS_FILTERS = {
    "booked", "pending", "cancelled", "refund", "completed", "short_paid",
    "held", "awaiting_approval", "no_show", "refund_owed", "refunded", "expired",
    "checked_in", "completed_yes", "completed_no",
    "status_pending",
}


def short_code(booking_id: uuid.UUID) -> str:
    return "KH-" + booking_id.hex[:8].upper()


def _confirmed_cond():
    return cast(Booking.status, String).in_(CONFIRMED_VALUES)


def status_pending_cond(now_expr=None):
    """Round 2 Stage 2 (spec C.3/C.4): a booking whose status the owner still has to settle -- still `booked`, its
    slot has ended, and no Haan/Nahi completion was recorded (a completion before Stage 2 only wrote the audit row and
    left status=booked; those are NOT pending). Checked-in bookings are already `completed`."""
    completion_exists = (
        select(AuditLog.id)
        .where(
            AuditLog.entity_type == "booking",
            AuditLog.entity_id == Booking.id,
            AuditLog.action == COMPLETION_ACTION,
        )
        .correlate(Booking)
        .exists()
    )
    return and_(
        Booking.status == BookingStatus.BOOKED,
        Booking.ends_at <= (now_expr if now_expr is not None else func.now()),
        not_(completion_exists),
    )


def _expired_cond():
    return and_(
        Booking.status == BookingStatus.CANCELLED,
        Booking.cancelled_by.is_not(None),
        Booking.cancelled_by == CancelledBy.SYSTEM,
        func.coalesce(Booking.cancellation_reason, "").in_(EXPIRY_REASONS),
    )


def _dedup_disputes():
    """One dispute per booking (the one with a refund first, then the newest) -- normally there is exactly one."""
    return (
        select(
            PaymentDispute.booking_id,
            PaymentDispute.reason,
            PaymentDispute.refund_amount,
            PaymentDispute.refund_status,
            PaymentDispute.refunded_amount,
            PaymentDispute.refund_reference,
            PaymentDispute.refunded_at,
            PaymentDispute.refunded_by_user_id,
            PaymentDispute.created_at,
        )
        .distinct(PaymentDispute.booking_id)
        .order_by(
            PaymentDispute.booking_id,
            (func.coalesce(PaymentDispute.refund_amount, 0) > 0).desc(),
            PaymentDispute.created_at.desc(),
        )
        .subquery("disp")
    )


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass
class HistoryFilter:
    date_from: date
    date_to: date
    court_ids: list[uuid.UUID] | None = None
    statuses: list[str] | None = None
    q: str | None = None
    sort: str = "starts_at:desc"
    # Owner Round 2 (A2 focus mode): only this booking's rows (main + cancelled/refund), date range ignored.
    booking_id: uuid.UUID | None = None


class OwnerOverviewService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.disp = _dedup_disputes()
        self.player = aliased(User)

    # ------------------------------------------------------------------ scope

    async def resolve_venue(self, actor: User, venue_id: uuid.UUID | None, permission: str) -> Venue:
        """The one venue a request is about. Staff are pinned to a venue they staff WITH `permission` (same helper
        every owner dashboard endpoint uses); owners to one of their own (the only one, or `venue_id`); an admin must
        name the venue."""
        if actor.role == UserRole.STAFF:
            _owner, target = await resolve_owner_context(self.db, actor, venue_id, permission)
            venue = await self.db.get(Venue, target) if target else None
        elif actor.role == UserRole.ADMIN:
            if venue_id is None:
                raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
            venue = await self.db.get(Venue, venue_id)
        elif venue_id is not None:
            venue = await self.db.get(Venue, venue_id)
            if venue is not None and venue.owner_id != actor.id:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
        else:
            venues = list((await self.db.execute(select(Venue).where(Venue.owner_id == actor.id))).scalars().all())
            if len(venues) > 1:
                raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
            venue = venues[0] if venues else None
        if venue is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
        return venue

    async def courts_in_scope(
        self, venue: Venue, court_ids: list[uuid.UUID] | None, *, active_only: bool
    ) -> list[Court]:
        """The selected courts (ids that are not this venue's are dropped); no selection = every court (active ones
        only for live views, all of them for the historical views)."""
        query = select(Court).where(Court.venue_id == venue.id)
        if court_ids:
            query = query.where(Court.id.in_(court_ids))
        elif active_only:
            query = query.where(Court.is_active.is_(True))
        return list((await self.db.execute(query.order_by(Court.name, Court.id))).scalars().all())

    # ------------------------------------------------------------------ SQL pieces

    def _money_exprs(self):
        disp = self.disp
        remaining_owed = case(
            (disp.c.reason.in_(UNCREDITED_REFUND_REASONS), 0),
            else_=func.greatest(func.coalesce(disp.c.refund_amount, 0) - func.coalesce(disp.c.refunded_amount, 0), 0),
        )
        collected = func.greatest(Booking.amount_paid - remaining_owed, 0)
        due_confirmed = case((_confirmed_cond(), func.greatest(Booking.price - Booking.amount_paid, 0)), else_=0)
        return collected, due_confirmed, remaining_owed

    def _completion_result_expr(self):
        return (
            select(AuditLog.new_value["result"].astext)
            .where(
                AuditLog.entity_type == "booking",
                AuditLog.entity_id == Booking.id,
                AuditLog.action == COMPLETION_ACTION,
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(1)
            .correlate(Booking)
            .scalar_subquery()
        )

    def _search_clause(self, q: str):
        term = q.strip()
        like = "%" + _escape_like(term) + "%"
        conds = [
            Booking.player_name.ilike(like, escape="\\"),
            self.player.name.ilike(like, escape="\\"),
            Booking.player_phone.ilike(like, escape="\\"),
            self.player.phone.ilike(like, escape="\\"),
        ]
        digits = re.sub(r"[\s\-()]", "", term)
        if re.fullmatch(r"\+?\d{4,}", digits):
            tail = digits.lstrip("+").lstrip("0")
            if tail:
                conds.append(Booking.player_phone.like("%" + tail + "%"))
                conds.append(self.player.phone.like("%" + tail + "%"))
        code = re.sub(r"^kh-?", "", term.lower()).replace("-", "")
        if re.fullmatch(r"[0-9a-f]{3,32}", code):
            conds.append(func.replace(cast(Booking.id, String), "-", "").like(code + "%"))
        return or_(*conds)

    def _branch(self, variant: str, booking_where: list):
        """One half of the row set: the MAIN row of every booking in scope, or its REFUND row."""
        disp = self.disp
        collected, due_confirmed, remaining_owed = self._money_exprs()
        refund_positive = func.coalesce(disp.c.refund_amount, 0) > 0
        if variant == "main":
            status_key = case(
                (Booking.status == BookingStatus.HELD, "held"),
                (Booking.status == BookingStatus.PAYMENT_SUBMITTED, "awaiting_approval"),
                (Booking.status == BookingStatus.NO_SHOW, "no_show"),
                (_expired_cond(), "expired"),
                (Booking.status == BookingStatus.CANCELLED, "cancelled"),
                else_="booked",
            )
            kind = case((Booking.status == BookingStatus.CANCELLED, "cancelled"), else_="booked")
        else:
            status_key = case((disp.c.refund_status == "owed", "refund_owed"), else_="refunded")
            kind = literal("refund", String)
        due_row = case(
            (cast(Booking.status, String).in_(CONFIRMED_VALUES + ("held", "payment_submitted")),
             func.greatest(Booking.price - Booking.amount_paid, 0)),
            else_=0,
        )
        sel = (
            select(
                Booking.id.label("booking_id"),
                literal(variant, String).label("variant"),
                status_key.label("status_key"),
                kind.label("kind"),
                cast(Booking.status, String).label("status"),
                Booking.court_id.label("court_id"),
                Court.name.label("court_name"),
                Booking.starts_at.label("starts_at"),
                Booking.ends_at.label("ends_at"),
                Booking.created_at.label("created_at"),
                Booking.price.label("price"),
                Booking.advance_amount.label("advance_amount"),
                func.least(Booking.advance_amount, Booking.amount_paid).label("advance_paid"),
                Booking.amount_paid.label("amount_paid"),
                due_row.label("due"),
                due_confirmed.label("due_confirmed"),
                collected.label("collected"),
                cast(Booking.source, String).label("source"),
                func.coalesce(Booking.player_name, self.player.name).label("player_name"),
                func.coalesce(Booking.player_phone, self.player.phone).label("player_phone"),
                self.player.avatar_url.label("player_avatar_url"),
                Booking.checked_in_at.label("checked_in_at"),
                disp.c.refund_amount.label("refund_amount"),
                disp.c.refund_status.label("refund_status"),
                self._completion_result_expr().label("completion_result"),
            )
            .select_from(Booking)
            .join(Court, Court.id == Booking.court_id)
            .outerjoin(self.player, self.player.id == Booking.player_id)
            .outerjoin(disp, disp.c.booking_id == Booking.id)
            .where(*booking_where)
        )
        if variant == "refund":
            sel = sel.where(refund_positive)
        return sel

    def _rows_subquery(self, booking_where: list):
        return union_all(self._branch("main", booking_where), self._branch("refund", booking_where)).subquery("rows")

    @staticmethod
    def _day_where(date_from: date, date_to: date, court_ids: list[uuid.UUID]) -> list:
        lo, hi = starts_between_prefilter(date_from, date_to)
        op_day = operating_day_expr()
        return [
            Booking.court_id.in_(court_ids),
            Booking.starts_at >= lo,
            Booking.starts_at < hi,
            op_day >= date_from,
            op_day <= date_to,
        ]

    # ------------------------------------------------------------------ row building

    async def _completions(self, booking_ids: list[uuid.UUID]) -> dict[uuid.UUID, BookingCompletionOut]:
        """Current completion of each booking = its latest audit row: ONE query for the whole page."""
        if not booking_ids:
            return {}
        result = await self.db.execute(
            select(AuditLog, User.name)
            .outerjoin(User, User.id == AuditLog.actor_id)
            .where(
                AuditLog.entity_type == "booking",
                AuditLog.action == COMPLETION_ACTION,
                AuditLog.entity_id.in_(booking_ids),
            )
            .distinct(AuditLog.entity_id)
            .order_by(AuditLog.entity_id, AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        return {log.entity_id: self._completion_out(log, name) for log, name in result.all()}

    @staticmethod
    def _completion_out(log: AuditLog, actor_name: str | None) -> BookingCompletionOut:
        value = log.new_value or {}
        return BookingCompletionOut(
            result=value.get("result", "yes"),
            received_pkr=int(value.get("received_pkr") or 0),
            reason=value.get("reason"),
            marked_at=log.created_at,
            marked_by_name=actor_name,
        )

    @staticmethod
    def _row_out(m, completions: dict[uuid.UUID, BookingCompletionOut], now: datetime, show_phone: bool) -> OwnerBookingRowOut:
        duration = int((m.ends_at - m.starts_at).total_seconds() // 60)
        refund_amount = float(m.refund_amount) if m.refund_amount is not None and m.refund_amount > 0 else None
        refund_status = None
        if refund_amount is not None:
            refund_status = "owed" if m.refund_status == "owed" else "paid"
        is_confirmed = m.status in CONFIRMED_VALUES
        status_pending = bool(
            m.variant == "main" and m.status == "booked" and m.ends_at <= now and m.completion_result is None
        )
        return OwnerBookingRowOut(
            status_pending=status_pending,
            booking_id=m.booking_id,
            short_code=short_code(m.booking_id),
            kind=m.kind,
            status_key=m.status_key,
            player_name=m.player_name,
            player_avatar_url=getattr(m, "player_avatar_url", None),
            player_phone=m.player_phone if show_phone else None,
            court_id=m.court_id,
            court_name=m.court_name,
            starts_at=m.starts_at,
            ends_at=m.ends_at,
            duration_minutes=duration,
            slot_count=max(duration // GRID_MINUTES, 1),
            total=float(m.price),
            advance=float(m.advance_paid),
            due=float(m.due),
            total_paid=float(m.amount_paid),
            source=m.source,
            checked_in=m.checked_in_at is not None,
            completion=completions.get(m.booking_id) if (is_confirmed and m.variant == "main") else None,
            slot_ended=m.ends_at <= now,
            original_booking_id=m.booking_id if m.kind in ("cancelled", "refund") else None,
            refund_amount=refund_amount,
            refund_status=refund_status,
        )

    async def _build_rows(self, records, now: datetime, show_phone: bool = True) -> list[OwnerBookingRowOut]:
        completions = await self._completions(list({r.booking_id for r in records if r.status in CONFIRMED_VALUES}))
        return [self._row_out(r, completions, now, show_phone) for r in records]

    # ------------------------------------------------------------------ Overview

    async def overview(
        self, actor: User, target_date: date | None, venue_id: uuid.UUID | None, court_ids: list[uuid.UUID] | None
    ) -> OwnerOverviewOut:
        target_date = target_date or pkt_today()
        now = datetime.now(timezone.utc)
        venue = await self.resolve_venue(actor, venue_id, "view_ledger")
        courts = await self.courts_in_scope(venue, court_ids, active_only=True)
        cids = [c.id for c in courts]

        slots = await count_slots(self.db, courts, target_date, now)

        rows: list[OwnerBookingRowOut] = []
        per_court: dict[uuid.UUID, dict] = {}
        if cids:
            sub = self._rows_subquery(self._day_where(target_date, target_date, cids))
            records = (
                await self.db.execute(
                    select(sub)
                    .where(sub.c.status_key.in_(OVERVIEW_STATUS_KEYS))
                    .order_by(sub.c.starts_at, sub.c.court_name, sub.c.booking_id, sub.c.variant)
                )
            ).all()
            rows = await self._build_rows(records, now)
            per_court = await self._aggregates(cids, target_date, target_date, group_by_court=True)

        pending_all = OverviewPendingOut(count=0, awaiting_approval=0, awaiting_payment=0)
        if cids:
            pa = (
                await self.db.execute(
                    select(
                        func.count().filter(Booking.status == BookingStatus.PAYMENT_SUBMITTED),
                        func.count().filter(Booking.status == BookingStatus.HELD),
                    ).where(
                        Booking.court_id.in_(cids),
                        Booking.status.in_((BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED)),
                        hold_not_expired(now),
                    )
                )
            ).one()
            pending_all = OverviewPendingOut(
                count=int(pa[0]) + int(pa[1]), awaiting_approval=int(pa[0]), awaiting_payment=int(pa[1])
            )

        status_pending_count = 0
        if cids:
            status_pending_count = int(
                await self.db.scalar(
                    select(func.count(Booking.id)).where(Booking.court_id.in_(cids), status_pending_cond(now))
                )
                or 0
            )

        def agg(cid: uuid.UUID, key: str) -> int | float:
            return per_court.get(cid, {}).get(key, 0)

        total = lambda key: sum(per_court[c].get(key, 0) for c in per_court)  # noqa: E731
        return OwnerOverviewOut(
            date=target_date,
            venue_id=venue.id,
            operating_day=(
                OperatingDayOut(start_at=slots.operating_start, end_at=slots.operating_end)
                if slots.operating_start and slots.operating_end
                else None
            ),
            slots=OverviewSlotsOut(
                total=slots.total,
                booked=slots.booked,
                pending=slots.pending,
                blocked=slots.blocked,
                free=slots.free,
                free_upcoming=slots.free_upcoming,
                free_past=slots.free_past,
                by_court=[
                    SlotCourtCountsOut(
                        court_id=c.court_id, court_name=c.court_name, total=c.total, booked=c.booked,
                        pending=c.pending, blocked=c.blocked, free=c.free,
                    )
                    for c in slots.by_court
                ],
            ),
            bookings=OverviewBookingsOut(
                count=int(total("confirmed")),
                cancelled=int(total("cancelled")),
                refunds=OverviewRefundsOut(count=int(total("refund_count")), amount=float(total("refund_amount"))),
                pending=OverviewPendingOut(
                    count=int(total("awaiting_approval") + total("awaiting_payment")),
                    awaiting_approval=int(total("awaiting_approval")),
                    awaiting_payment=int(total("awaiting_payment")),
                ),
                by_court=[
                    OverviewCourtBookingCountOut(court_id=c.id, court_name=c.name, count=int(agg(c.id, "confirmed")))
                    for c in courts
                ],
            ),
            money=OverviewMoneyOut(
                collected=int(round(total("collected"))),
                due=int(round(total("due"))),
                due_bookings=int(total("due_bookings")),
            ),
            rows=rows,
            pending_all=pending_all,
            status_pending_count=status_pending_count,
        )

    async def _aggregates(
        self, court_ids: list[uuid.UUID], date_from: date, date_to: date, *, group_by_court: bool
    ) -> dict[uuid.UUID, dict]:
        """The card numbers for the bookings of the selected operating days and courts: ONE grouped query."""
        disp = self.disp
        collected, due_confirmed, _remaining = self._money_exprs()
        refund_positive = func.coalesce(disp.c.refund_amount, 0) > 0
        confirmed = _confirmed_cond()
        query = (
            select(
                Booking.court_id,
                func.count().filter(confirmed).label("confirmed"),
                func.count().filter(and_(Booking.status == BookingStatus.CANCELLED, not_(_expired_cond()))).label("cancelled"),
                func.count().filter(Booking.status == BookingStatus.PAYMENT_SUBMITTED).label("awaiting_approval"),
                func.count().filter(and_(Booking.status == BookingStatus.HELD, hold_not_expired())).label("awaiting_payment"),
                func.count().filter(refund_positive).label("refund_count"),
                func.coalesce(func.sum(case((refund_positive, disp.c.refund_amount), else_=0)), 0).label("refund_amount"),
                func.coalesce(func.sum(collected), 0).label("collected"),
                func.coalesce(func.sum(due_confirmed), 0).label("due"),
                func.count().filter(and_(confirmed, due_confirmed > 0)).label("due_bookings"),
            )
            .select_from(Booking)
            .outerjoin(disp, disp.c.booking_id == Booking.id)
            .where(*self._day_where(date_from, date_to, court_ids))
            .group_by(Booking.court_id)
        )
        return {
            r.court_id: {
                "confirmed": r.confirmed, "cancelled": r.cancelled, "awaiting_approval": r.awaiting_approval,
                "awaiting_payment": r.awaiting_payment, "refund_count": r.refund_count,
                "refund_amount": float(r.refund_amount), "collected": float(r.collected),
                "due": float(r.due), "due_bookings": r.due_bookings,
            }
            for r in (await self.db.execute(query)).all()
        }

    # ------------------------------------------------------------------ History

    def _status_predicate(self, sub, statuses: list[str]):
        parts = []
        main = sub.c.variant == "main"
        for s in statuses:
            if s == "booked":
                parts.append(and_(main, sub.c.status.in_(CONFIRMED_VALUES)))
            elif s == "pending":
                parts.append(sub.c.status_key.in_(("held", "awaiting_approval")))
            elif s == "refund":
                parts.append(sub.c.variant == "refund")
            elif s in ("completed", "completed_yes"):
                parts.append(and_(main, sub.c.completion_result == "yes"))
            elif s in ("short_paid", "completed_no"):
                parts.append(and_(main, sub.c.completion_result == "no"))
            elif s == "checked_in":
                parts.append(and_(main, sub.c.checked_in_at.is_not(None)))
            elif s == "status_pending":
                parts.append(
                    and_(main, sub.c.status == "booked", sub.c.ends_at <= func.now(), sub.c.completion_result.is_(None))
                )
            else:
                parts.append(sub.c.status_key == s)
        return or_(*parts) if parts else true()

    def _sort_columns(self, sub, sort: str):
        field, _, direction = (sort or "starts_at:desc").partition(":")
        if field not in SORT_FIELDS:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, f"Cannot sort by {field}")
        column = {
            "starts_at": sub.c.starts_at,
            "player": func.lower(func.coalesce(sub.c.player_name, "")),
            "court": sub.c.court_name,
            "total": sub.c.price,
            "advance": sub.c.advance_paid,
            "due": sub.c.due,
            "total_paid": sub.c.amount_paid,
            "status": sub.c.status_key,
        }[field]
        column = column.asc() if direction == "asc" else column.desc()
        return [column, sub.c.starts_at.desc(), sub.c.booking_id, sub.c.variant]

    async def _history_subquery(self, venue: Venue, f: HistoryFilter):
        courts = await self.courts_in_scope(venue, f.court_ids, active_only=False)
        if not courts:
            return None
        if f.booking_id is not None:
            where = [Booking.court_id.in_([c.id for c in courts]), Booking.id == f.booking_id]
        elif f.date_to < f.date_from:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "date_to must be >= date_from")
        else:
            where = self._day_where(f.date_from, f.date_to, [c.id for c in courts])
        if f.q and f.q.strip():
            where.append(self._search_clause(f.q))
        sub = self._rows_subquery(where)
        filtered = select(sub)
        if f.statuses:
            unknown = [s for s in f.statuses if s not in STATUS_FILTERS]
            if unknown:
                raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, f"Unknown status filter: {unknown[0]}")
            filtered = filtered.where(self._status_predicate(sub, f.statuses))
        return sub, filtered

    async def history(
        self,
        actor: User,
        venue_id: uuid.UUID | None,
        f: HistoryFilter,
        page: int,
        page_size: int,
    ) -> OwnerBookingsPageOut:
        page = max(page, 1)
        page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
        now = datetime.now(timezone.utc)
        venue = await self.resolve_venue(actor, venue_id, "view_ledger")
        built = await self._history_subquery(venue, f)
        empty_totals = HistoryTotalsOut(count=0, total=0, collected=0, due=0)
        if built is None:
            return OwnerBookingsPageOut(items=[], total=0, page=page, page_size=page_size, totals=empty_totals)
        sub, filtered = built
        order = self._sort_columns(sub, f.sort)
        filtered_sq = filtered.subquery("filtered")

        total = int(await self.db.scalar(select(func.count()).select_from(filtered_sq)) or 0)
        records = (
            await self.db.execute(
                filtered.order_by(*order).limit(page_size).offset((page - 1) * page_size)
            )
        ).all()
        items = await self._build_rows(records, now)

        # Totals: one line per distinct BOOKING (a cancelled booking with a refund is two rows but one booking).
        per_booking = (
            select(
                filtered_sq.c.booking_id,
                filtered_sq.c.status,
                filtered_sq.c.price,
                filtered_sq.c.collected,
                filtered_sq.c.due_confirmed,
            )
            .distinct(filtered_sq.c.booking_id)
            .order_by(filtered_sq.c.booking_id)
            .subquery("per_booking")
        )
        t = (
            await self.db.execute(
                select(
                    func.count(),
                    func.coalesce(func.sum(case((per_booking.c.status.in_(CONFIRMED_VALUES), per_booking.c.price), else_=0)), 0),
                    func.coalesce(func.sum(per_booking.c.collected), 0),
                    func.coalesce(func.sum(per_booking.c.due_confirmed), 0),
                ).select_from(per_booking)
            )
        ).one()
        return OwnerBookingsPageOut(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            totals=HistoryTotalsOut(count=t[0], total=float(t[1]), collected=float(t[2]), due=float(t[3])),
        )

    async def history_csv(self, actor: User, venue_id: uuid.UUID | None, f: HistoryFilter) -> str:
        now = datetime.now(timezone.utc)
        venue = await self.resolve_venue(actor, venue_id, "view_ledger")
        built = await self._history_subquery(venue, f)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            ["booking_code", "booking_id", "status", "player", "phone", "court", "starts_at", "ends_at", "duration_minutes",
             "total", "advance_paid", "due", "total_paid", "completion", "completion_received", "refund_amount", "refund_status"]
        )
        if built is None:
            return buf.getvalue()
        sub, filtered = built
        records = (await self.db.execute(filtered.order_by(*self._sort_columns(sub, f.sort)))).all()
        rows = await self._build_rows(records, now)
        for r in rows:
            writer.writerow(
                [
                    _csv_safe(x)
                    for x in (
                        r.short_code, str(r.booking_id), r.status_key, r.player_name or "", r.player_phone or "",
                        r.court_name, r.starts_at.isoformat(), r.ends_at.isoformat(), r.duration_minutes,
                        r.total, r.advance, r.due, r.total_paid,
                        r.completion.result if r.completion else "", r.completion.received_pkr if r.completion else "",
                        r.refund_amount if r.refund_amount is not None else "", r.refund_status or "",
                    )
                ]
            )
        return buf.getvalue()

    # ------------------------------------------------------------------ Detail

    async def _main_row(self, booking_id: uuid.UUID, now: datetime, show_phone: bool = True) -> OwnerBookingRowOut:
        sub = self._rows_subquery([Booking.id == booking_id])
        record = (
            await self.db.execute(
                select(sub).where(sub.c.variant == "main").execution_options(populate_existing=True)
            )
        ).first()
        if record is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND, "Booking not found")
        return (await self._build_rows([record], now, show_phone))[0]

    async def detail(self, actor: User, booking_id: uuid.UUID) -> OwnerBookingDetailOut:
        now = datetime.now(timezone.utc)
        booking = await BookingService(self.db, self.settings).require_accessible_booking(
            booking_id, actor, permission="view_ledger"
        )
        row = await self._main_row(booking.id, now)

        payments, audit_rows, dispute, names = await self._detail_parts(booking)

        proof_payment = next((p for p in reversed(payments) if p.proof_key), None)
        shown_payment = next((p for p in reversed(payments) if p.review_verdict), None) or (payments[-1] if payments else None)
        approval = None
        if shown_payment is not None:
            approval = DetailApprovalOut(
                verdict=shown_payment.review_verdict if shown_payment.review_verdict in ("approved", "rejected") else None,
                by_name=names.get(shown_payment.reviewed_by) if shown_payment.reviewed_by else None,
                at=shown_payment.reviewed_at,
                reason=shown_payment.rejection_reason,
                auto=bool(shown_payment.auto_approved),
            )

        cancellation = None
        cancel_log = next((a for a in reversed(audit_rows) if a.action in ("booking.cancelled", "booking.expired")), None)
        if booking.status == BookingStatus.CANCELLED:
            cancellation = DetailCancellationOut(
                by=(booking.cancelled_by.value if booking.cancelled_by else "system"),
                at=cancel_log.created_at if cancel_log else booking.updated_at,
                reason=booking.cancellation_reason,
            )

        refund = None
        if dispute is not None:
            refund = DetailRefundOut(
                amount=float(dispute.refund_amount or 0),
                status="owed" if dispute.refund_status == "owed" else "paid",
                paid_at=dispute.refunded_at,
                reference=dispute.refund_reference,
            )

        completion_logs = [a for a in audit_rows if a.action == COMPLETION_ACTION]
        completion = (
            self._completion_out(completion_logs[-1], names.get(completion_logs[-1].actor_id))
            if completion_logs and booking.status.value in CONFIRMED_VALUES
            else None
        )

        events = self._timeline(booking, payments, audit_rows, dispute, cancellation, completion_logs, names, now)

        hold_expires = booking.held_until if booking.status == BookingStatus.HELD else (
            booking.payment_deadline if booking.status == BookingStatus.PAYMENT_SUBMITTED else None
        )
        return OwnerBookingDetailOut(
            row=row,
            booked_at=booking.created_at,
            hold_expires_at=hold_expires,
            advance_required=float(booking.advance_amount),
            payment_id=proof_payment.id if proof_payment else None,
            ocr_verdict=(proof_payment.ocr_verdict if proof_payment else None),
            ocr_amount=(float(proof_payment.ocr_amount) if proof_payment and proof_payment.ocr_amount is not None else None),
            approval=approval,
            cancellation=cancellation,
            refund=refund,
            completion=completion,
            timeline=events,
            channel_detail=await self._channel_detail(booking, audit_rows),
        )

    async def _detail_parts(self, booking: Booking):
        """Payments, the booking's audit rows, its refund dispute (amount > 0) and actor names: shared by the owner detail and the
        player's own booking detail (audit 2026-10-28 item 4)."""
        payments = list(
            (await self.db.execute(select(Payment).where(Payment.booking_id == booking.id).order_by(Payment.created_at)))
            .scalars()
            .all()
        )
        audit_rows = list(
            (
                await self.db.execute(
                    select(AuditLog)
                    .where(AuditLog.entity_type == "booking", AuditLog.entity_id == booking.id)
                    .order_by(AuditLog.created_at, AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
        dispute = (
            await self.db.execute(
                select(PaymentDispute)
                .where(PaymentDispute.booking_id == booking.id, func.coalesce(PaymentDispute.refund_amount, 0) > 0)
                .order_by(PaymentDispute.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        user_ids = {a.actor_id for a in audit_rows if a.actor_id}
        user_ids |= {p.reviewed_by for p in payments if p.reviewed_by}
        if dispute is not None and dispute.refunded_by_user_id:
            user_ids.add(dispute.refunded_by_user_id)
        names: dict[uuid.UUID, str] = {}
        if user_ids:
            names = {
                uid: name
                for uid, name in (await self.db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()
                if name
            }

        return payments, audit_rows, dispute, names

    def _timeline(self, booking, payments, audit_rows, dispute, cancellation, completion_logs, names, now) -> list[BookingTimelineEventOut]:
        """Timeline: data only (kinds + amounts + names + reasons), the UI writes the words."""
        events: list[BookingTimelineEventOut] = []
        events.append(
            BookingTimelineEventOut(
                at=booking.created_at,
                kind="held" if booking.source.value in ("app", "whatsapp") else "created",
            )
        )
        for p in payments:
            if p.proof_key:
                events.append(
                    BookingTimelineEventOut(
                        at=p.created_at, kind="proof_submitted",
                        amount=float(p.ocr_amount if p.ocr_amount is not None else (p.amount_claimed or 0)) or None,
                    )
                )
            if p.review_verdict in ("approved", "rejected") and p.reviewed_at:
                events.append(
                    BookingTimelineEventOut(
                        at=p.reviewed_at, kind=p.review_verdict,
                        actor_name=names.get(p.reviewed_by) if p.reviewed_by else None,
                        note=p.rejection_reason,
                    )
                )
        if booking.status == BookingStatus.CANCELLED and cancellation is not None:
            is_expiry = booking.cancelled_by == CancelledBy.SYSTEM and (booking.cancellation_reason in EXPIRY_REASONS)
            events.append(
                BookingTimelineEventOut(
                    at=cancellation.at or booking.updated_at,
                    kind="expired" if is_expiry else "cancelled",
                    note=booking.cancellation_reason,
                )
            )
        if dispute is not None:
            events.append(
                BookingTimelineEventOut(at=dispute.created_at, kind="refund_owed", amount=float(dispute.refund_amount or 0))
            )
            if dispute.refunded_at:
                events.append(
                    BookingTimelineEventOut(
                        at=dispute.refunded_at, kind="refunded", amount=float(dispute.refunded_amount or 0),
                        actor_name=names.get(dispute.refunded_by_user_id) if dispute.refunded_by_user_id else None,
                        note=dispute.refund_reference,
                    )
                )
        if booking.checked_in_at:
            events.append(BookingTimelineEventOut(at=booking.checked_in_at, kind="checked_in", note=booking.checked_in_by))
        no_show = next((a for a in audit_rows if a.action == "booking.no_show"), None)
        if no_show is not None:
            events.append(BookingTimelineEventOut(at=no_show.created_at, kind="no_show"))
        if booking.status.value in CONFIRMED_VALUES and booking.starts_at <= now:
            events.append(BookingTimelineEventOut(at=booking.starts_at, kind="slot_started"))
        for a in completion_logs:
            value = a.new_value or {}
            if int(value.get("received_now") or 0) > 0:
                events.append(
                    BookingTimelineEventOut(
                        at=a.created_at, kind="balance_received", amount=float(value["received_now"]),
                        actor_name=names.get(a.actor_id) if a.actor_id else None,
                    )
                )
            events.append(
                BookingTimelineEventOut(
                    at=a.created_at, kind="completion_marked", amount=float(value.get("received_pkr") or 0),
                    actor_name=names.get(a.actor_id) if a.actor_id else None, note=value.get("reason"),
                )
            )
        events.sort(key=lambda e: e.at)
        return events

    async def _channel_detail(self, booking: Booking, audit_rows: list[AuditLog]) -> str | None:
        """Owner Round 2 (A4): a walk-in has source "walkin" whoever added it; the `booking.walkin` audit row's actor
        tells the venue owner ("owner") from a staff member ("staff"). None for any other source or no audit row."""
        if booking.source.value != "walkin":
            return None
        log = next((a for a in audit_rows if a.action == "booking.walkin" and a.actor_id), None)
        if log is None:
            return None
        court = await self.db.get(Court, booking.court_id)
        venue = await self.db.get(Venue, court.venue_id) if court is not None else None
        if venue is not None and log.actor_id == venue.owner_id:
            return "owner"
        actor = await self.db.get(User, log.actor_id)
        return "staff" if actor is not None and actor.role == UserRole.STAFF else None

    # ------------------------------------------------------------------ Completion

    async def mark_completion(
        self,
        actor: User,
        booking_id: uuid.UUID,
        result: str,
        received_pkr: int | None,
        reason: str | None,
        *,
        received_now: int | None = None,
    ) -> OwnerBookingRowOut:
        """"Booking completed": Haan (yes) = everything was received, Nahi (no) = only `received_pkr` was.

        The money goes through the payment ledger (`adjust_total_paid`): total paid becomes the price (yes) or the
        received amount (no) by appending ONE entry for the difference -- never an edit -- so the Ledger page, revenue
        and `bookings.amount_paid` stay consistent and nothing is double counted when the owner changes their mind
        later (a second call only appends the difference to the new target). The audit row `booking.completion_marked`
        carries old value (previous result) and new value. Not gated by the split_payments flag."""
        booking = await BookingService(self.db, self.settings).require_accessible_booking(
            booking_id, actor, permission="record_payments"
        )
        if booking.status.value not in CONFIRMED_VALUES:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.INVALID_BOOKING_STATE,
                "Only a confirmed booking can be marked completed",
            )
        now = datetime.now(timezone.utc)
        if now < booking.ends_at:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.COMPLETION_TOO_EARLY,
                "You can mark this booking completed after the slot has ended",
            )
        price = int(round(float(booking.price)))
        extra: dict = {}
        if result == "yes":
            target, reason = price, None
        elif received_now is not None:
            # Owner Round 2 (A8): "Baqi mein se kitna mila?" -- a POSITIVE amount on top of what was already paid.
            paid = int(round(float(booking.amount_paid)))
            due = max(price - paid, 0)
            if received_now < 0 or received_now > due:
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.VALIDATION_ERROR,
                    f"received_now must be between 0 and {due}",
                    details={"max": due},
                )
            reason = (reason or "").strip() or None
            remaining = due - received_now
            if remaining > 0 and reason is None:
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.REASON_REQUIRED,
                    "Please say why the balance was not received in full.",
                    details={"remaining": remaining},
                )
            target = paid + received_now
            if remaining == 0:
                result, reason = "yes", None  # everything due was received: Mukammal
            extra = {"received_now": received_now}
        else:
            if received_pkr is None:
                raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "received_pkr is required")
            if received_pkr < 0 or received_pkr > price:
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.VALIDATION_ERROR,
                    f"received_pkr must be between 0 and {price}",
                    details={"max": price},
                )
            target = received_pkr
            reason = (reason or "").strip() or None

        previous = (await self._completions([booking.id])).get(booking.id)
        ledger = PaymentLedgerService(self.db)
        await ledger.adjust_total_paid(
            booking.id,
            target_pkr=target,
            recorded_by=actor,
            note_up="Booking completed" if result == "yes" else "Booking completed: balance received",
            note_down="Booking completed: correction to the amount received",
        )
        old_status = booking.status
        await ledger.audit.log(
            actor_user_id=actor.id,
            actor_type=actor.role.value,
            action=COMPLETION_ACTION,
            entity_type="booking",
            entity_id=booking.id,
            old_value=(
                {"result": previous.result, "received_pkr": previous.received_pkr, "reason": previous.reason}
                if previous
                else None
            ),
            new_value={"result": result, "received_pkr": target, "reason": reason, **extra},
        )
        await self.db.commit()
        # Round 2 Stage 2 (spec C.3): Haan/Nahi settles the booking's STATUS too: booked or no_show -> completed
        # (audited as booking.completed with who/when; a wrong old no-show is fixed this way).
        if old_status in (BookingStatus.BOOKED, BookingStatus.NO_SHOW):
            await BookingService(self.db, self.settings).mark_completed(booking, actor=actor)
        return await self._main_row(booking.id, datetime.now(timezone.utc))

    # ------------------------------------------------------------------ Badges

    async def badges(self, actor: User, venue_id: uuid.UUID | None) -> OwnerBadgesOut:
        """{approvals, refunds}: the SAME rules as GET /owners/pending-approvals (unreviewed payments on active courts)
        and GET /owners/refunds (refund_status = owed, any court). Staff only count a venue where they hold the matching
        permission (view_ledger / mark_refunds) and need at least one."""
        if actor.role == UserRole.STAFF:
            approval_venues = await staffed_venue_ids(self.db, actor.id, "view_ledger")
            refund_venues = await staffed_venue_ids(self.db, actor.id, "mark_refunds")
            if venue_id is not None:
                approval_venues = [v for v in approval_venues if v == venue_id]
                refund_venues = [v for v in refund_venues if v == venue_id]
            if not approval_venues and not refund_venues:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
        elif actor.role == UserRole.ADMIN:
            if venue_id is None:
                raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
            approval_venues = refund_venues = [venue_id]
        else:
            query = select(Venue.id).where(Venue.owner_id == actor.id)
            if venue_id is not None:
                query = query.where(Venue.id == venue_id)
            approval_venues = refund_venues = list((await self.db.execute(query)).scalars().all())
            if venue_id is not None and not approval_venues:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
        approvals = refunds = 0
        if approval_venues:
            approvals = int(
                await self.db.scalar(
                    select(func.count(Payment.id))
                    .join(Booking, Booking.id == Payment.booking_id)
                    .join(Court, Court.id == Booking.court_id)
                    # audit 2026-10-28 item 7: only proofs the owner can still ACT on (the booking is still held / payment
                    # submitted). An unreviewed proof on a cancelled or expired booking is shown greyed on the Approvals
                    # page for acknowledgement, but it is not work, so the badge (web sidebar, app tab, Today line) skips it.
                    .where(
                        Court.venue_id.in_(approval_venues),
                        Court.is_active.is_(True),
                        Payment.review_verdict.is_(None),
                        or_(
                            Booking.status.in_(AWAITING_STATES),
                            # audit 2026-10-28 Phase 3 item 2: a balance screenshot on a booked booking is work too
                            and_(Booking.status == BookingStatus.BOOKED, Payment.ocr_raw["purpose"].astext == "balance"),
                        ),
                    )
                )
                or 0
            )
        if refund_venues:
            refunds = int(
                await self.db.scalar(
                    select(func.count(PaymentDispute.id))
                    .join(Booking, Booking.id == PaymentDispute.booking_id)
                    .join(Court, Court.id == Booking.court_id)
                    .where(
                        Court.venue_id.in_(refund_venues),
                        PaymentDispute.refund_status == "owed",
                        func.coalesce(PaymentDispute.refund_amount, 0) > 0,  # same rule as GET /owners/refunds
                    )
                )
                or 0
            )
        return OwnerBadgesOut(approvals=approvals, refunds=refunds)


def _csv_safe(value):
    """Spreadsheet formula injection guard for free text (player names)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value
