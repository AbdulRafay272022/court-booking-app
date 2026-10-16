"""Owner Overview + Bookings history + detail + badges (docs/owner-overview-contract.md). Real Postgres."""
import uuid
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models.booking import BookingSource, BookingStatus, CancelledBy
from app.models.user import User, UserRole
from app.services.overview_slots import count_slots, operating_day_expr
from app.utils.timezone import pkt_today
from overview_helpers import add_blackout, add_booking, add_dispute, at, make_staff, past_day, seed_venue

OV = "/api/v1/owners/overview"
HIST = "/api/v1/owners/bookings-history"

COURTS = (("Court A", time(15, 0), time(3, 0)), ("Court B", time(10, 0), time(22, 0)))  # A is overnight


@pytest.fixture
def seed(make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    async def _seed(phone="+923008800001", courts=COURTS):
        return await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, courts=courts)

    return _seed


async def _scenario(sf, a, b, d):
    """The day `d` used by most tests (see the arithmetic in the assertions)."""
    s = {}
    s["a1"] = await add_booking(sf, a, at(d, 20), 2, price=2000, paid=2000, name="Ali Raza", phone="+923001110001")
    s["a2"] = await add_booking(sf, a, at(d, 25), 1, price=1000, paid=400, advance=400, name="Night Owl")  # Fri 1 AM = day d
    s["a3"] = await add_booking(sf, a, at(d, 23), 1, status=BookingStatus.HELD, price=1000, name="Holder")
    s["b1"] = await add_booking(
        sf, b, at(d, 10), 1.5, status=BookingStatus.PAYMENT_SUBMITTED, price=1500, advance=500, name="Waiting", unreviewed_payment=True
    )
    s["b2"] = await add_booking(sf, b, at(d, 12), 1, status=BookingStatus.NO_SHOW, price=2000, name="No Show")
    s["b3"] = await add_booking(sf, b, at(d, 14), 1, status=BookingStatus.COMPLETED, price=2000, paid=2000, name="Checked", checked_in=True)
    s["b4"] = await add_booking(
        sf, b, at(d, 16), 1, status=BookingStatus.CANCELLED, price=2000, paid=2000, name="Canceller",
        cancelled_by=CancelledBy.PLAYER, reason="changed plans",
    )
    await add_dispute(sf, s["b4"], 2000)
    s["b5"] = await add_booking(
        sf, b, at(d, 18), 1, status=BookingStatus.CANCELLED, price=1000, name="Expired",
        cancelled_by=CancelledBy.SYSTEM, reason="hold_expired",
    )
    s["b6"] = await add_booking(sf, b, at(d, 19), 1, price=1000, paid=1000, name="Paid Up")
    await add_blackout(sf, a, at(d, 16), 1)
    return s


async def test_slot_counts_partition_overnight_multislot_blackout(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (a, b) = await seed()
    d = past_day()
    await _scenario(db_session_factory, a, b, d)
    headers = await make_auth_headers(owner)

    resp = await client.get(OV, params={"date": d.isoformat()}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    slots = body["slots"]
    # A (overnight 3 PM to 3 AM = 24 slots): booked 4 (a1) + 2 (a2, 1 AM Fri) , pending 2 (a3), blocked 2, free 14
    # B (10 AM to 10 PM = 24 slots): pending 3 (b1), booked 2+2+2 (b2, b3, b6), free 15 (b4 cancelled and b5 expired hold nothing)
    by = {c["court_name"]: c for c in slots["by_court"]}
    assert by["Court A"] == {**by["Court A"], "total": 24, "booked": 6, "pending": 2, "blocked": 2, "free": 14}
    assert by["Court B"] == {**by["Court B"], "total": 24, "booked": 6, "pending": 3, "blocked": 0, "free": 15}
    assert (slots["total"], slots["booked"], slots["pending"], slots["blocked"], slots["free"]) == (48, 12, 5, 2, 29)
    # THE INVARIANT, overall and per court
    assert slots["total"] == slots["booked"] + slots["pending"] + slots["blocked"] + slots["free"]
    for c in slots["by_court"]:
        assert c["total"] == c["booked"] + c["pending"] + c["blocked"] + c["free"]
    # a past day: every free slot has already ended
    assert (slots["free_upcoming"], slots["free_past"]) == (0, 29)
    # operating day = first open (B 10:00) to last close (A 3 AM next morning), Pakistan time
    assert body["operating_day"]["start_at"] == at(d, 10).isoformat().replace("+00:00", "Z")
    assert body["operating_day"]["end_at"] == at(d, 27).isoformat().replace("+00:00", "Z")


async def test_invariant_holds_every_weekday_and_future_days_are_free_upcoming(seed, db_session_factory):
    owner, venue, (a, b) = await seed("+923008800002")
    d0 = past_day(3)
    await _scenario(db_session_factory, a, b, d0)
    async with db_session_factory() as session:
        from app.models.court import Court

        courts = [await session.get(Court, a.id), await session.get(Court, b.id)]
        now = datetime.now(timezone.utc)
        for offset in range(-3, 10):
            day = pkt_today() + timedelta(days=offset)
            counts = await count_slots(session, courts, day, now)
            for c in counts.by_court:
                assert c.total == c.booked + c.pending + c.blocked + c.free
                assert c.free == c.free_upcoming + c.free_past
            assert counts.total == counts.booked + counts.pending + counts.blocked + counts.free
            if day > pkt_today() + timedelta(days=1):
                assert counts.free_past == 0 and counts.free_upcoming == counts.free
        # a fixed clock in the middle of day d0: slots that ended before it are free_past, the rest free_upcoming
        mid = at(d0, 18)
        counts = await count_slots(session, courts, d0, mid)
        assert counts.free_upcoming > 0 and counts.free_past > 0
        assert counts.free_upcoming + counts.free_past == counts.free


async def test_overview_cards_rows_and_money(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (a, b) = await seed("+923008800003")
    d = past_day()
    s = await _scenario(db_session_factory, a, b, d)
    headers = await make_auth_headers(owner)

    body = (await client.get(OV, params={"date": d.isoformat()}, headers=headers)).json()
    bk = body["bookings"]
    assert bk["count"] == 5  # a1 a2 b2 b3 b6: booked + completed + no_show
    assert bk["cancelled"] == 1  # b4; the expired hold b5 is not a cancellation the owner cares about
    assert bk["refunds"] == {"count": 1, "amount": 2000.0}
    assert bk["pending"] == {"count": 2, "awaiting_approval": 1, "awaiting_payment": 1}
    assert {c["court_name"]: c["count"] for c in bk["by_court"]} == {"Court A": 2, "Court B": 3}
    # Collected = 2000 (a1) + 400 (a2) + 2000 (b3) + 1000 (b6) + 0 (b4: 2000 paid, 2000 owed back) ; Due = 600 (a2) + 2000 (b2)
    assert body["money"] == {"collected": 5400, "due": 2600, "due_bookings": 2}

    rows = body["rows"]
    kinds = sorted((r["status_key"], r["kind"]) for r in rows)
    assert kinds == sorted([
        ("booked", "booked"), ("booked", "booked"), ("booked", "booked"), ("booked", "booked"),  # a1 a2 b3 b6
        ("no_show", "booked"), ("cancelled", "cancelled"), ("refund_owed", "refund"),
    ])
    # pending (b1 a3) and expired (b5) rows are NOT in the Overview table
    assert str(s["b1"].id) not in {r["booking_id"] for r in rows}
    assert str(s["b5"].id) not in {r["booking_id"] for r in rows}
    # cancelled + refund: two rows, same booking id, both pointing at the original
    b4_rows = [r for r in rows if r["booking_id"] == str(s["b4"].id)]
    assert sorted(r["kind"] for r in b4_rows) == ["cancelled", "refund"]
    assert all(r["original_booking_id"] == str(s["b4"].id) for r in b4_rows)
    refund_row = next(r for r in b4_rows if r["kind"] == "refund")
    assert refund_row["refund_amount"] == 2000 and refund_row["refund_status"] == "owed"
    # the 1 AM booking belongs to day d, not d+1 ; and money columns of one row
    a2 = next(r for r in rows if r["booking_id"] == str(s["a2"].id))
    assert (a2["total"], a2["advance"], a2["due"], a2["total_paid"]) == (1000, 400, 600, 400)
    assert a2["slot_ended"] is True and a2["short_code"] == "KH-" + s["a2"].id.hex[:8].upper()
    assert a2["duration_minutes"] == 60 and a2["slot_count"] == 2 and a2["checked_in"] is False
    b3 = next(r for r in rows if r["booking_id"] == str(s["b3"].id))
    assert b3["checked_in"] is True and b3["status_key"] == "booked"

    nxt = (await client.get(OV, params={"date": (d + timedelta(days=1)).isoformat()}, headers=headers)).json()
    assert str(s["a2"].id) not in {r["booking_id"] for r in nxt["rows"]}
    assert nxt["bookings"]["count"] == 0

    # court filter: only Court B
    only_b = (await client.get(OV, params={"date": d.isoformat(), "court_ids": str(b.id)}, headers=headers)).json()
    assert only_b["bookings"]["count"] == 3 and only_b["slots"]["total"] == 24
    both = (await client.get(OV, params={"date": d.isoformat(), "court_ids": f"{a.id},{b.id}"}, headers=headers)).json()
    assert both["slots"]["total"] == 48


async def test_overview_collected_agrees_with_ledger_for_the_same_day(seed, make_auth_headers, client, db_session_factory):
    """Same data, two pages: bookings played today and paid today (no refund pending) -> Overview.collected equals the
    Ledger's collected_today. (They legitimately differ for pending refunds and for entries recorded on another day than
    the booking; see owner_overview_service's docstring.)"""
    owner, venue, (a, b) = await seed("+923008800004")
    today = pkt_today()
    await add_booking(db_session_factory, b, at(today, 10), 1, price=2000, paid=2000, name="T1")
    await add_booking(db_session_factory, b, at(today, 12), 1, price=1500, paid=500, advance=500, name="T2")
    await add_booking(db_session_factory, a, at(today, 20), 2, price=2000, paid=1500, advance=1500, name="T3")
    headers = await make_auth_headers(owner)

    ov = (await client.get(OV, params={"date": today.isoformat()}, headers=headers)).json()
    ledger = (
        await client.get("/api/v1/owners/ledger", params={"start_date": today.isoformat(), "end_date": today.isoformat()}, headers=headers)
    ).json()
    assert ov["money"]["collected"] == 4000 == ledger["summary"]["collected_today"] == ledger["summary"]["total_in_range"]
    # outstanding: Overview's due for the day (500 left... 1000 + 500) is the same money the ledger calls outstanding
    assert ov["money"]["due"] == 1500 == int(ledger["summary"]["outstanding_balance"])

    # a pending refund is the documented difference: the ledger still counts the entry, Overview nets it out
    owed = await add_booking(
        db_session_factory, b, at(today, 15), 1, status=BookingStatus.CANCELLED, price=1000, paid=1000, name="C",
        cancelled_by=CancelledBy.PLAYER,
    )
    await add_dispute(db_session_factory, owed, 1000)
    ov2 = (await client.get(OV, params={"date": today.isoformat()}, headers=headers)).json()
    ledger2 = (
        await client.get("/api/v1/owners/ledger", params={"start_date": today.isoformat(), "end_date": today.isoformat()}, headers=headers)
    ).json()
    assert ledger2["summary"]["collected_today"] == 5000
    assert ov2["money"]["collected"] == 4000  # 5000 recorded minus the 1000 owed back


async def test_history_filters_search_sort_pagination_totals_and_csv(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (a, b) = await seed("+923008800005")
    d = past_day()
    s = await _scenario(db_session_factory, a, b, d)
    headers = await make_auth_headers(owner)
    base = {"date_from": d.isoformat(), "date_to": d.isoformat()}

    full = (await client.get(HIST, params={**base, "page_size": 100}, headers=headers)).json()
    assert full["total"] == 10  # 9 bookings + the refund row of b4
    assert full["totals"] == {"count": 9, "total": 8000.0, "collected": 5400.0, "due": 2600.0}
    keys = sorted(r["status_key"] for r in full["items"])
    assert keys.count("held") == 1 and keys.count("awaiting_approval") == 1 and keys.count("expired") == 1
    assert keys.count("no_show") == 1 and keys.count("refund_owed") == 1 and keys.count("cancelled") == 1

    async def ids(**extra):
        r = await client.get(HIST, params={**base, **extra}, headers=headers)
        assert r.status_code == 200, r.text
        return {x["booking_id"] for x in r.json()["items"]}, r.json()

    assert (await ids(statuses=["pending"]))[0] == {str(s["a3"].id), str(s["b1"].id)}
    assert (await ids(statuses=["refund"]))[0] == {str(s["b4"].id)}
    assert (await ids(statuses=["cancelled"]))[0] == {str(s["b4"].id)}
    assert (await ids(statuses=["expired"]))[0] == {str(s["b5"].id)}
    assert (await ids(statuses=["booked"]))[0] == {str(s[k].id) for k in ("a1", "a2", "b2", "b3", "b6")}
    assert (await ids(statuses="pending,expired"))[0] == {str(s[k].id) for k in ("a3", "b1", "b5")}  # comma list works too
    assert (await ids(court_ids=str(a.id)))[0] == {str(s[k].id) for k in ("a1", "a2", "a3")}
    # search: name, phone, short code, uuid prefix
    assert (await ids(q="ali raz"))[0] == {str(s["a1"].id)}
    assert (await ids(q="0300 1110001"))[0] == {str(s["a1"].id)}
    assert (await ids(q="KH-" + s["b6"].id.hex[:8].upper()))[0] == {str(s["b6"].id)}
    assert (await ids(q=str(s["b3"].id)[:13]))[0] == {str(s["b3"].id)}
    assert (await ids(q="%"))[0] == set()  # wildcards are escaped, not interpreted
    # sort + pagination
    p1 = (await client.get(HIST, params={**base, "page_size": 4, "sort": "total:desc"}, headers=headers)).json()
    p3 = (await client.get(HIST, params={**base, "page_size": 4, "page": 3, "sort": "total:desc"}, headers=headers)).json()
    assert p1["total"] == 10 and len(p1["items"]) == 4 and len(p3["items"]) == 2 and p3["page"] == 3
    assert [r["total"] for r in p1["items"]] == sorted((r["total"] for r in p1["items"]), reverse=True)
    assert p1["totals"] == full["totals"]  # totals are for the whole filtered set, not the page
    bad = await client.get(HIST, params={**base, "sort": "nope:asc"}, headers=headers)
    assert bad.status_code == 400
    assert (await client.get(HIST, params={**base, "page_size": 101}, headers=headers)).status_code == 422
    assert (await client.get(HIST, params={**base, "statuses": "bogus"}, headers=headers)).status_code == 400

    csv_resp = await client.get(HIST + "/export.csv", params={**base, "statuses": "booked"}, headers=headers)
    assert csv_resp.status_code == 200 and csv_resp.headers["content-type"].startswith("text/csv")
    lines = csv_resp.text.strip().splitlines()
    assert lines[0].startswith("booking_code,booking_id,status") and len(lines) == 6  # header + 5 confirmed


async def test_history_default_dates_and_range(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (a, b) = await seed("+923008800006")
    today = pkt_today()
    await add_booking(db_session_factory, b, at(today, 11), 1, name="Today")
    await add_booking(db_session_factory, b, at(today - timedelta(days=2), 11), 1, name="Earlier")
    headers = await make_auth_headers(owner)
    only_today = (await client.get(HIST, headers=headers)).json()
    assert [r["player_name"] for r in only_today["items"]] == ["Today"]
    rng = (await client.get(HIST, params={"date_from": (today - timedelta(days=3)).isoformat(), "date_to": today.isoformat()}, headers=headers)).json()
    assert rng["total"] == 2
    assert (await client.get(HIST, params={"date_from": today.isoformat(), "date_to": (today - timedelta(days=1)).isoformat()}, headers=headers)).status_code == 400


async def test_operating_day_sql_matches_python_rule(seed, db_session_factory):
    """The SQL operating-day expression gives the same day as opening_day_of for the overnight court's 1 AM tail."""
    from sqlalchemy import select

    from app.models.booking import Booking
    from app.models.schedule import ScheduleTemplate
    from app.utils.schedule import opening_day_of
    from app.utils.timezone import utc_to_pkt_naive

    owner, venue, (a, b) = await seed("+923008800011")
    d = past_day()
    ids = [
        (await add_booking(db_session_factory, a, at(d, h), 1)).id
        for h in (15, 20, 24, 25, 26)  # 3 PM, 8 PM, midnight, 1 AM, 2 AM : all belong to day d
    ]
    ids.append((await add_booking(db_session_factory, a, at(d, 27), 1)).id)  # 3 AM: closed hours, falls back to its own date
    async with db_session_factory() as session:
        templates = {
            t.day_of_week: t
            for t in (await session.execute(select(ScheduleTemplate).where(ScheduleTemplate.court_id == a.id))).scalars()
        }
        rows = (await session.execute(select(Booking.id, Booking.starts_at, operating_day_expr()).where(Booking.id.in_(ids)))).all()
    assert len(rows) == 6
    for _id, starts_at, sql_day in rows:
        assert sql_day == opening_day_of(utc_to_pkt_naive(starts_at), templates)
    assert sorted(r[2] for r in rows)[:5] == [d] * 5


async def test_detail_shape_timeline_and_privacy(seed, make_auth_headers, client, db_session_factory, make_user):
    owner, venue, (a, b) = await seed("+923008800007")
    d = past_day()
    s = await _scenario(db_session_factory, a, b, d)
    headers = await make_auth_headers(owner)

    r = await client.get(f"/api/v1/owners/bookings/{s['b4'].id}/overview-detail", headers=headers)
    assert r.status_code == 200, r.text
    det = r.json()
    assert det["row"]["booking_id"] == str(s["b4"].id) and det["row"]["status_key"] == "cancelled"
    assert det["cancellation"]["by"] == "player" and det["cancellation"]["reason"] == "changed plans"
    assert det["refund"] == {"amount": 2000.0, "status": "owed", "paid_at": None, "reference": None}
    assert det["advance_required"] == 2000.0 and det["completion"] is None
    kinds = [e["kind"] for e in det["timeline"]]
    assert "refund_owed" in kinds and "cancelled" in kinds and kinds[0] in ("created", "held")

    wait = (await client.get(f"/api/v1/owners/bookings/{s['b1'].id}/overview-detail", headers=headers)).json()
    assert wait["row"]["status_key"] == "awaiting_approval" and wait["hold_expires_at"] is None
    assert wait["approval"]["verdict"] is None  # a proof is waiting for review

    # another owner can't read it
    other = await make_user("+923008899999", role=UserRole.OWNER)
    forbidden = await client.get(
        f"/api/v1/owners/bookings/{s['b4'].id}/overview-detail", headers=await make_auth_headers(other)
    )
    assert forbidden.status_code == 403
    assert (await client.get(f"/api/v1/owners/bookings/{uuid.uuid4()}/overview-detail", headers=headers)).status_code == 404


async def test_staff_permissions_on_reads(seed, make_auth_headers, client, db_session_factory, make_user):
    owner, venue, (a, b) = await seed("+923008800008")
    d = past_day()
    s = await _scenario(db_session_factory, a, b, d)
    owner_headers = await make_auth_headers(owner)

    async def load_user(uid):
        async with db_session_factory() as session:
            return await session.get(User, uid)

    _u1, no_ledger = await make_staff(client, owner_headers, venue, "+923008800101", ["check_in"], load_user, make_auth_headers)
    _u2, with_ledger = await make_staff(client, owner_headers, venue, "+923008800102", ["view_ledger"], load_user, make_auth_headers)
    day = {"date": d.isoformat()}
    for url, params in ((OV, day), (HIST, {"date_from": d.isoformat(), "date_to": d.isoformat()}), ("/api/v1/owners/badges", {})):
        assert (await client.get(url, params=params, headers=no_ledger)).status_code == 403, url
        assert (await client.get(url, params=params, headers=with_ledger)).status_code == 200, url
    det = f"/api/v1/owners/bookings/{s['a1'].id}/overview-detail"
    assert (await client.get(det, headers=no_ledger)).status_code == 403
    assert (await client.get(det, headers=with_ledger)).status_code == 200
    # a staff member with view_ledger sees the phone (owner/staff with the permission only; players never reach this)
    row = next(r for r in (await client.get(OV, params=day, headers=with_ledger)).json()["rows"] if r["booking_id"] == str(s["a1"].id))
    assert row["player_phone"] == "+923001110001"
    # players cannot use any of it
    player = await make_user("+923008800110")
    assert (await client.get(OV, params=day, headers=await make_auth_headers(player))).status_code == 403


async def test_approvals_and_refunds_filters_and_badges(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (a, b) = await seed("+923008800009")
    d = past_day()
    s = await _scenario(db_session_factory, a, b, d)
    d2 = d - timedelta(days=1)
    other_day = await add_booking(
        db_session_factory, b, at(d2, 11), 1, status=BookingStatus.PAYMENT_SUBMITTED, price=1000, name="Other day", unreviewed_payment=True
    )
    refund2 = await add_booking(
        db_session_factory, a, at(d2, 16), 1, status=BookingStatus.CANCELLED, price=900, paid=900, name="R2", cancelled_by=CancelledBy.PLAYER
    )
    await add_dispute(db_session_factory, refund2, 900)
    headers = await make_auth_headers(owner)

    everything = (await client.get("/api/v1/owners/pending-approvals", headers=headers)).json()
    assert {x["booking_id"] for x in everything} == {str(s["b1"].id), str(other_day.id)}  # unchanged without filters
    on_d = (await client.get("/api/v1/owners/pending-approvals", params={"date": d.isoformat()}, headers=headers)).json()
    assert [x["booking_id"] for x in on_d] == [str(s["b1"].id)]
    assert (await client.get("/api/v1/owners/pending-approvals", params={"date": d.isoformat(), "court_ids": str(a.id)}, headers=headers)).json() == []
    one = (await client.get("/api/v1/owners/pending-approvals", params={"booking_id": str(other_day.id)}, headers=headers)).json()
    assert [x["booking_id"] for x in one] == [str(other_day.id)]
    # the Overview Pending card and the Approvals page behind it agree for the same date
    ov = (await client.get(OV, params={"date": d.isoformat()}, headers=headers)).json()
    assert ov["bookings"]["pending"]["awaiting_approval"] == len(on_d)

    refunds_all = (await client.get("/api/v1/owners/refunds", headers=headers)).json()
    assert {x["booking_id"] for x in refunds_all} == {str(s["b4"].id), str(refund2.id)}
    refunds_d = (await client.get("/api/v1/owners/refunds", params={"date": d.isoformat()}, headers=headers)).json()
    assert [x["booking_id"] for x in refunds_d] == [str(s["b4"].id)]
    assert ov["bookings"]["refunds"]["count"] == len(refunds_d)

    badges = (await client.get("/api/v1/owners/badges", headers=headers)).json()
    assert badges == {"approvals": len(everything), "refunds": len(refunds_all)} == {"approvals": 2, "refunds": 2}


async def test_overview_query_count_is_fixed(seed, make_auth_headers, client, db_session_factory, make_court, make_schedule, make_pricing_rule, test_engine):
    owner, venue, (a, b) = await seed("+923008800010")
    d = past_day()
    await _scenario(db_session_factory, a, b, d)
    headers = await make_auth_headers(owner)
    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    async def run(url, params):
        statements.clear()
        event.listen(test_engine.sync_engine, "before_cursor_execute", count)
        try:
            resp = await client.get(url, params=params, headers=headers)
        finally:
            event.remove(test_engine.sync_engine, "before_cursor_execute", count)
        assert resp.status_code == 200, resp.text
        return len(statements)

    ov_params = {"date": d.isoformat()}
    hist_params = {"date_from": d.isoformat(), "date_to": d.isoformat(), "page_size": 100}
    ov_before = await run(OV, ov_params)
    hist_before = await run(HIST, hist_params)
    det_id = (await client.get(HIST, params=hist_params, headers=headers)).json()["items"][0]["booking_id"]
    det_before = await run(f"/api/v1/owners/bookings/{det_id}/overview-detail", {})

    # many more courts and bookings on the same day
    for i in range(6):
        court = await make_court(venue, name=f"Extra {i}")
        for day in range(7):
            await make_schedule(court, day_of_week=day, open_time=time(10, 0), close_time=time(22, 0))
        await make_pricing_rule(court, price_per_slot=1000)
        for h in range(10, 20, 2):
            await add_booking(db_session_factory, court, at(d, h), 1, price=1000, paid=1000, name=f"P{i}{h}")
        await add_booking(db_session_factory, court, at(d, 20), 1, status=BookingStatus.HELD, price=1000)
        cancelled = await add_booking(
            db_session_factory, court, at(d, 21), 1, status=BookingStatus.CANCELLED, price=1000, paid=1000, cancelled_by=CancelledBy.PLAYER
        )
        await add_dispute(db_session_factory, cancelled, 1000)

    assert await run(OV, ov_params) == ov_before
    assert await run(HIST, hist_params) == hist_before
    assert await run(f"/api/v1/owners/bookings/{det_id}/overview-detail", {}) == det_before
    big = (await client.get(OV, params=ov_params, headers=headers)).json()
    assert len(big["slots"]["by_court"]) == 8 and big["slots"]["total"] == 8 * 24
