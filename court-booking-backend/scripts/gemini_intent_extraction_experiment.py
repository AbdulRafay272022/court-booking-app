import os
import json
from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise RuntimeError("GEMINI_API_KEY is missing from .env")

client = genai.Client(api_key=api_key)


messages = [
    "Can I book badminton tomorrow at 7 PM for 90 minutes?",

    "Meri booking cancel kar do jo kal 8 baje badminton ki hai.",

    "Bhai mujhe badminton chahiye par date aur time abhi confirm nahi hai.",

    "Is there any football ground available tomorrow evening?",

    "Mujhe court 3 kal shaam 7 se 9 tak chahiye."
]


for i, message in enumerate(messages, 1):

    prompt = f"""
You are an AI assistant for a sports court booking system.

Understand the customer's WhatsApp message and return ONLY valid JSON.

Customer message:
"{message}"

Today's date is 2026-09-07.

Extract these fields:

- intent:
  one of:
  "create_booking"
  "check_availability"
  "cancel_booking"
  "general_question"
  "missing_information"

- sport:
  "badminton", "football", "tennis", or null

- court:
  court number if explicitly mentioned, otherwise null

- date:
  convert relative dates such as "kal", "tomorrow", "Sunday"
  into YYYY-MM-DD.
  If date is unknown, use null.

- start_time:
  use 24-hour HH:MM format.
  If unknown, use null.

- duration_minutes:
  convert hours into minutes.
  If unknown, use null.

- missing_fields:
  list the fields required to perform the requested action
  that are missing.

Rules:
1. Never invent information.
2. "kal" means tomorrow relative to 2026-09-07.
3. "shaam 7 baje" means 19:00.
4. "raat 9 baje" means 21:00.
5. Return ONLY JSON.
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=prompt,
        )

        text = response.text.strip()

        # Remove markdown code fences if Gemini adds them
        if text.startswith("```"):
            text = text.replace("```json", "")
            text = text.replace("```", "")
            text = text.strip()

        data = json.loads(text)

        print("\n" + "=" * 70)
        print(f"TEST {i}")
        print(f"Message: {message}")
        print("-" * 70)
        print(json.dumps(data, indent=2, ensure_ascii=False))

    except json.JSONDecodeError:
        print("\n❌ Gemini returned invalid JSON")
        print(response.text)

    except Exception as e:
        print(f"\n❌ Error: {e}")