import pytest

from app.services.chat_language import conversation_language, detect_language


@pytest.mark.parametrize(
    "text",
    [
        "Mjhy booking chayie",
        "Kl ki chayie 9 ki",
        "Aj 9pm ki booking hai?",
        "meine upper tw btaya hai",
        "Kon kon say available hai court ?",
        "mjhy padel ka court chayie",
        "isko bhook krdo",
        "or koi option hai?",
        "kal subah 8 baje",
        "کل شام",
    ],
)
def test_roman_urdu_detected(text):
    assert detect_language(text) == "ru"


@pytest.mark.parametrize(
    "text",
    [
        "I need booking",
        "I want a futsal court",
        "Yes, book it",
        "Is Court 2 at Test Arena 1 available on Tue, 29 Sep at 9:00 PM for 3 hours?",
        "How much is it for two hours?",
    ],
)
def test_english_detected(text):
    assert detect_language(text) == "en"


@pytest.mark.parametrize("text", ["ok", "9 pm", "Padel", "yes", "Test", "", "...", "03191002770"])
def test_no_signal_is_none(text):
    assert detect_language(text) is None


def test_conversation_language_newest_decisive_message_wins_and_inherits():
    assert conversation_language(["Hello", "Kl ki chayie 9 ki", "pm"]) == "ru"
    assert conversation_language(["Kl ki chayie", "I want to book please"]) == "en"
    assert conversation_language(["ok", "9 pm"]) == "en"  # default
    assert conversation_language(["ok"], default="ru") == "ru"
