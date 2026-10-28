# Device test checklist (audit build 2026-10-28)

Everything below could not be verified without a real phone. Run on a cheap Android (the target) and, where noted, an iPhone.
Build: the preview build from `docs/deploy-steps.md` (Phase 4). Backend: production or the local stack.

| # | Item | What to do | Pass when |
|---|---|---|---|
| D1 | P1.5 slots don't jump (app) | Open a venue, pick a court + today, scroll so the slot grid is mid-screen, wait 2 minutes (two 30 s refreshes and a slot starting) | The screen does not move up by itself; started slots disappear without the page jumping |
| D2 | P1.5 popup scroll (web, iOS Safari) | On an iPhone open a venue page, tap a day, scroll the slot list to the end and keep scrolling | The page behind the popup does not move; closing the popup returns to the same place |
| D3 | P1.4 booking detail (app) | Open a booked booking: money lines, "Booking ki kahani", WhatsApp / Call buttons | WhatsApp opens the venue chat with the booking code; Call dials |
| D4 | P1.6 photos (app) | Set a profile photo; check home header, profile tab; as owner check Today cards / approvals / booking detail | The photo shows; initials only when there is none |
| D5 | P1.17/18 notifications (app) | Staff marks a no-show and a "kam mila"; check the owner phone and the player phone | Owner push "Bilal ne ... no-show ki"; player push with booking ID, total, paid, due; tapping opens the right screen |
| D6 | P1.19 walk-in (app) | Add a walk-in without phone / without the tick | Save is blocked until both are filled |
| D7 | P1.20 Raast QR | Switch `iban_qr` ON (admin), set a real IBAN on a test venue, open a held booking's pay screen; scan the QR with **Meezan**, **HBL Mobile**, **Easypaisa**, **JazzCash** (do NOT complete the payment) | Each app opens a transfer to the venue's IBAN with the amount filled in. If any app rejects it, write down the error and switch `iban_qr` OFF again |
| D8 | Camera check-in (app) | Owner scans a player's booking QR; player scans the venue QR | Both check in; a second scan of the same QR says it is already checked in |
| D9 | Safe area / tab bar (app) | Scroll to the bottom of Home and My bookings | The last card scrolls fully above the floating tab bar |
