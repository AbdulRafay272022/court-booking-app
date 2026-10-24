"""W1 web QA seed: LOCAL API ONLY. A separate owner with 5 approved venues in LAHORE (so the Karachi data other agents use is
untouched), each with courts, a schedule, prices, amenities and 0..6 photos uploaded through the real owner endpoint."""
import io, json, random, sys
import httpx
from PIL import Image, ImageDraw, ImageFont

B = "http://localhost:8000/api/v1"
assert B.startswith("http://localhost")
PW = "demo-password-123"
OTP = "111111"
c = httpx.Client(timeout=60, headers={"X-Slot-Grid": "30"})
OUT = sys.argv[1]


def login(phone):
    r = c.post(f"{B}/auth/login", json={"phone": phone, "password": PW, "platform": "web"})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def signup(phone, name, email, role):
    r = c.post(f"{B}/auth/signup", json={"phone": phone, "name": name, "email": email, "city": "lahore", "gender": "male",
                                         "password": PW, "confirm_password": PW, "role": role, "terms_accepted": True})
    if r.status_code >= 400:
        print("signup", r.status_code, r.text[:120])
    r2 = c.post(f"{B}/auth/verify-signup-otp", json={"phone": phone, "otp": OTP})
    if r2.status_code >= 400:
        print("verify", r2.status_code, r2.text[:120])


PALETTE = [((14, 124, 116), (12, 31, 29)), ((255, 106, 43), (143, 48, 0)), ((61, 140, 90), (20, 60, 40)), ((40, 90, 160), (12, 31, 60)),
           ((180, 140, 60), (80, 50, 20)), ((120, 60, 140), (40, 20, 60))]


def photo(n, label):
    """A photo-like JPEG (gradient + court lines + a caption) so each slide is visibly different in screenshots."""
    w, h = 1200, 800
    a, b = PALETTE[n % len(PALETTE)]
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)))
    d.rectangle([150, 150, 1050, 650], outline=(255, 255, 255), width=8)
    d.line([600, 150, 600, 650], fill=(255, 255, 255), width=6)
    d.ellipse([520, 320, 680, 480], outline=(255, 255, 255), width=6)
    try:
        f = ImageFont.truetype("arial.ttf", 64)
    except OSError:
        f = ImageFont.load_default()
    d.text((180, 60), f"{label} - photo {n + 1}", fill=(255, 255, 255), font=f)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


admin = login("+923000000001")
signup("+923000000030", "W1 Lahore Owner", "w1.lahore.owner@example.com", "owner")
owner = login("+923000000030")

VENUES = [
    ("Gulberg Padel Club", "Gulberg", ["padel"], ["floodlights", "parking", "washrooms", "changing_room", "drinking_water", "cafe", "wifi"], 6),
    ("Model Town Futsal Arena", "Model Town", ["futsal"], ["floodlights", "parking"], 3),
    ("DHA Phase 5 Courts", "DHA", ["padel", "futsal"], ["washrooms", "seating", "prayer_area", "equipment_rent", "parking", "floodlights"], 2),
    ("Johar Town Cricket Nets", "Johar Town", ["cricket"], [], 1),
    ("Bahria Sports Hub", "Bahria Town", ["badminton"], ["parking", "washrooms", "cafe"], 0),
]

existing = {v["name"]: v for v in c.get(f"{B}/owners/venues", headers=owner).json()}
out = {"owner_phone": "+923000000030", "venues": []}
for i, (name, area, sports, amenities, nphotos) in enumerate(VENUES):
    if name in existing:
        v = existing[name]
    else:
        r = c.post(f"{B}/venues", headers=owner, json={
            "name": name, "address": f"Plot {10 + i}, Main Boulevard", "city": "Lahore", "area": area,
            "latitude": 31.5 + i * 0.01, "longitude": 74.33 + i * 0.01, "sports": sports, "amenities": amenities,
            "cancellation_allowed": i % 2 == 0, "cancellation_cutoff_hours": 24 if i == 0 else None,
        })
        if r.status_code >= 400:
            print("venue", r.status_code, r.text[:300]); continue
        v = r.json().get("venue") or r.json()
        for k, sport in enumerate(sports):
            rc = c.post(f"{B}/venues/{v['id']}/courts", headers=owner, json={"name": f"Court {k + 1}", "sport": sport, "slot_minutes": 60, "is_indoor": k == 1})
            if rc.status_code >= 400:
                print("court", rc.status_code, rc.text[:200]); continue
            court = rc.json().get("court") or rc.json()
            cid = court["id"]
            rs = c.post(f"{B}/courts/{cid}/schedule", headers=owner, json={"schedules": [{"day_of_week": d, "open_time": "08:00", "close_time": "23:00"} for d in range(7)]})
            if rs.status_code >= 400:
                print("schedule", rs.status_code, rs.text[:200])
            rp = c.post(f"{B}/courts/{cid}/pricing", headers=owner, json={"rules": [{"name": "Standard", "price_per_slot": 1500 + 250 * i, "advance_percentage": 50}]})
            if rp.status_code >= 400:
                print("pricing", rp.status_code, rp.text[:200])
        for n in range(nphotos):
            ru = c.post(f"{B}/venues/{v['id']}/photos", headers=owner, files={"file": (f"p{n}.jpg", photo(n, name.split()[0]), "image/jpeg")})
            if ru.status_code >= 400:
                print("photo", ru.status_code, ru.text[:200])
        ra = c.post(f"{B}/admin/venues/{v['id']}/approve", headers=admin)
        print("approve", name, ra.status_code, ra.text[:120] if ra.status_code >= 400 else "")
    out["venues"].append({"id": v["id"], "name": name})

lst = c.get(f"{B}/venues", params={"city": "Lahore", "per_page": 50}).json()
for v in lst["venues"]:
    print(v["slug"], len(v["photo_urls"]), v["amenities"], v["min_price"])
    for o in out["venues"]:
        if o["id"] == v["id"]:
            o["slug"] = v["slug"]
json.dump(out, open(OUT, "w"), indent=1)
