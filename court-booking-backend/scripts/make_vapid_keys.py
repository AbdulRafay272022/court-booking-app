"""Print ONE new VAPID (P-256) key pair for Web Push (docs/web-push-plan.md section 2).

Run once, on your own machine, and copy the two values into SSM yourself:

    python scripts/make_vapid_keys.py

    /court-booking-app/secrets/WEB_PUSH_VAPID_PRIVATE_KEY  (SecureString)  <- PRIVATE line
    /court-booking-app/secrets/WEB_PUSH_VAPID_PUBLIC_KEY   (String)        <- PUBLIC line
    /court-booking-app/secrets/WEB_PUSH_VAPID_SUBJECT      (String)        <- mailto:<support email>

Then `sudo /opt/court-booking-app/bootstrap.sh env` and recreate the backend container. The keys go to THIS terminal
only: nothing is written to a file, a log or the repo. Running it again makes a DIFFERENT pair, and switching pairs
invalidates every browser subscription (users switch notifications on again).

PRIVATE = base64url (no padding) of the 32-byte private scalar; PUBLIC = base64url of the 65-byte uncompressed point
(what the browser's `applicationServerKey` needs). Only needs the `cryptography` package.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private_raw = key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    print("WEB_PUSH_VAPID_PRIVATE_KEY=" + _b64url(private_raw))
    print("WEB_PUSH_VAPID_PUBLIC_KEY=" + _b64url(public_raw))
    print("WEB_PUSH_VAPID_SUBJECT=mailto:<your support email>")


if __name__ == "__main__":
    main()
