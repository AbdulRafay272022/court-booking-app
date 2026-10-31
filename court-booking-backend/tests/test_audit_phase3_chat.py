"""Audit build 2026-10-28, Phase 3 item 7: the chat searches every approved venue, matches venue names fuzzily, and answers
"koi dusra venue?" from code with 2-3 other venues and what is free there. The model is scripted (no real call); real Postgres."""

from datetime import time, timedelta

from app.config import get_settings
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.user import UserRole
from app.models.venue import VenueStatus
from app.services import chat_templates
from app.services.ai_chat_service import AIChatService
from app.services.chat_facts import VenueFact
from app.services.chat_state import asks_other_venue, match_venue, venue_matches
from app.utils.timezone import pkt_time_to_utc, pkt_today
from tests.test_chat_replay import ScriptedModel, player_headers, say


def _vf(i: int, name: str) -> VenueFact:
    return VenueFact(id=str(i), name=name, city="Karachi", area=None, address="")


VENUES = [_vf(1, "KHA Legends Arena"), _vf(2, "Court Site"), _vf(3, "Test Arena 1"), _vf(4, "Padel Hub")]


def test_fuzzy_venue_names_resolve_to_the_right_venue():
    for text, want in [
        ("kha legend mein padel", "KHA Legends Arena"),
        ("legends arena kal", "KHA Legends Arena"),
        ("court sight par booking", "Court Site"),
        ("KHA Legends Arena", "KHA Legends Arena"),
        ("test arena 1 ka court 2", "Test Arena 1"),
    ]:
        hit = match_venue(text, VENUES)
        assert hit is not None and hit.name == want, text
    # a sport word or a generic word never picks a venue by itself
    for text in ("padel khelna hai", "mujhe court chahiye", "kal 9 baje", "arena"):
        assert match_venue(text, VENUES) is None, text


def test_two_equally_close_venues_are_both_returned_so_the_chat_asks_which():
    vs = [_vf(1, "Legends Arena North"), _vf(2, "Legends Arena South")]
    assert [v.name for v in venue_matches("legends arena kal", vs)] == ["Legends Arena North", "Legends Arena South"]
    assert match_venue("legends arena kal", vs) is None
    assert match_venue("legends arena south", vs).name == "Legends Arena South"


def test_other_venue_phrases():
    for t in ("koi dusra venue?", "aur koi jagah hai", "koi aur venue", "another venue please", "kahin aur khali hai?", "dusri jagah batao"):
        assert asks_other_venue(t), t
    for t in ("koi aur time", "another slot", "court 2 chahiye", "kal 9 baje"):
        assert not asks_other_venue(t), t


async def _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, name, phone, **venue_kwargs):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, name=name, sports=["padel"], **venue_kwargs)
    court = await make_court(venue, name="Court 1", sport="padel", slot_minutes=60)
    for dow in range(7):
        await make_schedule(court, day_of_week=dow, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)
    return venue, court


async def _four_venues(make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    kha = await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "KHA Legends Arena", "+923071000001")
    site = await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "Court Site", "+923071000002")
    gul = await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "Gulshan Padel Point", "+923071000003", city="Lahore")
    # a futsal-only venue (wrong sport) and a pending venue (not public) must never be offered
    owner = await make_user("+923071000004", role=UserRole.OWNER)
    fut = await make_venue(owner, name="Clifton Futsal Hub", sports=["futsal"])
    fc = await make_court(fut, name="Pitch 1", sport="futsal", slot_minutes=60)
    for dow in range(7):
        await make_schedule(fc, day_of_week=dow, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(fc, price_per_slot=2000)
    await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "Hidden Padel Club", "+923071000005", status=VenueStatus.PENDING)
    return kha, site, gul


async def test_koi_dusra_venue_lists_other_venues_with_what_is_free_without_the_model(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    (kha, _kc), (site, site_court), (gul, _gc) = await _four_venues(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    tomorrow = pkt_today() + timedelta(days=1)
    async with db_session_factory() as s:  # Court Site is taken at 9 PM tomorrow
        start = pkt_time_to_utc(tomorrow, time(21, 0))
        s.add(Booking(court_id=site_court.id, starts_at=start, ends_at=start + timedelta(hours=1), status=BookingStatus.BOOKED,
                      source=BookingSource.WALKIN, player_name="Someone", price=3000, advance_amount=3000))
        await s.commit()
    _user, headers = await player_headers(make_user, make_auth_headers, phone="+923071000010")
    model = ScriptedModel(monkeypatch)  # any model call fails the test
    await say(client, headers, "kha legend mein padel kal raat 9 baje")
    r = await say(client, headers, "koi dusra venue?")
    reply = r["reply"]
    assert r["actions"] == []
    assert "Court Site" in reply and "Gulshan Padel Point" in reply
    assert "KHA Legends Arena" not in reply and "Clifton Futsal Hub" not in reply and "Hidden Padel Club" not in reply
    # the free one first, the taken one says so
    assert reply.index("Gulshan Padel Point") < reply.index("Court Site")
    assert "khali nahi" in reply and reply.rstrip().endswith("Kaun sa venue chahiye?")
    assert model.bodies == []


async def test_other_venues_without_a_date_lists_them_and_says_none_when_there_is_none(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "KHA Legends Arena", "+923071000021")
    _user, headers = await player_headers(make_user, make_auth_headers, phone="+923071000022")
    ScriptedModel(monkeypatch)
    await say(client, headers, "KHA Legends Arena mein padel")
    r = await say(client, headers, "another venue please")
    assert r["reply"] == chat_templates.render("other_venues_none", "en", sport="Padel")

    await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "Court Site", "+923071000023")
    r = await say(client, headers, "any other venue?")
    assert "Court Site" in r["reply"] and "KHA Legends Arena" not in r["reply"]


async def test_two_close_names_get_one_which_venue_question(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "Legends Arena North", "+923071000031")
    await _padel(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "Legends Arena South", "+923071000032")
    _user, headers = await player_headers(make_user, make_auth_headers, phone="+923071000033")
    model = ScriptedModel(monkeypatch)
    r = await say(client, headers, "legends arena mein padel kal")
    assert "Legends Arena North" in r["reply"] and "Legends Arena South" in r["reply"] and r["reply"].count("?") == 1
    assert model.bodies == []


async def test_search_tool_covers_every_public_venue_with_fuzzy_names(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    await _four_venues(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    service = AIChatService(db_session, get_settings())
    names = lambda out: [v["name"] for v in out["venues"]]  # noqa: E731
    assert names(await service._tool_search_venues({"query": "kha legend"})) == ["KHA Legends Arena"]
    assert names(await service._tool_search_venues({"query": "court sight"})) == ["Court Site"]
    # the model guessed the wrong city: still found instead of "no venue"
    assert names(await service._tool_search_venues({"query": "Gulshan Padel", "city": "Islamabad"})) == ["Gulshan Padel Point"]
    everything = names(await service._tool_search_venues({}))
    assert {"KHA Legends Arena", "Court Site", "Gulshan Padel Point", "Clifton Futsal Hub"} <= set(everything)
    assert "Hidden Padel Club" not in everything  # not approved: never shown
