"""Seeds throwaway accounts into a LOCAL dev database for e2e/auth-fix-check.cjs (never run this against production).

Run from court-booking-backend with its venv:   .venv/Scripts/python ../court-booking-frontend/apps/web/e2e/seed-auth-users.py [N]
Prints JSON: {"guests": [...], "unverified": [...], "password": "..."}
 - guests:     users with NO password and NO verified phone (what a WhatsApp guest row looks like)
 - unverified: users WITH a password whose phone was never verified (login -> code screen)
"""
import asyncio
import json
import random
import sys

from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.utils.security import hash_password

PASSWORD = "LivePass123"


def phone() -> str:
    return "+92333" + "".join(str(random.randint(0, 9)) for _ in range(7))


async def main(n: int) -> None:
    out = {"guests": [], "unverified": [], "password": PASSWORD}
    async with AsyncSessionLocal() as s:
        for _ in range(n):
            p = phone()
            s.add(User(phone=p, role=UserRole.PLAYER, name="Auth Fix Guest", phone_verified_at=None))
            out["guests"].append(p)
        pw = await hash_password(PASSWORD)
        for _ in range(max(2, n // 3)):
            p = phone()
            s.add(User(phone=p, role=UserRole.PLAYER, name="Auth Fix Unverified", password_hash=pw, phone_verified_at=None))
            out["unverified"].append(p)
        await s.commit()
    print(json.dumps(out))


asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 24))
