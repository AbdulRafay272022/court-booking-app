# Chatbot log review 2 (2026-10-13)

Source: production `messages` table through the read-only `scripts/show-chat-logs.sh` (phone numbers masked to the last 4 digits, nothing written, no
temp file left on the server). 80 messages (40 player, 40 bot; 16 app, 24 WhatsApp) from 4 accounts, 2026-09-19 to 2026-10-12. Most of it is the owner
testing Test Arena 1 (Futsal, Padel, Cricket). The previous review's 10 fixes are in `main` (calendar block, real sports list, AM/PM guard, "this slot" guard,
no past dates, ...). The patterns below are what is STILL wrong, or only half fixed.

Root causes were found by reading `app/services/ai_chat_service.py`, `app/api/webhooks.py`, `app/api/chat.py` and `app/models/message.py`. Where a cause is a
suspicion rather than something proven by a test, it says so.

## What the code does today (why context gets lost)
- `load_history(limit=10)` hands the model only the last 10 TEXT rows of that user and channel. Tool calls and tool results are NOT stored, so after one turn
  the model no longer knows the `court_id`, which sports a venue has, or the exact slot data. It re-derives them from prose, or guesses.
- There is no conversation state. Sport, court, date, time and duration live only inside the model's head for that turn.
- WhatsApp and app chat share nothing but the text of the last 10 messages; an old chat from days ago is still "history" (a 2026-10-07 chat leaked into 2026-10-10).
- One turn = one model loop; nothing validates the final text against the facts or against what the player just said.
- `messages.metadata` (JSONB) already exists and already carries the Yes/No `actions`; it is a free place to store state without a migration.
- `messages.whatsapp_msg_id` has a unique index (webhook retries are dropped at insert) but there is no per-conversation lock, so two quick messages can be
  answered in parallel and out of order.

## Failure patterns

### P1. The bot chooses the sport / court / date / time for the player
- Player (WhatsApp, 10-07): "I need booking" -> bot: "Test Arena 1 mein Futsal ke liye Court A par kl 9 October 2026 ke liye booking karni hai?"
- Player (WhatsApp, 10-10): "Mjhy booking chayie" -> bot: "Padel ke liye Court 2 par aaj raat 9:00 PM to 10:00 PM (1 hour) ka slot available hai..."
- Player (WhatsApp, 10-10): "Futsal chayie" (no date, no time, no duration) -> bot sends a full "Shall I book it?" proposal for 9 PM today.
- Root cause: the prompt says "never choose for the player" but nothing enforces it server side (`_gate_tool` only checks sport at multi-sport venues, and only
  before `check_availability`). The model's own earlier guess becomes "history" and is then treated as what the player said.
- Fix: server-side conversation state with a `source` per field (said by player / from a button / assumed). A proposal or availability call is only allowed when
  sport, court, date, time are all `player`-sourced; otherwise the code asks the one missing question.

### P2. Context lost between turns (sport and court flip, "I told you above")
- App chat 10-12: Player "mjhy padel ka court chayie" -> bot "Padel ... Court 2 available. Kis date aur time?" ->
  Player "meine upper tw btaya hai" (I already told you above) -> bot proposes **Court 2, 9 PM to 12 AM, PKR 30,000**.
- Same chat, a minute earlier: Player "9 se 12 ka court chayie or 3000 phr hour mai chayie" -> "Subah (AM) ya shaam/raat (PM)?" -> "pm" ->
  bot proposes **Court A** (the Futsal court), PKR 9,000. The previous message was about Court 2. Sport and court flipped silently.
- Root cause: no stored sport/court; the model re-picks from a venue with two sports each turn.
- Fix: state block injected every turn (sport, court, date, time, duration, language, stage) and a guard that rejects a draft that names a different
  sport/court than the state.

### P3. A "Yes" confirms a slot whose duration was never chosen
- WhatsApp 09-29: bot "Kl 9:00 AM to 10:00 AM, Thu 1 Oct ka slot available hai. Aap kitni der khelna chahtay hain? 1 hour, 2 hours..." (a question, but the
  message carries `confirm_booking, decline` actions) -> player "Yes, book it" -> **Held 1 hour for PKR 3,000**.
- The same unwanted Yes/No actions are attached to messages 10-07 (three times) that ask for the duration.
- Root cause: `_attach_proposal_for_named_slot` / proposal actions are attached while a required field (duration) is still unknown; a bare "yes" then confirms
  the pending slot with the default length.
- Fix: no proposal actions unless stage == confirming and every field is player-sourced; a bare yes while a question is pending is NOT a confirmation.

### P4. Typos and sport words not understood; the real sport list is ignored
- "Circket?" -> bot asks "kis area mein dekhna chahtay hain?" (it did not answer cricket). "Furtsal!" worked only by luck.
- 09-19: the welcome message lists "badminton, futsal, padel, tennis, or cricket nets" (a hard-coded list from the model's memory) while the venue offers
  Cricket, Futsal and Padel. In a conversation about Karachi the bot said "we don't have any futsal venues in Karachi" (true at that time, but it never
  said which sports/venues it does have).
- Fix: sport matching in code against the venue's real sports (alias + fuzzy: cricket/circket/cricket nets, futsal/furtsal/football indoor...), a fixed
  localized reply when the sport is not offered ("Test Arena 1 mein Tennis nahi hai. Yahan Cricket, Futsal aur Padel hain."), a choice question when the
  word is unclear.

### P5. Language mismatch
- App chat 10-12: player writes Roman Urdu; the proposal and several answers are English ("Yes, Court A is available on Tuesday, 13 Oct ... Shall I book it?
  Reply Yes or No. Venue: ... Advance due now ..."). The labels "Venue / Court / Total / Advance due now" are English templates.
- WhatsApp: "Held! ..." (09-29) and the payment-screenshot answer "Got it, thanks! ⚠️ The amount doesn't quite match ..." are English with an emoji in a Roman Urdu
  chat. (The screenshot reply was localized later by `reply_text.py`; **"Held!" and the decline messages are still always English.**)
- Fix: a `language` field in the state (from the player's recent messages), every template localized by code, a reply validator that rejects the wrong language.

### P6. The player's price / bargaining and "other options" requests are not understood
- "mjhy 9 se 12 ka court chayie or 3000 phr hour mai chayie" (I want 9 to 12, at 3000 per hour). The bot asked AM/PM, then proposed PKR 9,000 on Court A and
  later PKR 30,000 on Court 2 without ever saying that the price is set by the venue.
- "or koi option hai?" (any other option?) -> the bot asked the player to suggest another time instead of listing real alternatives.
- Fix: price comments get a fixed honest answer ("Price venue ne set ki hai: PKR X per hour") with the facts, "other options" runs a real availability search.

### P7. Repeats and questions that do not fit the player's last message
- WhatsApp 10-07: "Kon kon say available hai court ?" -> the bot repeats the same slot sentence and the same duration question.
- 10-12 app: "meine upper tw btaya hai" -> the bot answers with a proposal instead of acknowledging and using what was said.
- "Kl 8 hai 9 tw ni" (tomorrow is the 8th, not the 9th): the bot corrects the date but does not carry on with the slot question; state is not updated.
- Root cause: no check that the reply addresses the player's last message or that it differs from the previous bot message.
- Fix: reply validator (repeat check, answered-question check, intent match) + a re-ask in different words, then 2-3 choices, then a human handoff.

### P8. Wrong or odd facts in labels
- 09-29: "Time: 6:00 PM to 9:00 PM, Sat 3 Oct **2020**" (a year glitch from a stale date in the model's tool arguments; later builds no longer show a year).
- Held message says "within 15 minutes" (config `BOOKING_HOLD_MINUTES = 15`) while the team's rule of thumb is a 5-minute window: not a bot bug, but the owner
  should confirm which is intended. No business rule was changed.

### P9. Old messages leak into new conversations
- 10-07, 10-10, 10-12: each new WhatsApp conversation starts with a greeting-like message ("Mjhy booking chayie") and the bot answers with a slot for a sport/court
  from the earlier conversation (Padel Court 2 / Futsal Court A) because the last 10 rows include yesterday's chat.
- Fix: a conversation boundary (silence of more than a few hours, or a finished booking) resets the state; old rows are not injected as "known".

### P10. Reliability gaps (not yet seen in these logs but present in the code)
- No per-conversation lock: two fast messages can be processed in parallel and answered out of order or twice.
- A model/tool failure returns "I'm having trouble completing that -- could you try rephrasing, or check the app directly?" in English.
- Greetings/thanks/"ok" can still start tool loops (usage log: 514 chat calls for 40 player messages, ~13 model calls per player message).

## Fix plan (implemented in Phase 3)
1. `ChatState` derived on every turn from stored message metadata + the current message, with field provenance; persisted on the bot message's `metadata` (no schema change).
2. Facts block (venue sports, courts per sport, hours, prices) built from the database and injected with the state.
3. History window: last N turns + the turns that set state fields; conversation boundary after a long silence.
4. Sport guard in code (aliases, typos, unsupported sport -> fixed localized template).
5. One-question rule enforced in code (draft that asks something already known is rejected).
6. Reply validator after generation (repeat, answered question, unknown facts, state contradiction, wrong language, style rules, stale intent), one retry, then a safe template.
7. Off-topic and unclear handling (re-ask once, choices, handoff), greetings never call tools.
8. Localized "Held!" and decline messages (Roman Urdu or English).
9. Idempotency by WhatsApp message id, per-conversation advisory lock, safe localized fallbacks for model and tool failures.
10. Replay tests built from the transcripts above.
