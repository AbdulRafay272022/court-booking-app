"""Generate synthetic payment-screenshot fixtures for Section 32 Part 7 OCR testing.

These are RENDERED (digital-clean) receipts, plus deliberately-degraded "messy"
variants (rotation, low contrast, noise, blur, heavy JPEG). They stand in for real
JazzCash/Easypaisa screenshots for pipeline tests and an honest accuracy check.

IMPORTANT CAVEAT: synthetic renders (even the "messy" ones) are far kinder to a
vision model than a real photo of a phone screen (glare, moire, skew, a thumb over
a corner, low-end camera). Treat any accuracy measured on these as an optimistic
upper bound, not a real-world number -- see scripts/ocr_accuracy_report.py.

Run:  .venv/Scripts/python.exe scripts/generate_ocr_fixtures.py
Outputs to tests/fixtures/payments/. Ground truth is in fixtures_manifest.py.
"""
import os
import random

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

random.seed(7)  # deterministic fixtures

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "tests", "fixtures", "payments")
os.makedirs(OUT, exist_ok=True)

FONT = r"C:\Windows\Fonts\segoeui.ttf"
FONT_B = r"C:\Windows\Fonts\segoeuib.ttf"


def _font(size, bold=False):
    path = FONT_B if bold and os.path.exists(FONT_B) else FONT
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def _receipt(brand, brand_rgb, rows, status="Payment Successful", status_ok=True):
    """Render a simple, realistic mobile-wallet confirmation card."""
    W, H = 720, 1000
    img = Image.new("RGB", (W, H), (245, 246, 248))
    d = ImageDraw.Draw(img)
    # brand header bar
    d.rectangle([0, 0, W, 150], fill=brand_rgb)
    d.text((40, 48), brand, font=_font(46, bold=True), fill=(255, 255, 255))
    # status
    tick_rgb = (31, 122, 82) if status_ok else (168, 67, 44)
    d.ellipse([300, 210, 420, 330], fill=tick_rgb)
    d.text((334, 244), "\u2713" if status_ok else "\u2717", font=_font(60, bold=True), fill=(255, 255, 255))
    sw = d.textlength(status, font=_font(34, bold=True))
    d.text(((W - sw) / 2, 350), status, font=_font(34, bold=True), fill=(40, 44, 50))
    # detail rows
    y = 470
    for label, value in rows:
        d.text((60, y), label, font=_font(26), fill=(120, 128, 136))
        vw = d.textlength(value, font=_font(30, bold=True))
        d.text((W - 60 - vw, y - 4), value, font=_font(30, bold=True), fill=(30, 34, 40))
        d.line([60, y + 48, W - 60, y + 48], fill=(224, 227, 231), width=1)
        y += 92
    return img


def _messy(img):
    """Degrade a clean render toward a real-world screenshot-of-a-photo."""
    img = img.rotate(4.0, expand=True, fillcolor=(238, 238, 240), resample=Image.BICUBIC)
    img = ImageEnhance.Contrast(img).enhance(0.62)
    img = ImageEnhance.Brightness(img).enhance(0.84)
    # sensor noise
    px = img.load()
    w, h = img.size
    for _ in range(int(w * h * 0.06)):
        x, y = random.randint(0, w - 1), random.randint(0, h - 1)
        n = random.randint(-42, 42)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    # crop an edge off (information partly lost, like a hasty screenshot)
    w, h = img.size
    img = img.crop((30, 60, w - 15, h - 40))
    return img


def save_png(img, name):
    p = os.path.join(OUT, name)
    img.save(p, format="PNG")
    print("wrote", os.path.relpath(p, os.path.join(HERE, "..")))


def save_jpg(img, name, quality=38):
    p = os.path.join(OUT, name)
    img.convert("RGB").save(p, format="JPEG", quality=quality)
    print("wrote", os.path.relpath(p, os.path.join(HERE, "..")))


def main():
    jc = (216, 28, 58)   # JazzCash red
    ep = (0, 158, 96)    # Easypaisa green

    jazz_rows = [
        ("Amount", "Rs. 400"),
        ("Sent to", "Maidan Padel Club"),
        ("Account", "0300-1234567"),
        ("Sender", "Ali Raza"),
        ("Transaction ID", "TXN987654321"),
        ("Date & Time", "24 Sep 2026, 07:12 PM"),
    ]
    save_png(_receipt("JazzCash", jc, jazz_rows), "jazzcash_clean.png")
    save_jpg(_messy(_receipt("JazzCash", jc, jazz_rows)), "jazzcash_messy.jpg")

    ep_rows = [
        ("Amount", "Rs. 1,000"),
        ("Received by", "0345-7654321"),
        ("Sender Name", "Bilal Ahmed"),
        ("Ref No", "EP123456789"),
        ("Date", "24 Sep 2026 06:30 PM"),
    ]
    save_png(_receipt("Easypaisa", ep, ep_rows), "easypaisa_clean.png")
    save_jpg(_messy(_receipt("Easypaisa", ep, ep_rows)), "easypaisa_messy.jpg")

    failed_rows = [
        ("Amount", "Rs. 400"),
        ("Sent to", "Maidan Padel Club"),
        ("Sender", "Ali Raza"),
        ("Transaction ID", "TXN000111222"),
        ("Date & Time", "24 Sep 2026, 07:15 PM"),
    ]
    save_png(_receipt("JazzCash", jc, failed_rows, status="Transaction Failed", status_ok=False), "jazzcash_failed.png")

    # not a receipt: a plain non-payment image
    nr = Image.new("RGB", (720, 720), (60, 90, 140))
    dr = ImageDraw.Draw(nr)
    for i in range(0, 720, 40):
        dr.line([(0, i), (720, i)], fill=(80, 110, 160), width=6)
    dr.text((120, 320), "Team lunch, Sunday!", font=_font(48, bold=True), fill=(255, 255, 255))
    save_png(nr, "not_a_receipt.png")


if __name__ == "__main__":
    main()
