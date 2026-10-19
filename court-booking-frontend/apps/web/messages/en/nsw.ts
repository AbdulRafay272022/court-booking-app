// English copy: same keys as messages/ru/nsw.ts.
import type { ruNsw } from "../ru/nsw";

export const enNsw: Record<keyof typeof ruNsw, string> = {
  "nsw.chip.pending": "Status pending",
  "nsw.btn": "Didn't come (No-show)",
  "nsw.btnAria": "{name}: mark as didn't come (No-show)",
  "nsw.dlg.title": "Player didn't come?",
  "nsw.dlg.body": "{name}'s booking ({when}, {court}) will be marked No-show. It is recorded under your name.",
  "nsw.dlg.fix": "If it was a mistake you can fix it later by choosing Yes / No.",
  "nsw.dlg.confirm": "Yes, mark No-show",
  "nsw.dlg.back": "Back",
  "nsw.dlg.saving": "Saving...",
  "nsw.saved": "{name}'s booking was marked No-show",
  "nsw.err.tooEarly": "The slot has not ended yet. Mark it after the slot ends.",
  "nsw.err.forbidden": "You don't have permission to mark a No-show.",
  "nsw.err.changed": "This booking's status has changed. Please refresh the page.",
  "nsw.line.one": "1 booking needs a status",
  "nsw.line.many": "{n} bookings need a status",
  "nsw.line.hint": "Slot over: choose Yes / No or No-show",
  "nsw.line.aria": "{text}. View in Bookings history",
  "nsw.fixHint": "Wrong? Fix it with Yes / No",
};
