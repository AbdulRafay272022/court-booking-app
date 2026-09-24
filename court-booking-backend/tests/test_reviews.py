"""Section 32 Part 6 -- reviews flow: create (completed booking only, one per booking),
7-day edit window, owner reply, admin hide (+ its effect on the public list and the
average/count aggregate)."""
from datetime import datetime, timedelta, timezone

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.review import Review
from app.models.user import UserRole


async def _completed_booking(db_session_factory, court, player, *, hours_ago: int = 2) -> Booking:
    start = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    async with db_session_factory() as s:
        booking = Booking(
            court_id=court.id, player_id=player.id, player_name=player.name,
            starts_at=start, ends_at=start + timedelta(hours=1),
            status=BookingStatus.COMPLETED, source=BookingSource.APP,
            price=3000, amount_paid=3000, balance_due=0,
        )
        s.add(booking)
        await s.commit()
        await s.refresh(booking)
        return booking


async def _setup(make_user, make_venue, make_court, phones):
    owner = await make_user(phones[0], role=UserRole.OWNER, name="Owner Person")
    player = await make_user(phones[1], role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(owner)
    court = await make_court(venue)
    return owner, player, venue, court


async def test_create_review_requires_a_completed_booking(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000001", "+923061000002"))
    booking = await _completed_booking(db_session_factory, court, player)
    # flip it back to a live status so it's not reviewable
    async with db_session_factory() as s:
        b = await s.get(Booking, booking.id)
        b.status = BookingStatus.BOOKED
        await s.commit()
    headers = await make_auth_headers(player)
    resp = await client.post("/api/v1/reviews", headers=headers, json={"booking_id": str(booking.id), "rating": 5})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "REVIEW_NOT_ALLOWED"


async def test_create_list_and_one_per_booking(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000003", "+923061000004"))
    booking = await _completed_booking(db_session_factory, court, player)
    headers = await make_auth_headers(player)

    resp = await client.post(
        "/api/v1/reviews", headers=headers, json={"booking_id": str(booking.id), "rating": 4, "comment": "Great court"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["rating"] == 4 and body["player_first_name"] == "Ali"  # first name only

    dup = await client.post("/api/v1/reviews", headers=headers, json={"booking_id": str(booking.id), "rating": 3})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ALREADY_REVIEWED"

    listed = await client.get(f"/api/v1/venues/{venue.id}/reviews")
    assert listed.status_code == 200
    assert [r["comment"] for r in listed.json()] == ["Great court"]


async def test_owner_cannot_review_a_players_booking(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000005", "+923061000006"))
    booking = await _completed_booking(db_session_factory, court, player)
    owner_headers = await make_auth_headers(owner)  # owner can access the booking, but isn't the player
    resp = await client.post("/api/v1/reviews", headers=owner_headers, json={"booking_id": str(booking.id), "rating": 5})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "REVIEW_NOT_ALLOWED"


async def test_edit_within_window_then_locked_after_7_days(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000007", "+923061000008"))
    booking = await _completed_booking(db_session_factory, court, player)
    headers = await make_auth_headers(player)
    created = await client.post("/api/v1/reviews", headers=headers, json={"booking_id": str(booking.id), "rating": 2})
    review_id = created.json()["id"]

    edited = await client.patch(f"/api/v1/reviews/{review_id}", headers=headers, json={"rating": 5, "comment": "Fixed"})
    assert edited.status_code == 200
    assert edited.json()["rating"] == 5 and edited.json()["updated_at"] is not None

    # age the review past the 7-day window
    async with db_session_factory() as s:
        r = await s.get(Review, review_id)
        r.created_at = datetime.now(timezone.utc) - timedelta(days=8)
        await s.commit()
    late = await client.patch(f"/api/v1/reviews/{review_id}", headers=headers, json={"rating": 1})
    assert late.status_code == 403 and late.json()["error"]["code"] == "REVIEW_EDIT_WINDOW_CLOSED"


async def test_owner_reply_only_by_the_venue_owner(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000009", "+923061000010"))
    other_owner = await make_user("+923061000011", role=UserRole.OWNER, name="Other Owner")
    booking = await _completed_booking(db_session_factory, court, player)
    review_id = (await client.post(
        "/api/v1/reviews", headers=await make_auth_headers(player), json={"booking_id": str(booking.id), "rating": 5}
    )).json()["id"]

    bad = await client.post(
        f"/api/v1/reviews/{review_id}/reply", headers=await make_auth_headers(other_owner), json={"owner_reply": "hi"}
    )
    assert bad.status_code in (403, 404)

    ok = await client.post(
        f"/api/v1/reviews/{review_id}/reply", headers=await make_auth_headers(owner), json={"owner_reply": "Thanks!"}
    )
    assert ok.status_code == 200
    assert ok.json()["owner_reply"] == "Thanks!" and ok.json()["owner_replied_at"] is not None


async def test_admin_hide_removes_from_public_list_and_rating(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000012", "+923061000013"))
    admin = await make_user("+923061000014", role=UserRole.ADMIN, name="Admin")
    b1 = await _completed_booking(db_session_factory, court, player, hours_ago=3)
    b2 = await _completed_booking(db_session_factory, court, player, hours_ago=2)
    p_headers = await make_auth_headers(player)
    r1 = (await client.post("/api/v1/reviews", headers=p_headers, json={"booking_id": str(b1.id), "rating": 2})).json()["id"]
    await client.post("/api/v1/reviews", headers=p_headers, json={"booking_id": str(b2.id), "rating": 4})

    # both visible: avg 3.0, count 2
    v = (await client.get(f"/api/v1/venues/{venue.id}")).json()
    assert v["review_count"] == 2 and v["average_rating"] == 3.0

    admin_headers = await make_auth_headers(admin)
    hide = await client.post(f"/api/v1/admin/reviews/{r1}/hide", headers=admin_headers)
    assert hide.status_code == 200 and hide.json()["is_hidden"] is True

    # public list now shows only the 4-star; rating recomputes to 4.0 / count 1
    public = (await client.get(f"/api/v1/venues/{venue.id}/reviews")).json()
    assert len(public) == 1 and public[0]["rating"] == 4
    v2 = (await client.get(f"/api/v1/venues/{venue.id}")).json()
    assert v2["review_count"] == 1 and v2["average_rating"] == 4.0

    # an admin still sees the hidden one (to unhide)
    admin_view = (await client.get(f"/api/v1/venues/{venue.id}/reviews", headers=admin_headers)).json()
    assert len(admin_view) == 2

    unhide = await client.post(f"/api/v1/admin/reviews/{r1}/unhide", headers=admin_headers)
    assert unhide.status_code == 200 and unhide.json()["is_hidden"] is False
    v3 = (await client.get(f"/api/v1/venues/{venue.id}")).json()
    assert v3["review_count"] == 2


async def test_hide_requires_admin(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, player, venue, court = await _setup(make_user, make_venue, make_court, ("+923061000015", "+923061000016"))
    booking = await _completed_booking(db_session_factory, court, player)
    review_id = (await client.post(
        "/api/v1/reviews", headers=await make_auth_headers(player), json={"booking_id": str(booking.id), "rating": 5}
    )).json()["id"]
    resp = await client.post(f"/api/v1/admin/reviews/{review_id}/hide", headers=await make_auth_headers(player))
    assert resp.status_code == 403
