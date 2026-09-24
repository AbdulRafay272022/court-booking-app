"""Section 32 Part 8: run real conversations through the assistant against the REAL
chat model and check the hard display rules on every reply -- no 24-hour times, no
UTC/ISO, no "button/tap/click" wording, no leaked markdown, money as "PKR 3,500".

A SCRIPT, not a pytest test: it makes real, billed model calls (this project keeps
real-API calls out of the suite). Seeds its own venue/court into the DATABASE_URL
you point it at -- use a scratch DB, never the shared dev DB.

  DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5545/court_booking \
    AI_PROVIDER=gemini .venv/Scripts/python.exe scripts/chat_conversation_check.py
"""
import asyncio
import os
import re
import sys
import uuid
from datetime import datetime, time as dtime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models.court import Court
from app.models.pricing import PricingRule
from app.models.schedule import ScheduleTemplate
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus
from app.services.ai_chat_service import AIChatService
from app.utils.text import slugify

settings = get_settings()

_BAD_24H = re.compile(r"\b\d{1,2}:\d{2}\b(?!\s*[APap]\.?[Mm]\.?)")
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}T|\bUTC\b|\bGMT\b")
_BAD_MONEY = re.compile(r"\bRs\.?\s*\d|\d+\.\d")


def check_reply(reply: str) -> list[str]:
    problems = []
    if _BAD_24H.search(reply):
        problems.append(f"24h-time: {_BAD_24H.search(reply).group()!r}")
    if _ISO.search(reply):
        problems.append(f"utc/iso: {_ISO.search(reply).group()!r}")
    for w in ("button", "tap", "click"):
        if w in reply.lower():
            problems.append(f"button-word: {w!r}")
    if "**" in reply:
        problems.append("markdown-bold: **")
    if _BAD_MONEY.search(reply):
        problems.append(f"bad-money: {_BAD_MONEY.search(reply).group()!r}")
    return problems


async def seed(factory):
    now = datetime.now(timezone.utc)
    suffix = uuid.uuid4().int % 10_000_000  # unique phones so re-runs don't collide on the persisted scratch DB
    async with factory() as s:
        owner = User(phone=f"+9230070{suffix:07d}"[:15], name="Owner", role=UserRole.OWNER, phone_verified_at=now)
        player = User(phone=f"+9230080{suffix:07d}"[:15], name="Sara Ahmed", role=UserRole.PLAYER, phone_verified_at=now)
        s.add_all([owner, player])
        await s.commit(); await s.refresh(owner); await s.refresh(player)
        venue = Venue(owner_id=owner.id, name="Clifton Padel", address="Clifton", city="Karachi",
                      location="SRID=4326;POINT(67.03 24.81)", sports=["padel"], status=VenueStatus.APPROVED,
                      amenities=["parking"], slug=f"clifton-padel-{uuid.uuid4().hex[:6]}")
        s.add(venue); await s.commit(); await s.refresh(venue)
        court = Court(venue_id=venue.id, name="Court 1", sport="padel", slot_minutes=60)
        s.add(court); await s.commit(); await s.refresh(court)
        for d in range(7):
            s.add(ScheduleTemplate(court_id=court.id, day_of_week=d, open_time=dtime(6, 0),
                                   close_time=dtime(23, 0), closes_next_day=False))
        s.add(PricingRule(court_id=court.id, name="Standard", price_per_slot=3500, advance_percentage=100.00))
        await s.commit()
        return player


CONVERSATIONS = [
    ("English", ["Hi, I want to book a padel court in Karachi",
                 "Tomorrow evening around 7 PM",
                 "2 hours",
                 "yes"]),
    ("Roman Urdu", ["kal shaam padel court book karna hai Karachi mein",
                    "7 baje",
                    "1 ghanta"]),
    ("Unavailable probe", ["Is there a padel court free at 4 AM tomorrow in Karachi?"]),
]


async def main():
    engine = create_async_engine(settings.DATABASE_URL)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    player = await seed(factory)

    total_problems = 0
    async with factory() as db:
        # fresh User bound to this session
        player = await db.get(User, player.id)
        svc = AIChatService(db, settings)
        for lang, turns in CONVERSATIONS:
            print(f"\n========== {lang} ==========")
            history: list[dict] = []
            for turn in turns:
                print(f"\n> USER: {turn}")
                reply = None
                for attempt in range(3):
                    try:
                        res = await svc.process_message(user=player, message=turn, history=history)
                        reply = res.reply
                        break
                    except Exception as e:  # noqa: BLE001 -- shared-key 429s are common; don't abort the run
                        msg = str(e)
                        if "429" in msg and attempt < 2:
                            print(f"  (model 429, backing off {5 * (attempt + 1)}s...)")
                            await asyncio.sleep(5 * (attempt + 1))
                            continue
                        print(f"  !! MODEL UNAVAILABLE: {type(e).__name__} {msg[:80]}")
                        break
                if reply is None:
                    continue
                print(f"< BOT:  {reply}")
                await asyncio.sleep(2)  # ease the shared key's rate limit
                if res.actions:
                    print(f"  [actions: {[a.type for a in res.actions]}]")
                problems = check_reply(reply)
                if problems:
                    total_problems += len(problems)
                    print(f"  !! PROBLEMS: {problems}")
                else:
                    print("  ok (no 24h/utc/button/markdown/bad-money)")
                history = history + [{"role": "user", "content": turn}, {"role": "assistant", "content": reply}]

    await engine.dispose()
    print(f"\n==== TOTAL HARD-RULE VIOLATIONS: {total_problems} ====")
    print("(model wording/duration-asking is observed above; the hard rules are the pass/fail bar)")


if __name__ == "__main__":
    asyncio.run(main())
