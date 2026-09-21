"""Promote ONE existing player to admin (run inside the backend container).

Safe by construction: aborts unless exactly one account matches the phone, that account is a
`player`, and its phone is verified. Writes an audit_log row. Never prints the full number.
Usage (via promote_admin.sh):  python - +923XXXXXXXXX
"""
import asyncio
import re
import sys

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services.audit_service import AuditService


async def main(phone: str) -> None:
    if not re.fullmatch(r"\+923\d{9}", phone):
        print("ABORT: expected +92 then 10 digits starting with 3, e.g. +923XXXXXXXXX")
        return
    async with AsyncSessionLocal() as s:
        users = (await s.execute(select(User).where(User.phone == phone))).scalars().all()
        if len(users) != 1:
            print(f"ABORT: {len(users)} accounts match ***{phone[-4:]}; expected exactly 1. Nothing changed.")
            return
        user = users[0]
        if user.role != UserRole.PLAYER:
            print(f"ABORT: that account is '{user.role.value}', not 'player'. Nothing changed.")
            return
        if user.phone_verified_at is None:
            print("ABORT: that account's phone is not verified yet. Nothing changed.")
            return
        user.role = UserRole.ADMIN
        await AuditService(s).log(
            actor_user_id=None,
            actor_type="system",
            action="user.role_changed",
            entity_type="user",
            entity_id=user.id,
            old_value={"role": "player"},
            new_value={"role": "admin", "reason": "manual promotion requested by the project owner"},
        )
        await s.commit()
        print(f"OK: account ***{phone[-4:]} is now an admin (audit entry written).")


asyncio.run(main(sys.argv[1]))
