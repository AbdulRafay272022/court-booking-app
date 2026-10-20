// Roman Urdu copy (source of truth). Keys start with 'nsw.'.
// Stage 2 no-show fix: "Status baqi" marker, the manual "Nahi aaye (No-show)" button and the Overview line (owner text: "karein").
export const ruNsw = {
  "nsw.chip.pending": "Status baqi",
  "nsw.btn": "Nahi aaye (No-show)",
  "nsw.btnAria": "{name}: Nahi aaye (No-show) mark karein",
  "nsw.dlg.title": "Player nahi aaye?",
  "nsw.dlg.body": "{name} ki booking ({when}, {court}) No-show mark ho jayegi. Ye aap ke naam se record hoga.",
  "nsw.dlg.fix": "Ghalti ho jaye to baad mein Haan / Nahi chun kar theek kar sakte hain.",
  "nsw.dlg.confirm": "Haan, No-show mark karein",
  "nsw.dlg.back": "Wapas",
  "nsw.dlg.saving": "Save ho raha hai...",
  "nsw.saved": "{name} ki booking No-show mark ho gayi",
  "nsw.err.tooEarly": "Slot abhi khatam nahi hua. Slot khatam hone ke baad mark karein.",
  "nsw.err.forbidden": "Aap ke paas No-show mark karne ki ijazat nahi hai.",
  "nsw.err.changed": "Is booking ka status badal chuka hai. Page refresh karein.",
  "nsw.line.one": "1 booking ka status baqi",
  "nsw.line.many": "{n} bookings ka status baqi",
  "nsw.line.hint": "Slot khatam ho gaya: Haan / Nahi ya No-show chunein",
  "nsw.line.aria": "{text}. Bookings history mein dekhein",
  "nsw.fixHint": "Ghalat tha? Haan / Nahi se theek karein",
} as const;
