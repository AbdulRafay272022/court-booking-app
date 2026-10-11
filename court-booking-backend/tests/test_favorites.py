"""Favorites: a player saves venues; GET /users/me/favorites, PUT/DELETE /venues/{id}/favorite."""
import uuid

from sqlalchemy import func, select

from app.models.favorite import FavoriteVenue
from app.models.user import UserRole
from app.models.venue import Venue, VenueStatus

LIST = "/api/v1/users/me/favorites"


def fav(venue_id) -> str:
    return f"/api/v1/venues/{venue_id}/favorite"


async def _setup(make_user, make_venue):
    owner = await make_user("+923008100001", role=UserRole.OWNER)
    player = await make_user("+923008100002", role=UserRole.PLAYER)
    return owner, player


async def test_save_list_and_unsave(client, make_user, make_venue, make_court, make_pricing_rule, make_auth_headers):
    owner, player = await _setup(make_user, make_venue)
    venue = await make_venue(owner, name="Alpha Arena", amenities=["parking", "floodlights"])
    court = await make_court(venue)
    await make_pricing_rule(court, price_per_slot=2500)
    headers = await make_auth_headers(player)

    assert (await client.get(LIST, headers=headers)).json() == []
    assert (await client.put(fav(venue.id), headers=headers)).status_code == 204

    items = (await client.get(LIST, headers=headers)).json()
    assert [i["name"] for i in items] == ["Alpha Arena"]
    # the same card shape the search page uses (amenities, price, rating fields)
    assert items[0]["amenities"] == ["parking", "floodlights"]
    assert items[0]["min_price"] is not None
    assert {"slug", "sports", "photo_urls", "average_rating", "review_count"} <= set(items[0])

    assert (await client.delete(fav(venue.id), headers=headers)).status_code == 204
    assert (await client.get(LIST, headers=headers)).json() == []


async def test_most_recently_saved_comes_first(client, make_user, make_venue, make_auth_headers):
    owner, player = await _setup(make_user, make_venue)
    first = await make_venue(owner, name="First")
    second = await make_venue(owner, name="Second")
    headers = await make_auth_headers(player)

    await client.put(fav(first.id), headers=headers)
    await client.put(fav(second.id), headers=headers)

    assert [i["name"] for i in (await client.get(LIST, headers=headers)).json()] == ["Second", "First"]


async def test_saving_and_unsaving_are_idempotent(client, make_user, make_venue, make_auth_headers, db_session_factory):
    owner, player = await _setup(make_user, make_venue)
    venue = await make_venue(owner)
    headers = await make_auth_headers(player)

    for _ in range(3):
        assert (await client.put(fav(venue.id), headers=headers)).status_code == 204
    async with db_session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(FavoriteVenue)) == 1

    for _ in range(3):
        assert (await client.delete(fav(venue.id), headers=headers)).status_code == 204
    # un-saving a venue that was never saved is fine too
    assert (await client.delete(fav(uuid.uuid4()), headers=headers)).status_code == 204


async def test_all_three_endpoints_need_a_signed_in_user(client, make_user, make_venue):
    owner, _player = await _setup(make_user, make_venue)
    venue = await make_venue(owner)

    for resp in (await client.get(LIST), await client.put(fav(venue.id)), await client.delete(fav(venue.id))):
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "NOT_AUTHENTICATED"


async def test_only_live_venues_can_be_saved(client, make_user, make_venue, make_auth_headers, db_session_factory):
    owner, player = await _setup(make_user, make_venue)
    pending = await make_venue(owner, name="Pending", status=VenueStatus.PENDING)
    inactive = await make_venue(owner, name="Closed")
    async with db_session_factory() as s:
        (await s.get(Venue, inactive.id)).is_active = False
        await s.commit()
    headers = await make_auth_headers(player)

    for vid in (uuid.uuid4(), pending.id, inactive.id):
        resp = await client.put(fav(vid), headers=headers)
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "VENUE_NOT_FOUND"
    assert (await client.get(LIST, headers=headers)).json() == []


async def test_favorites_are_private_to_each_user(client, make_user, make_venue, make_auth_headers):
    owner, player = await _setup(make_user, make_venue)
    other = await make_user("+923008100003", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    mine, theirs = await make_auth_headers(player), await make_auth_headers(other)

    await client.put(fav(venue.id), headers=mine)

    assert len((await client.get(LIST, headers=mine)).json()) == 1
    assert (await client.get(LIST, headers=theirs)).json() == []
    # one user un-saving does not touch another's
    await client.put(fav(venue.id), headers=theirs)
    await client.delete(fav(venue.id), headers=theirs)
    assert len((await client.get(LIST, headers=mine)).json()) == 1


async def test_a_venue_that_goes_offline_drops_out_of_the_list_and_returns_with_it(
    client, make_user, make_venue, make_auth_headers, db_session_factory
):
    owner, player = await _setup(make_user, make_venue)
    venue = await make_venue(owner, name="Flaky")
    headers = await make_auth_headers(player)
    await client.put(fav(venue.id), headers=headers)

    async def set_state(**kw):
        async with db_session_factory() as s:
            v = await s.get(Venue, venue.id)
            for k, val in kw.items():
                setattr(v, k, val)
            await s.commit()

    await set_state(status=VenueStatus.REJECTED)
    assert (await client.get(LIST, headers=headers)).json() == []
    # the stale heart can still be cleared, and the saved row survived until then
    async with db_session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(FavoriteVenue)) == 1

    await set_state(status=VenueStatus.APPROVED, is_active=False)
    assert (await client.get(LIST, headers=headers)).json() == []

    await set_state(is_active=True)
    assert [i["name"] for i in (await client.get(LIST, headers=headers)).json()] == ["Flaky"]


async def test_rows_go_with_the_venue_and_the_user(client, make_user, make_venue, make_auth_headers, db_session_factory):
    owner, player = await _setup(make_user, make_venue)
    venue = await make_venue(owner)
    headers = await make_auth_headers(player)
    await client.put(fav(venue.id), headers=headers)

    async with db_session_factory() as s:
        await s.delete(await s.get(Venue, venue.id))
        await s.commit()
        assert await s.scalar(select(func.count()).select_from(FavoriteVenue)) == 0


async def test_search_cards_and_favorites_use_the_same_shape(client, make_user, make_venue, make_auth_headers):
    owner, player = await _setup(make_user, make_venue)
    venue = await make_venue(owner, name="Same Shape", amenities=["washrooms"])
    headers = await make_auth_headers(player)
    await client.put(fav(venue.id), headers=headers)

    searched = next(v for v in (await client.get("/api/v1/venues")).json()["venues"] if v["name"] == "Same Shape")
    favorited = (await client.get(LIST, headers=headers)).json()[0]
    assert searched == favorited
