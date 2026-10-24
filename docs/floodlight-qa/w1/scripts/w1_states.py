"""W1: fresh slot/booking states on the LAHORE QA venue (local API only). Holds last ~15 min, so run right before Playwright."""
import io, json, struct, sys, zlib
from datetime import datetime, timedelta, timezone
import httpx

B = "http://localhost:8000/api/v1"
assert B.startswith("http://localhost")
PW = "demo-password-123"
PKT = timezone(timedelta(hours=5))
c = httpx.Client(timeout=60, headers={"X-Slot-Grid": "30"})
seed = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
DAY = int(sys.argv[3]) if len(sys.argv) > 3 else 1


def login(phone):
    r = c.post(f"{B}/auth/login", json={"phone": phone, "password": PW, "platform": "web"})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def png(w=300, h=500):
    raw = b"".join(b"\x00" + bytes([200, 220, 240] * w) for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def at(day, hour, minute=0):
    d = datetime.now(PKT).date() + timedelta(days=day)
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=PKT).astimezone(timezone.utc).isoformat()


def hold(h, court, hour, slots=2):
    r = c.post(f"{B}/bookings/hold", headers=h, json={"court_id": court, "starts_at": at(DAY, hour), "slot_count": slots, "name_is_own": True})
    if r.status_code >= 400:
        print("hold", hour, r.status_code, r.text[:200]); return None, None
    j = r.json()
    return j["booking"]["id"], j.get("payment_instructions")


def proof(h, bid):
    r = c.post(f"{B}/bookings/{bid}/payment-proof", headers=h, files={"image": ("proof.png", png(), "image/png")})
    if r.status_code >= 400:
        print("proof", r.status_code, r.text[:200])


def approve(owner, bid):
    ps = c.get(f"{B}/bookings/{bid}/payments", headers=owner).json()
    ps = ps if isinstance(ps, list) else ps.get("items", [])
    for p in ps:
        r = c.post(f"{B}/payments/{p['id']}/approve", headers=owner, json={"confirm_duplicate": True})
        print("approve", r.status_code, r.text[:100] if r.status_code >= 400 else "")


owner = login(seed["owner_phone"])
player = login("+923000000003")
other = login("+923000000014")
other2 = login("+923000000010")
gul = [v for v in seed["venues"] if v["name"] == "Gulberg Padel Club"][0]
courts = c.get(f"{B}/venues/{gul['id']}/courts", headers=owner).json()
courts = courts if isinstance(courts, list) else courts.get("courts", courts.get("items"))
court = [x for x in courts if x["name"] == "Court 1"][0]["id"]
out = {"venue_slug": gul.get("slug"), "court_id": court, "day": DAY, "date": (datetime.now(PKT).date() + timedelta(days=DAY)).isoformat()}

# blocked 10:00-11:00 (blackout)
r = c.post(f"{B}/courts/{court}/blackouts", headers=owner, json={"title": "Maintenance", "starts_at": at(DAY, 10), "ends_at": at(DAY, 11), "reason": "maintenance"})
print("blackout", r.status_code, r.text[:120] if r.status_code >= 400 else "")
out["other_held"], _ = hold(other, court, 18)
b, _ = hold(other, court, 19); proof(other, b); out["other_submitted"] = b
b, _ = hold(other2, court, 12); proof(other2, b); approve(owner, b); out["other_booked"] = b
out["mine_held"], out["mine_held_pi"] = hold(player, court, 20)
b, _ = hold(player, court, 21); proof(player, b); out["mine_submitted"] = b
b, _ = hold(player, court, 15); proof(player, b); approve(owner, b); out["mine_booked"] = b
for k in ("other_held", "other_submitted", "other_booked", "mine_held", "mine_submitted", "mine_booked"):
    if out.get(k):
        print(k, c.get(f"{B}/bookings/{out[k]}", headers=player if k.startswith("mine") else owner).json().get("status"))
json.dump(out, open(OUT, "w"), indent=1)
