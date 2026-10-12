"""The guards (no database, no model): every production failure pattern of docs/chatbot-log-review-2.md replayed against `decide`, the tool-argument
guards and the Yes/No action policy."""

from datetime import date, datetime, timezone

from app.services import chat_guards as G
from app.services.chat_state import confirmable
from tests.test_chat_state import NOW, at, make_facts, one_sport_facts, run


def decide(messages, current, facts=None, **kw):
    facts = facts if facts is not None else make_facts()
    fold = run(messages, current, facts)
    return G.decide(fold, facts, **kw), fold


def convo(*turns, start=60):
    """[(player, bot)] -> rows, a few minutes apart."""
    rows, t = [], start
    for player, bot in turns:
        rows.append(("player", player, t))
        t -= 1
        rows.append(("ai", bot, t))
        t -= 1
    return rows


# --- P1: the bot chooses sport / court / date / time for the player ------------------------------------------------------------------------


def test_p1_i_need_booking_asks_which_sport_listing_the_real_ones():
    d, fold = decide([], "I need booking")
    assert d.kind == "ask_sport" and d.pending == "sport"
    assert d.reply == "Which sport would you like to play: Cricket, Futsal and Padel?"
    assert not fold.state.has("court") and not fold.state.has("date")  # nothing was chosen for the player


def test_p1_mjhy_booking_chayie_asks_in_roman_urdu():
    d, _ = decide([], "Mjhy booking chayie")
    assert d.kind == "ask_sport" and "kaun sa sport" in d.reply.lower() and "Cricket, Futsal aur Padel" in d.reply
    assert "PM" not in d.reply and "Court" not in d.reply


def test_p1_futsal_chayie_with_no_date_is_one_question_not_a_proposal():
    d, fold = decide([], "Futsal chayie")
    assert d.kind == "ask_date" and d.reply == "Kis date par khelna chahte hain?"
    assert d.reply.count("?") == 1 and fold.state.court_name == "Court A"  # the only futsal court is a database fact; date/time/duration are not guessed


def test_one_question_at_a_time_in_the_required_order():
    kinds, history = [], []
    for message in ("Padel", "Court 2", "kal", "9pm", "2 hours"):
        d, _ = decide(history, message)
        kinds.append(d.kind if d else "model")
        n = len(history)
        history = history + [("player", message, 100 - 2 * n), ("ai", d.reply if d else "ok", 99 - 2 * n)]
    assert kinds == ["ask_court", "ask_date", "ask_time", "ask_duration", "model"]


def test_court_question_lists_only_courts_of_that_sport():
    d, _ = decide([], "padel")
    assert d.kind == "ask_court" and d.reply == "Padel courts at Test Arena 1: Court 2 and Court 3. Which court would you like?"


def test_ambiguous_hour_asks_am_or_pm_in_the_players_language():
    d, _ = decide([], "Futsal kal 9 baje")
    assert d.kind == "ask_ampm" and d.reply == "9 baje: subah (AM) ya shaam/raat (PM)?"
    d, _ = decide([], "Futsal tomorrow at 9")
    assert d.kind == "ask_ampm" and d.reply == "9 o'clock: morning (AM) or evening/night (PM)?"


# --- P2: context lost between turns -----------------------------------------------------------------------------------------------------------------


def test_p2_meine_upper_tw_btaya_hai_uses_what_was_said():
    rows = convo(
        ("9 se 12 ka court chayie or 3000 phr hour mai chayie", "x"),
        ("pm", "x"),
        ("mjhy padel ka court chayie", "Padel ke courts: Court 2 aur Court 3. Kaun sa court chahiye?"),
    )
    d, fold = decide(rows, "meine upper tw btaya hai")
    s = fold.state
    assert s.sport == "Padel" and s.start_time == "21:00" and s.duration_minutes == 180  # the earlier messages are used
    assert d.kind == "already_said"
    assert d.reply.startswith("Maaf kijiye. Mujhe yeh note hai: Padel, 9:00 PM, 3 ghante.")
    assert d.reply.count("?") == 1 and "Court 2 aur Court 3" in d.reply  # then exactly one question: which padel court


def test_p2_court_never_flips_to_another_sport():
    rows = convo(("mjhy padel ka court chayie", "x"))
    d, fold = decide(rows, "kal 9pm 2 hours")
    s = fold.state
    assert s.sport == "Padel" and s.court_id is None  # two padel courts: still the player's choice, never silently "Court A" (futsal)
    err = G.check_availability(s, make_facts(), {"court_id": "c-a", "date": "2026-10-14"})
    assert err and "Padel" in err and "Futsal" in err  # the model asking for the futsal court is refused


# --- P3: a "yes" must not confirm a slot whose length was never chosen ---------------------------------------------------------------------------


def test_p3_no_proposal_unless_every_field_comes_from_the_player():
    facts = make_facts()
    fold = run(convo(("Futsal kal 9pm", "x")), "ok", facts)
    s = fold.state
    assert not confirmable(s)  # the length was never said
    data = {"court_id": "c-a", "starts_at": "2026-10-14T16:00:00+00:00", "slot_count": 2, "label": "x"}
    assert not G.actions_allowed(s, facts, data)
    full = run([], "Futsal kal 9pm 1 hour", facts).state
    assert confirmable(full) and G.actions_allowed(full, facts, data)
    assert not G.actions_allowed(full, facts, {**data, "starts_at": "2026-10-14T17:00:00+00:00"})  # 10 PM is not what they asked for
    assert not G.actions_allowed(full, facts, {**data, "slot_count": 4})  # nor 2 hours
    assert not G.actions_allowed(full, facts, {**data, "court_id": "c-2"})  # nor another sport's court


def test_p3_a_bare_yes_while_a_question_is_pending_is_not_an_answer():
    rows = convo(("Futsal kal 9pm", "Aap kitni der khelna chahte hain? Jaise 1 ghanta, 1.5 ghante aur 2 ghante."))
    d, fold = decide(rows, "Yes, book it")
    assert fold.state.duration_minutes is None  # "yes" did not become a duration
    assert d.kind == "ask_duration" and d.reply == "Kitne ghante?"  # re-asked, shorter
    assert fold.state.unclear == 1


# --- P4: sports, typos, the real list ----------------------------------------------------------------------------------------------------------------


def test_p4_circket_is_understood_as_cricket_not_an_area_question():
    d, fold = decide([], "Circket?")
    assert fold.state.sport == "Cricket" and d.kind == "ask_date" and "area" not in d.reply


def test_p4_furtsal_and_paddle():
    assert decide([], "Furtsal!")[1].state.sport == "Futsal"
    assert decide([], "paddle")[1].state.sport == "Padel"


def test_p4_unsupported_sport_at_a_venue_that_has_other_sports():
    facts = make_facts()
    d, fold = decide([], "Test Arena 1 mein tennis chahiye", facts)
    assert d.kind == "sport_unsupported"
    assert d.reply == "Test Arena 1 mein Tennis nahi hai. Yahan Cricket, Futsal aur Padel hain. Kaun sa chahiye?"
    assert fold.state.sport is None and d.pending == "sport"  # never auto-picked
    d, _ = decide([], "do you have badminton at Test Arena 1?", facts)
    assert d.reply == "Test Arena 1 does not offer Badminton. It offers Cricket, Futsal and Padel. Which one would you like?"


def test_p4_unsupported_sport_offers_the_venues_that_do_have_it():
    facts = make_facts(with_tennis_elsewhere=True)
    d, fold = decide([], "Test Arena 1 mein tennis chahiye", facts)
    assert d.reply == "Test Arena 1 mein Tennis nahi hai. Yahan Cricket, Futsal aur Padel hain. Tennis Gulshan Tennis Club mein hai. Kya main wo dikhaoon?"
    assert d.pending == "show_venues"
    # "yes" then shows them: the sport is the player's, the venue is the one that has it
    rows = [("player", "Test Arena 1 mein tennis chahiye", 5), ("ai", d.reply, 4)]
    d2, fold2 = decide(rows, "haan", facts)
    assert fold2.state.sport == "Tennis" and fold2.state.venue_name == "Gulshan Tennis Club"
    assert d2.kind == "ask_date"


def test_p4_a_sport_nobody_has_on_the_platform():
    d, _ = decide([], "squash chahiye")  # a one-venue platform: the venue is a database fact, so the answer names it
    assert d.kind == "sport_unsupported" and d.reply == "Test Arena 1 mein Squash nahi hai. Yahan Cricket, Futsal aur Padel hain. Kaun sa chahiye?"
    several = make_facts(with_tennis_elsewhere=True)  # no venue in play: the platform answer
    d, _ = decide([], "squash chahiye", several)
    assert d.reply == "Squash abhi hamare paas nahi hai. Hamare paas Cricket, Futsal, Padel aur Tennis hain. Kaun sa chahiye?"
    d, _ = decide([], "I want to play squash", several)
    assert d.reply == "We do not have Squash yet. We offer Cricket, Futsal, Padel and Tennis. Which one would you like?"


def test_p4_greeting_lists_the_real_sports_not_a_hard_coded_list():
    d, _ = decide([], "hello")
    assert d.reply == "Hello! I can help you book a court. Which sport would you like to play: Cricket, Futsal and Padel?"
    assert "badminton" not in d.reply.lower() and "tennis" not in d.reply.lower()
    d, _ = decide([], "hello", one_sport_facts())
    assert "Padel" in d.reply and "Cricket" not in d.reply


def test_the_sport_is_validated_against_the_venue_chosen_later():
    facts = make_facts(with_tennis_elsewhere=True)
    rows = convo(("tennis", "Gulshan Tennis Club mein Court 1 hai. Kis date par khelna chahte hain?"))
    d, fold = decide(rows, "Test Arena 1", facts)  # the player then names a venue that has no tennis
    assert fold.state.sport is None and d.kind == "sport_unsupported" and "Test Arena 1 mein Tennis nahi hai" in d.reply


def test_two_sports_at_once_ask_which_first():
    d, _ = decide([], "futsal ya padel?")
    assert d.kind == "sport_multi" and "Futsal" in d.reply and "Padel" in d.reply


# --- P5/P6: language and bargaining ---------------------------------------------------------------------------------------------------------------


def test_p6_price_bargaining_gets_an_honest_fixed_answer_with_the_real_price():
    rows = convo(("mjhy padel ka court chayie", "Padel ke courts: Court 2 aur Court 3. Kaun sa court chahiye?"), ("Court 2", "Kis date par khelna chahte hain?"))
    d, _ = decide(rows, "3000 phr hour mai chayie")
    assert d.kind == "price_bargain"
    assert d.reply.startswith("Price venue ne set ki hai, main isay kam ya zyada nahi kar sakta. Maujooda price:\nPadel, Court 2: PKR 3,000 for 1 hour")
    assert d.reply.rstrip().endswith("Kis date par khelna chahte hain?")  # the booking carries on with its one question
    d, _ = decide([], "can you do 2000 per hour?")
    assert d.kind == "price_bargain" and d.reply.startswith("The venue sets the price, so I cannot change it.")


def test_p6_koi_aur_option_runs_a_real_search_via_the_model():
    rows = convo(("Padel Court 2 kal 9pm 1 hour", "9:00 PM available nahi hai."))
    d, fold = decide(rows, "or koi option hai?")
    assert fold.turn.more_options and d is None  # the model searches, with the directive; the player is not asked to suggest a time
    d, _ = decide([], "koi aur option?")
    assert d.kind == "ask_sport"  # nothing to search for yet: sport first


def test_price_question_is_answered_from_the_facts_without_losing_the_booking():
    rows = convo(("Padel Court 2 kal", "Kitne baje se khelna chahte hain?"))
    d, fold = decide(rows, "kitne ka hai?")
    assert d.kind == "price_info" and "Padel, Court 2: PKR 3,000 for 1 hour" in d.reply and d.reply.rstrip().endswith("Kitne baje se khelna chahte hain?")
    assert fold.state.sport == "Padel" and fold.state.date == "2026-10-14"


def test_location_and_hours_come_from_facts():
    facts = make_facts()
    facts.venues[0].hours = "6:00 AM to 11:00 PM every day"
    d, _ = decide([], "Test Arena 1 kahan hai?", facts)
    assert d.kind == "location" and "Plot 5, Clifton, Clifton, Karachi" in d.reply
    d, _ = decide([], "what are the timings of Test Arena 1?", facts)
    assert d.kind == "hours" and d.reply.startswith("Test Arena 1 is open 6:00 AM to 11:00 PM every day.")
    d, _ = decide([], "where is it?", facts)  # one venue on the platform: that one
    assert d.kind == "location"


def test_which_sports_question_lists_the_real_ones():
    d, _ = decide([], "kon kon se sports hain?")
    assert d.kind == "ask_sport" and "Cricket, Futsal aur Padel" in d.reply


# --- P7: repeats and "kon kon say available hai court?" --------------------------------------------------------------------------------------------------


def test_p7_listing_question_needs_only_sport_and_date():
    d, fold = decide([], "Kon kon say available hai court ?")
    assert fold.state.mode == "listing" and d.kind == "ask_sport"
    rows = convo(("Kon kon say available hai court ?", d.reply))
    d, fold = decide(rows, "padel")
    assert d.kind == "ask_date"  # no court / time / duration questions for a listing
    rows += [("player", "padel", 40), ("ai", d.reply, 39)]
    d, _ = decide(rows, "kal")
    assert d is None  # everything needed: the model lists every court of the sport


def test_p7_kl_8_hai_9_tw_ni_updates_the_date_and_carries_on():
    rows = convo(("padel Court 2", "Kis date par khelna chahte hain?"))
    d, fold = decide(rows, "Kl 8 hai 9 tw ni")
    assert fold.state.date == "2026-10-14" and d.kind == "ask_time"


# --- chit-chat never reaches the model --------------------------------------------------------------------------------------------------------------


def test_greeting_thanks_and_ok_are_answered_by_templates():
    assert decide([], "Assalam o alaikum")[0].kind == "greeting"
    assert decide([], "thanks")[0].reply == "You're welcome! Message me any time you need a court."
    assert decide([], "shukriya")[0].reply == "Shukriya! Court ki zaroorat ho to kisi bhi waqt message kar dein."
    assert decide([], "ok")[0].kind == "ack"
    assert decide([], "nahi")[0].reply == "Theek hai, koi masla nahi. Kuch aur chahiye to bata dein."
    # mid-booking a greeting just carries on with the pending question
    rows = convo(("Futsal", "Kis date par khelna chahte hain?"))
    d, _ = decide(rows, "hello")
    assert d.kind == "greeting_resume" and d.reply == "Kis date par khelna chahte hain?"


def test_cancel_and_status_questions_are_the_models_not_templates():
    assert decide([], "cancel my booking")[0] is None
    assert decide([], "meri booking kahan hai")[0] is None
    assert decide([], "payment kar di")[0] is None
    assert decide([], "parking hai kya?")[0] is None


# --- off-topic / not an answer to the pending question ----------------------------------------------------------------------------------------------


def test_off_topic_reply_is_reasked_then_choices_then_a_human():
    ask = "Aap kaun sa sport khelna chahte hain: Cricket, Futsal aur Padel?"
    rows = convo(("hello", ask))
    d1, f1 = decide(rows, "mujhe pizza chahiye")
    assert d1.kind == "sport_unclear" and d1.reply == "Sport samajh nahi aaya. In mein se kaun sa chahiye: Cricket, Futsal aur Padel?"  # a different, shorter way
    assert f1.state.unclear == 1
    d1b, _ = decide(rows, "ok")  # a bare "ok" is not an answer either: the short re-ask
    assert d1b.kind == "ask_sport" and d1b.reply == "Kaun sa sport: Cricket, Futsal aur Padel?"
    rows += [("player", "mujhe pizza chahiye", 40), ("ai", d1.reply, 39)]
    d2, f2 = decide(rows, "kuch bhi")
    assert d2.kind == "choices" and f2.state.unclear == 2
    assert d2.reply == "Mujhe samajhne mein masla ho raha hai. Barae meherbani number likh kar ek chunein:\n1. Cricket\n2. Futsal\n3. Padel"
    assert d2.pending == "choice" and d2.options == ["Cricket", "Futsal", "Padel"]
    # a numbered answer picks that line (button-style provenance)
    rows += [("player", "kuch bhi", 38), ("ai", d2.reply, 37)]
    d4, f4 = decide(rows, "3")
    assert f4.state.sport == "Padel" and f4.state.prov["sport"] == "button" and d4.kind == "ask_court"
    # another miss instead: the human handoff (no invented number)
    d3, f3 = decide(rows, "hmm")
    assert d3.kind == "handoff" and f3.state.unclear == 3 and "Venue owner ya support team" in d3.reply and "+92" not in d3.reply
    d5, _ = decide(rows, "hmm", support="+92 300 1112222")
    assert d5.reply.endswith("support line par bhi baat kar sakte hain: +92 300 1112222.")


def test_a_real_answer_resets_the_unclear_count():
    ask = "Which sport would you like to play: Cricket, Futsal and Padel?"
    rows = convo(("hello", ask), ("asdf", "Which sport: Cricket, Futsal and Padel?"))
    d, fold = decide(rows, "padel")
    assert fold.state.unclear == 0 and fold.state.sport == "Padel"


def test_a_long_free_text_message_goes_to_the_model_not_the_unclear_path():
    rows = convo(("hello", "Which sport would you like to play: Cricket, Futsal and Padel?"))
    d, _ = decide(rows, "do you also have a parking area and a cafe where my friends can wait while we play?")
    assert d is None


def test_the_name_question_is_answered_by_the_model_not_treated_as_unclear():
    rows = convo(("Futsal kal 9pm 1 hour", "What name should I put the booking under?"))
    d, fold = decide(rows, "Ali Raza")
    assert d is None and fold.state.unclear == 0


def test_a_past_date_is_asked_again():
    d, _ = decide(convo(("Futsal", "Kis date par khelna chahte hain?")), "11 oct")
    assert d.kind == "past_date" and d.reply == "Woh date guzar chuki hai. Kis date par khelna chahte hain?"


# --- language: every guard reply follows the player ------------------------------------------------------------------------------------------------------


def test_english_in_english_out_and_roman_urdu_in_roman_urdu_out():
    for text, lang in (("I want to book a court", "en"), ("mjhy court book krna hai", "ru")):
        d, fold = decide([], text)
        assert fold.state.language == lang
        assert ("kaun sa sport" in d.reply.lower()) == (lang == "ru")


# --- the tool-argument guards ------------------------------------------------------------------------------------------------------------------------------


def test_availability_needs_a_sport_a_date_and_never_a_time_the_player_did_not_say():
    facts = make_facts()
    s = run([], "mjhy booking chayie", facts).state
    assert "which sport" in G.check_availability(s, facts, {"court_id": "c-2", "date": "2026-10-14"})
    s = run([], "padel", facts).state
    assert "date" in G.check_availability(s, facts, {"court_id": "c-2", "date": "2026-10-14"})
    s = run([], "padel kal", facts).state
    args = {"court_id": "c-2", "date": "2026-10-14", "start_time": "21:00", "end_time": "23:00"}
    assert G.check_availability(s, facts, args) is None
    assert "start_time" not in args and "end_time" not in args  # the model invented a time; the search simply lists the day
    s = run([], "padel kal 9pm", facts).state
    args = {"court_id": "c-2", "date": "2026-10-14", "start_time": "21:00"}
    assert G.check_availability(s, facts, args) is None and args["start_time"] == "21:00"


def test_quote_and_proposal_must_be_exactly_what_the_player_asked_for():
    facts = make_facts()
    s = run([], "padel Court 2 kal 9pm 2 hours", facts).state
    ok = {"court_id": "c-2", "starts_at": "2026-10-14T16:00:00+00:00", "duration_minutes": 120}
    assert G.check_quote_or_proposal(s, facts, dict(ok), proposal=True) is None
    assert "9:00 PM" in G.check_quote_or_proposal(s, facts, {**ok, "starts_at": "2026-10-14T17:00:00+00:00"}, proposal=True)
    assert "2 hours" in G.check_quote_or_proposal(s, facts, {**ok, "duration_minutes": 60}, proposal=True)
    filled = {"court_id": "c-2", "starts_at": "2026-10-14T16:00:00+00:00"}
    assert G.check_quote_or_proposal(s, facts, filled, proposal=True) is None and filled["duration_minutes"] == 120
    assert "Padel" in G.check_quote_or_proposal(s, facts, {**ok, "court_id": "c-a"}, proposal=True)
    no_len = run([], "padel Court 2 kal 9pm", facts).state
    assert "duration" in G.check_quote_or_proposal(no_len, facts, {"court_id": "c-2", "starts_at": ok["starts_at"]}, proposal=True)
