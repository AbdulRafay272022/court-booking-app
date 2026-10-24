"""Floodlight VenueCard contract (docs/venue-card-contract.md): the list endpoints the shared VenueCard is fed from
(GET /venues and GET /users/me/favorites) carry EVERY venue photo, in the owner's order (index 0 = cover), and the
venue's amenities. No code change was needed for this; the test pins the contract so a later edit cannot quietly
drop photos to a single cover or lose the amenity list."""
from app.models.user import UserRole

KEYS = ["venues/a-cover.jpg", "venues/b.jpg", "venues/c.jpg"]


async def test_search_list_returns_all_photos_in_order_and_amenities(client, make_user, make_venue, make_court, make_pricing_rule):
    owner = await make_user("+923008200003", role=UserRole.OWNER)
    venue = await make_venue(owner, name="Gallery Arena", photos=KEYS, amenities=["floodlights", "parking", "cafe"])
    court = await make_court(venue)
    await make_pricing_rule(court, price_per_slot=2000)
    bare = await make_venue(owner, name="Bare Arena", photos=None, amenities=None)
    await make_pricing_rule(await make_court(bare), price_per_slot=2000)

    resp = await client.get("/api/v1/venues", params={"city": "Karachi"})
    assert resp.status_code == 200
    by_name = {v["name"]: v for v in resp.json()["venues"]}

    card = by_name["Gallery Arena"]
    assert len(card["photo_urls"]) == 3
    assert [u.rsplit("/", 1)[-1] for u in card["photo_urls"]] == ["a-cover.jpg", "b.jpg", "c.jpg"]
    assert card["amenities"] == ["floodlights", "parking", "cafe"]

    # no photos / no amenities => empty lists (never null), so the card shows its placeholder and hides the chip
    assert by_name["Bare Arena"]["photo_urls"] == []
    assert by_name["Bare Arena"]["amenities"] == []


async def test_favorites_cards_carry_the_same_photos_and_amenities(client, make_user, make_venue, make_court, make_pricing_rule, make_auth_headers):
    owner = await make_user("+923008200001", role=UserRole.OWNER)
    player = await make_user("+923008200002", role=UserRole.PLAYER)
    venue = await make_venue(owner, name="Saved Arena", photos=KEYS, amenities=["washrooms"])
    await make_pricing_rule(await make_court(venue), price_per_slot=1500)
    headers = await make_auth_headers(player)
    assert (await client.put(f"/api/v1/venues/{venue.id}/favorite", headers=headers)).status_code == 204

    items = (await client.get("/api/v1/users/me/favorites", headers=headers)).json()
    assert [u.rsplit("/", 1)[-1] for u in items[0]["photo_urls"]] == ["a-cover.jpg", "b.jpg", "c.jpg"]
    assert items[0]["amenities"] == ["washrooms"]

    search = (await client.get("/api/v1/venues", params={"city": "Karachi"})).json()["venues"]
    assert search[0]["photo_urls"] == items[0]["photo_urls"]
