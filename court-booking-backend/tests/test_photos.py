"""Section 32 Part 6 -- venue & court photo management: upload (with type/size/count
limits), and reorder/delete/set-cover via the PUT-ordered-keys endpoint."""
from app.models.user import UserRole


def _mock_public_upload(monkeypatch):
    """Return a deterministic-ish fake S3 key per call; both the venue service and the
    court router import upload_public_photo, so patch both bind points."""
    counter = {"n": 0}

    async def fake_upload(data, filename, content_type, *, prefix="venues"):
        counter["n"] += 1
        return f"{prefix}/key-{counter['n']}.jpg"

    monkeypatch.setattr("app.services.venue_service.upload_public_photo", fake_upload)
    monkeypatch.setattr("app.api.courts.upload_public_photo", fake_upload)


def _png():
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 100, 50)).save(buf, format="PNG")
    return buf.getvalue()


async def test_upload_reorder_delete_venue_photos(
    client, make_user, make_venue, make_auth_headers, monkeypatch
):
    _mock_public_upload(monkeypatch)
    owner = await make_user("+923062000001", role=UserRole.OWNER, name="Owner")
    venue = await make_venue(owner)
    headers = await make_auth_headers(owner)

    keys = []
    for _ in range(3):
        resp = await client.post(
            f"/api/v1/venues/{venue.id}/photos", headers=headers,
            files={"file": ("p.png", _png(), "image/png")},
        )
        assert resp.status_code == 200, resp.text
    urls = resp.json()["photo_urls"]
    assert len(urls) == 3

    # reorder: reverse; the first becomes the cover
    reordered = await client.put(
        f"/api/v1/venues/{venue.id}/photos", headers=headers,
        json={"photos": ["venues/key-3.jpg", "venues/key-1.jpg", "venues/key-2.jpg"]},
    )
    assert reordered.status_code == 200
    assert reordered.json()["photo_urls"][0].endswith("key-3.jpg")

    # delete one by omitting it
    deleted = await client.put(
        f"/api/v1/venues/{venue.id}/photos", headers=headers,
        json={"photos": ["venues/key-3.jpg", "venues/key-1.jpg"]},
    )
    assert len(deleted.json()["photo_urls"]) == 2

    # can't inject a foreign key
    bad = await client.put(
        f"/api/v1/venues/{venue.id}/photos", headers=headers,
        json={"photos": ["venues/not-mine.jpg"]},
    )
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "INVALID_PHOTO"


async def test_venue_photo_count_limit(client, make_user, make_venue, make_auth_headers, monkeypatch):
    _mock_public_upload(monkeypatch)
    owner = await make_user("+923062000002", role=UserRole.OWNER, name="Owner")
    venue = await make_venue(owner)
    headers = await make_auth_headers(owner)
    last = None
    for _ in range(9):  # limit is 8
        last = await client.post(
            f"/api/v1/venues/{venue.id}/photos", headers=headers, files={"file": ("p.png", _png(), "image/png")}
        )
    assert last.status_code == 400 and last.json()["error"]["code"] == "PHOTO_LIMIT_REACHED"


async def test_bad_photo_type_rejected(client, make_user, make_venue, make_auth_headers, monkeypatch):
    _mock_public_upload(monkeypatch)
    owner = await make_user("+923062000003", role=UserRole.OWNER, name="Owner")
    venue = await make_venue(owner)
    headers = await make_auth_headers(owner)
    resp = await client.post(
        f"/api/v1/venues/{venue.id}/photos", headers=headers, files={"file": ("p.gif", b"GIF89a", "image/gif")}
    )
    assert resp.status_code == 400


async def test_only_owner_can_upload(client, make_user, make_venue, make_auth_headers, monkeypatch):
    _mock_public_upload(monkeypatch)
    owner = await make_user("+923062000004", role=UserRole.OWNER, name="Owner")
    other = await make_user("+923062000005", role=UserRole.OWNER, name="Other")
    venue = await make_venue(owner)
    resp = await client.post(
        f"/api/v1/venues/{venue.id}/photos", headers=await make_auth_headers(other),
        files={"file": ("p.png", _png(), "image/png")},
    )
    assert resp.status_code in (403, 404)


async def test_court_photos_upload_and_reorder(
    client, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    _mock_public_upload(monkeypatch)
    owner = await make_user("+923062000006", role=UserRole.OWNER, name="Owner")
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    r = None
    for _ in range(2):
        r = await client.post(
            f"/api/v1/courts/{court.id}/photos", headers=headers, files={"file": ("p.png", _png(), "image/png")}
        )
        assert r.status_code == 200, r.text
    assert len(r.json()["photo_urls"]) == 2

    reordered = await client.put(
        f"/api/v1/courts/{court.id}/photos", headers=headers,
        json={"photos": ["courts/key-2.jpg", "courts/key-1.jpg"]},
    )
    assert reordered.status_code == 200
    assert reordered.json()["photo_urls"][0].endswith("key-2.jpg")


async def test_court_photo_count_limit(
    client, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    _mock_public_upload(monkeypatch)
    owner = await make_user("+923062000007", role=UserRole.OWNER, name="Owner")
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)
    last = None
    for _ in range(6):  # limit is 5
        last = await client.post(
            f"/api/v1/courts/{court.id}/photos", headers=headers, files={"file": ("p.png", _png(), "image/png")}
        )
    assert last.status_code == 400 and last.json()["error"]["code"] == "PHOTO_LIMIT_REACHED"
