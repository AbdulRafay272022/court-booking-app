// English copy: same keys as messages/ru/timer.ts.
import type { ruTimer } from "../ru/timer";

export const enTimer: Record<keyof typeof ruTimer, string> = {
  "timer.title": "Payment reminders",
  "timer.intro": "When a player sends a payment screenshot and you have not approved or rejected it yet, we remind you.",
  "timer.first": "First reminder (after minutes)",
  "timer.every": "Then every (minutes)",
  "timer.max": "Maximum reminders",
  "timer.autoCancel": "Cancel the booking automatically if no decision is made in time",
  "timer.autoCancelMin": "Auto-cancel (after minutes)",
  "timer.warning": "Careful: the player may really have sent the money. After an auto-cancel you will need to handle the refund yourself.",
  "timer.previewLabel": "What will happen",
  "timer.comingSoon": "Saving these settings is coming soon; for now these defaults are in use.",
  "timer.fixFirst": "Fix the error above to see when the reminders will go out.",
  "timer.reset": "Back to defaults",
  "timer.advanced": "Advanced",
  "timer.advancedHint": "Change these only if you need to; the defaults are fine.",
  "timer.hours": "Reminders are sent only while the venue is open; a night-time reminder goes out when the venue opens.",
};
