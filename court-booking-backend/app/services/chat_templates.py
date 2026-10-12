"""Fixed, localized replies the booking assistant sends WITHOUT asking the model (Khelo Phase 3).

`render(key, lang, **vars)` returns plain text in Roman Urdu (`"ru"`) or English (`"en"`): no markdown, no emoji, 12-hour times, money as
`format_pkr`. These are the guard replies (unsupported sport, the one missing question, greetings, price / location / hours answers taken from
real facts, the human handoff) and the safe fallbacks used when a model draft fails the reply validator. Every key has both languages
(`tests/test_chat_templates.py` renders them all), and every template asks AT MOST ONE question.
"""

from __future__ import annotations

from typing import Callable

from app.utils.timezone import format_duration

Lang = str  # "ru" | "en"


def join_list(items: list[str], lang: Lang) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + (" aur " if lang == "ru" else " and ") + items[-1]


def duration_words(minutes: int, lang: Lang) -> str:
    """"1 hour" / "1 ghanta", "1.5 hours" / "1.5 ghante": how a length is said in each language."""
    if lang != "ru":
        return format_duration(minutes)
    if minutes < 60:
        return f"{minutes} minute"
    hours = minutes / 60
    return f"{hours:g} ghanta" if hours == 1 else f"{hours:g} ghante"


def duration_options(min_minutes: int, lang: Lang, count: int = 3) -> str:
    return join_list([duration_words(min_minutes + 30 * i, lang) for i in range(count)], lang)


def _support(support: str | None, lang: Lang) -> str:
    if not support:
        return ""
    return f" Aap hamari support line par bhi baat kar sakte hain: {support}." if lang == "ru" else f" You can also reach our support line: {support}."


def _numbered(options: list[str]) -> str:
    return "\n".join(f"{i}. {o}" for i, o in enumerate(options, 1))


def _t_greeting(lang: Lang, sports: list[str] | None = None, **_: object) -> str:
    listed = join_list(sports or [], lang)
    if lang == "ru":
        return "Assalam o Alaikum! Main court booking mein madad kar sakta hoon." + (f" Aap kaun sa sport khelna chahte hain: {listed}?" if listed else " Aap kya khelna chahte hain?")
    return "Hello! I can help you book a court." + (f" Which sport would you like to play: {listed}?" if listed else " What would you like to play?")


def _t_thanks(lang: Lang, **_: object) -> str:
    return "Shukriya! Court ki zaroorat ho to kisi bhi waqt message kar dein." if lang == "ru" else "You're welcome! Message me any time you need a court."


def _t_ack_idle(lang: Lang, **_: object) -> str:
    return "Theek hai. Court book karna ho to bata dein." if lang == "ru" else "Okay. Tell me whenever you want to book a court."


def _t_ack_no(lang: Lang, **_: object) -> str:
    return "Theek hai, koi masla nahi. Kuch aur chahiye to bata dein." if lang == "ru" else "No problem. Let me know if you need anything else."


def _t_ask_sport(lang: Lang, sports: list[str], venue: str | None = None, short: bool = False, **_: object) -> str:
    listed = join_list(sports, lang)
    if lang == "ru":
        if short:
            return f"Kaun sa sport: {listed}?"
        return f"{venue} mein aap kaun sa sport khelna chahte hain: {listed}?" if venue else f"Aap kaun sa sport khelna chahte hain: {listed}?"
    if short:
        return f"Which sport: {listed}?"
    return (f"At {venue}, which sport would you like to play: {listed}?" if venue else f"Which sport would you like to play: {listed}?")


def _t_sport_unclear(lang: Lang, sports: list[str], **_: object) -> str:
    listed = join_list(sports, lang)
    return f"Sport samajh nahi aaya. In mein se kaun sa chahiye: {listed}?" if lang == "ru" else f"I did not catch the sport. Which one would you like: {listed}?"


def _t_sport_multi(lang: Lang, sports: list[str], **_: object) -> str:
    listed = join_list(sports, lang)
    return f"Aap ne kai sports likhe hain. Pehle kaun sa book karna hai: {listed}?" if lang == "ru" else f"You mentioned more than one sport. Which one first: {listed}?"


def _t_sport_unsupported(lang: Lang, sport: str, offered: list[str], venue: str | None = None, others: list[str] | None = None, **_: object) -> str:
    """The venue (or the whole platform, when no venue is in play) does not offer `sport`."""
    listed = join_list(offered, lang)
    others = others or []
    if lang == "ru":
        if venue:
            text = f"{venue} mein {sport} nahi hai. Yahan {listed} hain."
            if others:
                text += f" {sport} {join_list(others, lang)} mein hai. Kya main wo dikhaoon?"
            else:
                text += " Kaun sa chahiye?"
            return text
        return f"{sport} abhi hamare paas nahi hai. Hamare paas {listed} hain. Kaun sa chahiye?" if listed else f"{sport} abhi hamare paas nahi hai."
    if venue:
        text = f"{venue} does not offer {sport}. It offers {listed}."
        if others:
            text += f" {sport} is available at {join_list(others, lang)}. Would you like to see them?"
        else:
            text += " Which one would you like?"
        return text
    return f"We do not have {sport} yet. We offer {listed}. Which one would you like?" if listed else f"We do not have {sport} yet."


def _t_ask_venue(lang: Lang, venues: list[str], sport: str | None = None, short: bool = False, **_: object) -> str:
    listed = join_list(venues, lang)
    if lang == "ru":
        if short:
            return f"Kaun sa venue: {listed}?"
        return f"{sport} {listed} mein hai. Kaun sa venue chahiye?" if sport else f"Kaun sa venue chahiye: {listed}?"
    if short:
        return f"Which venue: {listed}?"
    return f"{sport} is available at {listed}. Which venue would you like?" if sport else f"Which venue would you like: {listed}?"


def _t_ask_court(lang: Lang, courts: list[str], sport: str, venue: str | None = None, short: bool = False, **_: object) -> str:
    listed = join_list(courts, lang)
    if lang == "ru":
        if short:
            return f"Kaun sa court: {listed}?"
        return (f"{venue} mein " if venue else "") + f"{sport} ke courts: {listed}. Kaun sa court chahiye?"
    if short:
        return f"Which court: {listed}?"
    return (f"{sport} courts at {venue}: " if venue else f"{sport} courts: ") + f"{listed}. Which court would you like?"


def _t_ask_date(lang: Lang, short: bool = False, **_: object) -> str:
    if lang == "ru":
        return "Kaun si date?" if short else "Kis date par khelna chahte hain?"
    return "Which date?" if short else "Which date would you like to play?"


def _t_ask_time(lang: Lang, short: bool = False, **_: object) -> str:
    if lang == "ru":
        return "Start time kya hoga?" if short else "Kitne baje se khelna chahte hain?"
    return "Start time?" if short else "What start time would you like?"


def _t_ask_ampm(lang: Lang, hour: int, short: bool = False, **_: object) -> str:
    if lang == "ru":
        return f"{hour} baje: subah (AM) ya shaam/raat (PM)?"
    return f"{hour} o'clock: morning (AM) or evening/night (PM)?"


def _t_ask_duration(lang: Lang, min_minutes: int = 60, short: bool = False, **_: object) -> str:
    options = duration_options(min_minutes, lang)
    if lang == "ru":
        return "Kitne ghante?" if short else f"Kitni der khelna chahte hain? Jaise {options}."
    return "How many hours?" if short else f"How long would you like to play? For example {options}."


def _t_past_date(lang: Lang, **_: object) -> str:
    return "Woh date guzar chuki hai. Kis date par khelna chahte hain?" if lang == "ru" else "That date has already passed. Which date would you like?"


def _t_choices(lang: Lang, options: list[str], **_: object) -> str:
    head = "Mujhe samajhne mein masla ho raha hai. Barae meherbani number likh kar ek chunein:" if lang == "ru" else "I am having trouble understanding. Please reply with the number of one option:"
    return head + "\n" + _numbered(options)


def _t_choices_free(lang: Lang, example: str, **_: object) -> str:
    return f"Mujhe samajhne mein masla ho raha hai. Barae meherbani is tarah likhein: {example}" if lang == "ru" else f"I am having trouble understanding. Please write it like this: {example}"


def _t_handoff(lang: Lang, support: str | None = None, **_: object) -> str:
    if lang == "ru":
        return "Maaf kijiye, main yeh samajh nahi saka. Venue owner ya support team aap ki seedha madad kar sakti hai." + _support(support, lang)
    return "Sorry, I could not understand this. The venue owner or our support team can help you directly." + _support(support, lang)


def _t_already_said(lang: Lang, summary: str, **_: object) -> str:
    return f"Maaf kijiye. Mujhe yeh note hai: {summary}." if lang == "ru" else f"Sorry about that. I have noted: {summary}."


def _t_sports_list(lang: Lang, sports: list[str], venue: str | None = None, **_: object) -> str:
    listed = join_list(sports, lang)
    if lang == "ru":
        return f"{venue} mein {listed} hain." if venue else f"Hamare paas {listed} hain."
    return f"{venue} offers {listed}." if venue else f"We offer {listed}."


def _t_price_info(lang: Lang, lines: list[str], venue: str | None = None, **_: object) -> str:
    body = "\n".join(lines)
    if lang == "ru":
        return (f"{venue} ki prices:\n" if venue else "Prices:\n") + body + "\nPrice venue ne set ki hoti hai."
    return (f"Prices at {venue}:\n" if venue else "Prices:\n") + body + "\nThe venue sets its prices."


def _t_price_unknown(lang: Lang, **_: object) -> str:
    return "Abhi is ki price maujood nahi hai. Price venue ne set ki hoti hai." if lang == "ru" else "I do not have a price for that yet. The venue sets its prices."


def _t_price_bargain(lang: Lang, lines: list[str], **_: object) -> str:
    body = ("\n" + "\n".join(lines)) if lines else ""
    if lang == "ru":
        return "Price venue ne set ki hai, main isay kam ya zyada nahi kar sakta." + (" Maujooda price:" if lines else "") + body
    return "The venue sets the price, so I cannot change it." + (" Current price:" if lines else "") + body


def _t_location(lang: Lang, venue: str, address: str, **_: object) -> str:
    return f"{venue} yahan hai: {address}." if lang == "ru" else f"{venue} is at {address}."


def _t_location_unknown(lang: Lang, **_: object) -> str:
    return "Is venue ka pata abhi maujood nahi hai." if lang == "ru" else "I do not have an address for that venue yet."


def _t_hours(lang: Lang, venue: str, hours: str, **_: object) -> str:
    return f"{venue} ke timings: {hours}." if lang == "ru" else f"{venue} is open {hours}."


def _t_hours_unknown(lang: Lang, venue: str | None = None, **_: object) -> str:
    return "Is venue ke timings abhi maujood nahi hain." if lang == "ru" else "I do not have opening hours for that venue yet."


def _t_ask_which_venue_info(lang: Lang, venues: list[str], **_: object) -> str:
    listed = join_list(venues, lang)
    return f"Kis venue ke baare mein? {listed}." if lang == "ru" else f"Which venue do you mean: {listed}?"


def _t_fallback_ask(lang: Lang, **_: object) -> str:
    return "Maaf kijiye, mujhe dobara likh dein ke aap kya chahte hain." if lang == "ru" else "Sorry, could you tell me again what you would like?"


def _t_fallback_unavailable(lang: Lang, **_: object) -> str:
    return (
        "Abhi yeh check nahi ho saka. Thori der baad dobara try karein ya app mein booking karein."
        if lang == "ru"
        else "I could not check that just now. Please try again in a moment or book in the app."
    )


def _t_held(lang: Lang, label: str, total: str, advance: str, until: str | None = None, **_: object) -> str:
    """The safe version of "your slot is held", used only when the model's own message about a hold that DID succeed failed the safety check."""
    if lang == "ru":
        return f"Aap ka slot hold ho gaya hai: {label}. Total {total}. Advance {advance}" + (f" {until} tak" if until else "") + " bhejna hai. Payment ki tafseel ke liye payment likh dein."
    return f"Your slot is on hold: {label}. Total {total}. Please pay the advance {advance}" + (f" by {until}" if until else "") + ". Write payment for the payment details."


def _t_steer_back(lang: Lang, sports: list[str] | None = None, **_: object) -> str:
    listed = join_list(sports or [], lang)
    if lang == "ru":
        return "Main sirf court booking mein madad kar sakta hoon." + (f" Aap kaun sa sport khelna chahte hain: {listed}?" if listed else "")
    return "I can only help with booking a court." + (f" Which sport would you like to play: {listed}?" if listed else "")


_TEMPLATES: dict[str, Callable[..., str]] = {
    "greeting": _t_greeting,
    "thanks": _t_thanks,
    "ack_idle": _t_ack_idle,
    "ack_no": _t_ack_no,
    "ask_sport": _t_ask_sport,
    "sport_unclear": _t_sport_unclear,
    "sport_multi": _t_sport_multi,
    "sport_unsupported": _t_sport_unsupported,
    "ask_venue": _t_ask_venue,
    "ask_court": _t_ask_court,
    "ask_date": _t_ask_date,
    "ask_time": _t_ask_time,
    "ask_ampm": _t_ask_ampm,
    "ask_duration": _t_ask_duration,
    "past_date": _t_past_date,
    "choices": _t_choices,
    "choices_free": _t_choices_free,
    "handoff": _t_handoff,
    "already_said": _t_already_said,
    "sports_list": _t_sports_list,
    "price_info": _t_price_info,
    "price_unknown": _t_price_unknown,
    "price_bargain": _t_price_bargain,
    "location": _t_location,
    "location_unknown": _t_location_unknown,
    "hours": _t_hours,
    "hours_unknown": _t_hours_unknown,
    "ask_which_venue_info": _t_ask_which_venue_info,
    "fallback_ask": _t_fallback_ask,
    "fallback_unavailable": _t_fallback_unavailable,
    "held": _t_held,
    "steer_back": _t_steer_back,
}

TEMPLATE_KEYS = tuple(_TEMPLATES)


def render(key: str, lang: Lang, **vars: object) -> str:
    """The fixed reply `key` in `lang` ("ru" Roman Urdu or "en" English; anything else is English)."""
    return _TEMPLATES[key]("ru" if lang == "ru" else "en", **vars)
