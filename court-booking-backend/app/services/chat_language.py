"""Which language should the booking assistant answer in: Roman Urdu ("ru") or English ("en")?

Players write Roman Urdu ("kal 9 baje ka slot chahiye"), English, or a mix, with heavy misspelling ("chayie", "mjhy", "krdo"). Detection is a
transparent word-list vote, not a model call, so it is cheap, deterministic and testable. Urdu script counts as Roman Urdu (we always reply in
Latin script). Shared by the state/guard layer (`ai_chat_service`) and the fixed reply templates (WhatsApp Held/decline/payment replies).
"""

import re
from typing import Literal

Lang = Literal["ru", "en"]

_URDU_SCRIPT = re.compile("[؀-ۿ]")
_WORD = re.compile(r"[a-z؀-ۿ']+")

# Common Roman Urdu / Hindi-Urdu chat words and the spellings players actually use. Short ambiguous English words ("me", "to", "so", "do") are excluded.
_RU_WORDS = frozenset(
    """
    hai hain hay ha hun hu tha thi the-ka ka ki ke ko ky kya kia kaisa kaise kab kahan kaha kon kaun kitna kitni kitne kitnay kyun kyu
    mujhe mjhy mjhe muje mujhy mera meri mere mein mai main me-se meine apna apni aap aapka aapki aapko ap tum tumhara tumhari
    chahiye chahye chayie chaiye chahie chahta chahti chahtay chahte chaye chahiyay
    nahi nahin nhi ni na nai
    haan han ji jee bilkul theek thik acha achha accha
    kal aaj aj parson subah subha sham shaam raat dopahar
    baje bje bajay der ghanta ghantay ghante minute-ka
    karo karna karni karein krdo kardo krna kar karen kro kijiye kijye
    dekho dekhna batao batain bataen bata btao btaya btana
    bhai bhaiya yaar yar sir
    se tak par per pe wala wali walay
    hoga hogi hoon ho-ga
    wo woh ye yeh yahan yahi wahan
    abhi pehle phir fir agla agli koi kuch sab sirf bas bhi aur or lekin magar
    jagah kamra court-ki khelna khelne khelni khel
    shukriya shukria meherbani maaf
    upper neeche oper
    """.split()
)

_EN_WORDS = frozenset(
    """
    the is are was were am be been it this that these those there here what when where which who why how
    i you we they he she my your our their
    want need would like please can could will shall should may might
    book booking available availability slot slots court courts time date today tomorrow tonight morning evening night afternoon
    yes no ok okay sure thanks thank hello hi hey good
    for with from to at on in of and or but not any some all one two three four five six hour hours minute minutes
    price cost much many have has had do does did get give show tell check cancel change another other option options
    """.split()
)
# Words that look like both: they do not vote.
_NEUTRAL = frozenset({"ok", "okay", "hi", "hello", "hey", "yes", "no", "court", "courts", "slot", "slots", "minute", "minutes", "time", "or", "am", "me", "to", "so"})


def _words(text: str) -> list[str]:
    return _WORD.findall((text or "").lower())


def score(text: str) -> tuple[int, int]:
    """(roman_urdu_votes, english_votes) for one message."""
    if _URDU_SCRIPT.search(text or ""):
        return (5, 0)
    ru = en = 0
    for w in _words(text):
        if w in _NEUTRAL:
            continue
        if w in _RU_WORDS:
            ru += 1
        elif w in _EN_WORDS:
            en += 1
    return (ru, en)


def detect_language(text: str) -> Lang | None:
    """The language of ONE message, or None when it carries no signal ("ok", "9 pm", "Padel", "yes")."""
    ru, en = score(text)
    if ru == 0 and en == 0:
        return None
    return "ru" if ru >= en else "en"


def conversation_language(player_texts: list[str], default: Lang = "en") -> Lang:
    """The language to answer in, from the player's recent messages (oldest first). The newest decisive message wins; a mixed message
    goes to whichever side has more votes, ties favour Roman Urdu (the player is clearly comfortable in it). No signal anywhere -> `default`."""
    for text in reversed(player_texts[-6:]):
        found = detect_language(text)
        if found:
            return found
    return default
