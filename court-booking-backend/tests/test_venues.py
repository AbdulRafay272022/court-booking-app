from app.models.user import UserRole
from app.models.venue import VenueStatus


def _venue_payload(**overrides):
    payload = {
        "name": "Ace Padel Club",
        "address": "1 Court Lane",
        "city": "Lahore",
        "latitude": 31.5204,
        "longitude": 74.3587,
        "sports": ["padel"],
        "amenities": ["parking", "cafe"],
    }
    payload.update(overrides)
    return payload


async def test_owner_can_create_venue(client, make_user, make_auth_headers):
    owner = await make_user("+923001000001", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)

    resp = await client.post("/api/v1/venues", headers=headers, json=_venue_payload())
    assert resp.status_code == 201
    venue = resp.json()["venue"]
    assert venue["name"] == "Ace Padel Club"
    assert venue["status"] == VenueStatus.PENDING.value
    assert venue["slug"] == "ace-padel-club"


async def test_customer_cannot_create_venue(client, make_user, make_auth_headers):
    customer = await make_user("+923001000002", role=UserRole.PLAYER)
    headers = await make_auth_headers(customer)

    resp = await client.post("/api/v1/venues", headers=headers, json=_venue_payload())
    assert resp.status_code == 403


async def test_venue_creation_missing_fields_rejected(client, make_user, make_auth_headers):
    owner = await make_user("+923001000003", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)

    resp = await client.post("/api/v1/venues", headers=headers, json={"name": "Incomplete"})
    assert resp.status_code == 422


async def test_slug_collision_gets_numeric_suffix(client, make_user, make_auth_headers):
    owner = await make_user("+923001000004", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)

    first = await client.post(
        "/api/v1/venues", headers=headers, json=_venue_payload(name="DHA Sports Complex")
    )
    second = await client.post(
        "/api/v1/venues", headers=headers, json=_venue_payload(name="DHA Sports Complex")
    )
    assert first.json()["venue"]["slug"] == "dha-sports-complex"
    assert second.json()["venue"]["slug"] == "dha-sports-complex-2"


async def test_list_venues_only_returns_approved_by_default(client, make_user, make_venue):
    owner = await make_user("+923001000005", role=UserRole.OWNER)
    await make_venue(owner, status=VenueStatus.APPROVED, name="Approved Club")
    await make_venue(owner, status=VenueStatus.PENDING, name="Pending Club")

    resp = await client.get("/api/v1/venues")
    assert resp.status_code == 200
    body = resp.json()
    names = {v["name"] for v in body["venues"]}
    assert "Approved Club" in names
    assert "Pending Club" not in names
    assert body["total"] == 1
    assert body["page"] == 1


async def test_sport_filter(client, make_user, make_venue):
    owner = await make_user("+923001000006", role=UserRole.OWNER)
    await make_venue(owner, name="Padel Only", sports=["padel"])
    await make_venue(owner, name="Cricket Only", sports=["cricket"])

    resp = await client.get("/api/v1/venues", params={"sport": "padel"})
    names = {v["name"] for v in resp.json()["venues"]}
    assert names == {"Padel Only"}


async def test_sport_filter_is_case_insensitive(client, make_user, make_venue):
    """Post-batch backlog #3: venues store a sport as the owner cased it ("Padel"),
    but the apps filter with a lowercased value ("padel"). The search must still find
    the venue -- a case-sensitive match silently showed players a "no courts" empty
    state for a live venue (reproduced on production: /venues?sport=padel -> 0)."""
    owner = await make_user("+923001000066", role=UserRole.OWNER)
    await make_venue(owner, name="Capital Padel", sports=["Padel"])  # stored capitalized, like prod

    for q in ("padel", "Padel", "PADEL"):
        resp = await client.get("/api/v1/venues", params={"sport": q})
        names = {v["name"] for v in resp.json()["venues"]}
        assert "Capital Padel" in names, f"sport={q!r} should match the 'Padel' venue, got {names}"


async def test_geo_search_radius_and_distance(client, make_user, make_venue):
    owner = await make_user("+923001000007", role=UserRole.OWNER)
    # DHA Phase 6 (near), Clifton (~5.6km away), a venue in Islamabad (~1100km away)
    await make_venue(
        owner, name="Near Venue", location="SRID=4326;POINT(67.0311 24.8607)"
    )
    await make_venue(
        owner, name="Mid Venue", location="SRID=4326;POINT(67.0099 24.8138)"
    )
    await make_venue(
        owner, name="Far Venue", location="SRID=4326;POINT(73.0479 33.6844)"
    )

    resp = await client.get(
        "/api/v1/venues", params={"lat": 24.8607, "lng": 67.0311, "radius_km": 10}
    )
    body = resp.json()
    names = [v["name"] for v in body["venues"]]
    assert names == ["Near Venue", "Mid Venue"]
    assert body["venues"][0]["distance_meters"] < 100
    assert 5000 < body["venues"][1]["distance_meters"] < 6200


async def test_owner_cannot_update_others_venue(client, make_user, make_venue, make_auth_headers):
    owner_a = await make_user("+923001000008", role=UserRole.OWNER)
    owner_b = await make_user("+923001000009", role=UserRole.OWNER)
    venue = await make_venue(owner_a)
    headers_b = await make_auth_headers(owner_b)

    resp = await client.patch(
        f"/api/v1/venues/{venue.id}", headers=headers_b, json={"name": "Hijacked"}
    )
    assert resp.status_code == 403


async def test_get_venue_by_slug_includes_today_availability(client, make_user, make_venue):
    owner = await make_user("+923001000010", role=UserRole.OWNER)
    venue = await make_venue(owner, slug="unique-test-slug")

    resp = await client.get(f"/api/v1/venues/by-slug/{venue.slug}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(venue.id)
    assert body["available_slots_today"] == 0  # no courts yet


async def test_bank_details_encrypted_and_visible_only_to_owner(
    client, make_user, make_auth_headers
):
    owner = await make_user("+923001000011", role=UserRole.OWNER)
    other_owner = await make_user("+923001000012", role=UserRole.OWNER)
    admin = await make_user("+923001000013", role=UserRole.ADMIN)
    headers = await make_auth_headers(owner)

    payload = _venue_payload(
        name="Bank Details Venue",
        bank_details={
            "bank": "HBL",
            "account_title": "Ace Padel",
            "account_number": "1234567890",
            "iban": "PK00HABB0000001234567890",
        },
    )
    created = await client.post("/api/v1/venues", headers=headers, json=payload)
    venue_id = created.json()["venue"]["id"]
    # Owner sees it decrypted right away, on the create response.
    assert created.json()["venue"]["bank_details"]["account_number"] == "1234567890"

    owner_read = await client.get(f"/api/v1/venues/{venue_id}", headers=headers)
    assert owner_read.json()["bank_details"]["bank"] == "HBL"

    admin_headers = await make_auth_headers(admin)
    admin_read = await client.get(f"/api/v1/venues/{venue_id}", headers=admin_headers)
    assert admin_read.json()["bank_details"]["bank"] == "HBL"

    other_headers = await make_auth_headers(other_owner)
    other_read = await client.get(f"/api/v1/venues/{venue_id}", headers=other_headers)
    assert other_read.json()["bank_details"] is None

    public_read = await client.get(f"/api/v1/venues/{venue_id}")
    assert public_read.json()["bank_details"] is None
