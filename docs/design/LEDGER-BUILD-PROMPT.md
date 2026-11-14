# Khelo — Owner Ledger v2: build prompt (web + mobile, 10 Nov 2026)

Yeh poora block Claude CLI ko paste karo.

```
TASK: Owner "Ledger" dobara banana hai, WEB (owner dashboard) aur MOBILE app ki "Paisa" screen, dono ek saath.

DESIGN FILES (repo mein hain):
- docs/design/ledger-design.html  → WEB design (browser mein kholo, sab click hota hai: tabs, filters, booking kholna, actions).
- docs/design/paisa-mobile.html   → MOBILE design (6 phone screens; labels/tabs ke liye section A dekho).
- docs/design/current/            → abhi ki app ke screenshots + CURRENT-DESIGN.md (theme, components, maujooda masle).

A. YEH FAISLE DESIGN FILES SE UPAR HAIN (design files mein labels English aur tabs purane hain; yeh follow karo)

A1. NAAM: web sidebar aur mobile tab dono mein sirf "Paisa". Page heading "Paisa". "Ledger" sirf code/API/flag mein.
    Sidebar mein alag "Ledger", "Bank check", "Dues", "Refunds" items nahi.

A2. TABS (web aur mobile bilkul same, same order, same naam):
    Bookings · Len-den · Players · Kaam (badge)
    - Bookings = upar "Abhi tak" + "Hisaab" (statement), neeche har booking. (purana web "Hisaab" + mobile "Ledger")
    - Len-den = din-wise har payment/refund, din ka "Kul". (mobile "History")
    - Players = har player ka baqi, ek payment purani pehle. (web "Lena baqi" + mobile "Dues")
    - Kaam = groups: Hisaab par faisla · No-show par player ka jawab · Wapas dena · Refund "Nahi mila" ·
      Bank se mila lein · Screenshots (Approvals par) · Hazri lagayein · Baqi wasooli
      (web "Wapas dena" + "Bank check", mobile "Refunds" + "Bank check")
    Purane links redirect: ?tab=hisaab→Bookings, bank→Kaam (bank group), baqi→Players, wapas→Kaam (wapas group);
    /owner/ledger, /dues, /refunds, /bank-check bhi. Mobile "Aur" menu ke "Bank se mila lein", "Baqi raqam",
    "Har payment ka hisaab" items Paisa ke sahi tab/group par khulein.

A3. ZABAAN: app mein Roman Urdu (ru) aur English (en) dono hain (web messages/ru + messages/en, mobile "Zabaan").
    Paisa ka HAR label language file se aaye, hardcoded nahi (abhi hisaab-tab.tsx, paisa/page.tsx TABS aur mobile
    ledger.tsx mein hardcoded hai, isi wajah se mix aata hai). Default Roman Urdu. Labels:
    | ru (default)              | en                    |
    | Paisa                     | Money                 |
    | Bookings / Len-den / Players / Kaam | Bookings / Payments / Players / To do |
    | Abhi tak                  | Right now             |
    | Lena baqi                 | Customers owe / Due   |
    | Wapas dena                | Refund due            |
    | Advance mila              | Advance received      |
    | Player ka jama            | Player credit         |
    | Approval baqi             | Pending approval      |
    | Hisaab                    | Statement             |
    | Booking ki raqam − Kami = Asal raqam | Booking amount − Deductions = Final amount |
    | Mila + Lena baqi + Slot par lena + Maaf kiya − Wapas dena | Received + Due + Due at slot + Waived − Refund due |
    | Paisa kaise aaya (Cash / Transfer / Wapas diye / Net) | How the money came in |
    | Muddat: Aaj, Is hafta, Pichle 7 din, Pichle 30 din, Is mahina, Pichle 3/6 mahine, Pichla 1 saal, Shuru se, Apni tareekhen | Period: Today, This week, ... Custom dates |
    | Poora mila / Kuch baqi / Hazri baqi / Advance mila | Fully paid / Partly paid / Attendance pending / Advance received |
    | Nahi aaye · advance rakha / Cancel · advance rakha / Cancel · hisaab saaf / Cancel · wapas dena / Jhagra | No-show · advance kept / Cancelled · ... / Disputed |
    | Paisa darj karein / Refund ho gaya / Jama rakhein / Maaf karein / Raqam lein / Raqam kam karein / Ghalti theek karein / Booking cancel karein | Record payment / Mark refunded / Keep as credit / Waive / Collect / Reduce price / Fix a mistake / Cancel booking |
    | Khel liya / Nahi aaye     | Played / No-show      |
    | Player ko wapas / Player ke jama mein | Refund to player / Keep as credit |
    Jo lafz app mein pehle se hain (Lena baqi, Wapas dena, Maaf karein, Raqam lein, Refund ho gaya, Ghalti theek karein,
    Bank se mila lein, Bank mein nahi mila) wohi rakho. Web aur mobile par ek cheez ka ek hi naam.

A4. KUCH MISS NAHI HONA. Abhi ki har cheez nayi jagah par (maine code padh kar list banayi, tum dobara check karo
    aur jo is list mein nahi woh bhi report mein do):
    - Muddat Aaj / Is hafta / Is mahina (web) + 7 din / 30 din (mobile) → Muddat dropdown mein sab.
    - Mila tile: Cash / Transfer / Doosra split → "Paisa kaise aaya" (Doosra bhi jab ho).
    - Court filter, CSV download → wohi.
    - Din-wise rows, "Kul", Cash/Transfer/Wapas diye/Raqam theek ki gayi, correction purana → naya total → Len-den.
    - Row ⋯ "Ghalti theek karein" (reverse, split_payments flag, record_payments permission) → booking ke andar + Len-den row ⋯.
    - Bank check: pichle 7 din ka din chunna, har transfer (waqt, player, code, court, slot, Advance/Baqi,
      kis ne approve / Khud (auto), raqam), "Kul", owner ka "Bank mein nahi mila" (confirm) + tag
      "Staff se wasool" / "Player se maanga" → Kaam "Bank se mila lein".
    - Lena baqi (dues): status (Player ke jawab ka intezar 24 ghante / Player ne sahi kaha / Player ne ghalat kaha:
      aap faisla karein / Aap ne kaha: raqam leni hai / Player ne jawab nahi diya), player ki wajah,
      "Raqam lein" / "Maaf karein", "Done (paisa mil gaya)" Cash ya Transfer (screenshot Approvals mein)
      → Players + Kaam. NOTE: "jawab nahi diya" jhagra nahi hai (spec: request owner ke paas nahi jati);
      "Hisaab par faisla" mein sirf "Ghalat hai" wale.
    - MoneyHealthCard: dues, faisla baqi, no-show replies, points diye / istemal → Kaam counts + points line (Players ya Overview, batao kahan).
    - No-show par player ka "Main aaya tha" (+ GPS) → Kaam: "Player sahi hai, no-show hatao" / "No-show rakho" (NoShowReverseDialog, aakhri qeemat).
    - Wapas dena: status Wapas dena hai / Hissa wapas / Poora wapas, wajah (8 reasons), player ka note,
      duplicate screenshot chip, Overdue flag, Naya chip, payment screenshot thumb, booking details link,
      Overview ?date / court filter banner, refunds badge, mark_refunds permission + refunds flag,
      player ka account (masked, "Poora number dikhayein", copy number/title, ya "account nahi bataya"),
      har bheja refund: raqam, Check (Match / Farq hai), player "Mil gaya / Nahi mila" + jawab box,
      "Refund ho gaya" form: breakdown, raqam + "Poora" chip, partial allowed, Reference zaroori, screenshot optional
      → Kaam "Wapas dena" + "Refund Nahi mila" + booking ke andar. Mobile "Sab dikhao" (settled) → Len-den "Sirf refunds".
    - Mobile "Paisa darj" sheet: "Kaise mila?" Transfer = screenshot → Approvals (approve se pehle hisaab mein nahi).
      Design file ka "Record payment" bhi aisa hi ho.
    - view_ledger permission wale staff ko wohi tabs jo unki ijazat khole.
    Report mein table do: purani cheez → nayi jagah (web + mobile). Koi cheez hatani ho to wajah ke saath poochho.

0. PEHLE CHECK KARO, HUMEIN GHALAT SAMJHO TO BATAO
Hum ghalat ho sakte hain. Code likhne se pehle:
- Poora existing code padho: payment_entries, over-payment block, reversal, correction, cancellation policy fields,
  no-show marking, Dues / Refunds / Bank check / Staff activity pages, staff permissions,
  overnight hours (closes_next_day), web Paisa page (Hisaab / Bank check / Lena baqi / Wapas dena),
  mobile "Paisa" screen (Ledger / Refunds / History), ledger API (GET /api/v1/owners/ledger).
- Neeche ka har rule aur formula code ke saath milao. Jo galat ho, app se takraye, duplicate bane,
  hisaab mein farq laaye, ya koi case chhoot gaya ho: saaf batao kya galat hai aur behtar tareeqa kya hai.
- Report do (chhota, Roman Urdu): kya maujood hai, kya badalna hai, schema changes, API list, web aur mobile
  mein kaun si screen kis cheez ki jagah legi, aur humari ghaltiyan. MERE "GO" KE BAGHAIR CODE NAHI.

1. THEME
- Design files SIRF layout, data aur behaviour ke liye hain. Unka CSS copy mat karna.
- Web: app ka maujooda owner-shell (240px sidebar), Floodlight vars, Bricolage Grotesque + Plus Jakarta Sans,
  baaqi owner pages jaise components.
- Mobile: Floodlight tokens aur maujooda components hi use karo: HeroLayout (teal hero + ground sheet),
  PaisaSwitch (dark segmented), glass tiles, Sheet, KeyValueBlock, MoneyRows, Pill, SelectButton + picker sheets,
  ListRow, GroupLabel, GroupCard, IconTile, Button, EmptyState, FlashList, lucide icons. Naye one-off styles nahi.
- Paisa "PKR 1,234" format (app jaisa). Light only. Tabular numbers.
- Labels section A3 ke mutabiq (Roman Urdu default, English option). Design files ke English labels mat lena.
- Page par koi explanation box, banner ya help paragraph nahi. Sirf data, filters, buttons, errors.
  (Dispute ka player wala message dikhana theek hai, woh data hai.)

2. WEB SCREEN (ledger-design.html dekho)
- Header: "Ledger", venue naam, "Export CSV".
- "Right now" (aaj tak, date filter nahi lagta): Customers owe · Refunds due · Advance received ·
  Player credit · Pending approval. Card tap → Kaam / Players.
- "Statement" (booking ki slot day par). Filters ek line mein DROPDOWN (chips nahi):
  [Period ▾: Last 7 days, Last 30 days, This month, Last 3 months, Last 6 months, Last 1 year, Since start, Custom dates]
  [Court ▾] + chhoti tareekh "4 – 10 Nov 2026". From/To boxes sirf "Custom dates" par.
  Booking amount − Deductions = Final amount
  Received + Due + Due at slot + Waived − Refund due  (+ aur − nishan dikhao)
  Har box tap → Bookings tab us filter ke saath.
  "How the money came in": cash/transfer bar, refunds paid, net (paisa milne ke business day par).
  40+ din par "Month by month" table (band, khol sakte hain).
- Tabs: section A2 (Bookings · Len-den · Players · Kaam).
  Bookings: search + [Status ▾]. Row khulne par Calculation + History + Actions.
  Len-den: day book; dropdowns (Money only / + deductions / only deductions), method, person;
  footer In − Out = Net, "Cash collected by".
  Players: all time, open balances first; ek payment se purane due oldest-first; Share on WhatsApp.
  Kaam: groups section A2 ke mutabiq.
- Web Paisa page ke tabs section A2 ke mutabiq. Jo hatana ho woh report mein batao, khud faisla mat karo.
- Web phone width (< 860px) par mobile design jaisa layout.

3. MOBILE "PAISA" SCREEN (paisa-mobile.html dekho)
- Teal hero: "Paisa" + CSV glass pill.
  PaisaSwitch: Bookings · Len-den · Players · Kaam (badge) — abhi wale Ledger / Refunds / History ki jagah.
- Bookings view, hero mein "Right now" 2×2 glass tiles: Customers owe · Refunds due · Advance received · Player credit.
  Pending approval yahan NAHI; woh Approvals tab ke badge par hai.
- Ground sheet:
  [Period ▾] [Court ▾] SelectButton → picker sheet. Neeche chhoti line: "4 – 10 Nov · 36 bookings · 27 played · 3 no-show · 5 cancelled".
  Statement card (ek column): Booking amount, − Deductions (neeche breakdown), = Final amount,
  Received, + Due, + Due at slot, + Waived, − Refund due.
  "Money in" card: total, cash/transfer bar, Refunds paid.
  Search + [Status ▾].
  Booking cards: naam; "Day date · time · court · KH-id"; "Final X · Received Y"; right side status Pill + balance.
- Booking tap → Sheet: Booking ID, pills, KeyValueBlock (player, phone, slot), MoneyRows hisaab + result row,
  dispute message (agar ho), main actions (jaise Collect balance / Waive due), History timeline,
  "Record payment" + "More ⋯" (reverse, correction, reduce price waghera; role ke hisaab se).
- Record payment sheet: Amount, Method (Cash/Transfer), Business day received;
  booking total se zyada ho to "PKR X extra · what to do?" → Refund to player / Keep as credit.
- Len-den view: hero mein "Net in" + cash/transfer/refunds. Din-wise group, din ka total header mein.
  Row: naam, "type · method · kisne", "KH-id · slot day". Har row par "Theek karein" button NAHI;
  galti theek karna booking sheet ke "More ⋯" mein. Neeche "Cash collected by".
- Players view: search, open balance pehle. Player tap → "Take a payment" sheet (oldest first breakdown, Save, WhatsApp).
- Kaam view: GroupLabel + GroupCard, groups section A2 ke mutabiq.
- Lists FlashList. Web aur mobile same API, same numbers.

4. CURRENT-DESIGN.md wale masle jo is kaam mein theek karne hain
- Hero tiles filter se match nahi karte → "Right now" date filter se azaad, baaqi sab filter ke saath.
- by_day / by_court data use nahi hota → Payments din-wise aur Court filter.
- Chips 3 lines mein → dropdowns.
- "Theek karein" har row par → hata do.
- "Baqi" ke do matlab → sirf "Due" = khel chuka / no-show / cancel ke baad baqi paisa. Dues screen bhi isi number par.
- Bank check / Dues sirf "Aur" se → Paisa ke Kaam / Players se pohanch.
- Expo web /refunds routing bug → check karo, theek karo.
- Walk-in 2,000 ki booking par 4,000 accept hua → bug hai ya nahi, check karo. Rule neeche (zyada paisa) ke mutabiq ho.

5. HISAAB (har booking)
Final = Booking amount + deductions (points, no-show, cancellation, price reduced; sab minus)
Net = payments − refunds − credit mein gaya
Balance = Final − Net − Waived
Balance > 0: khel chuka / no-show / cancel → Due; upcoming / attendance baqi → Due at slot
Balance < 0 → Refund due.
Har set par hamesha: Final = Net + Due + Due at slot + Waived − Refund due (test likho).
Pending/rejected screenshot kisi total mein nahi. Whole rupees.

6. MONEY RULES
- No-show: venue setting (Venue settings + wizard mein add karo), default "advance rakho, baqi charge nahi",
  option "poora charge". "Player was here" se ulta ho jaye.
- Cancel: player X ghante pehle → jo diya sab refund due; kam waqt / no-refund → advance rakha.
  Venue cancel → hamesha full refund. Extra goodwill = "Reduce price" (wajah) phir refund.
- Zyada paisa: jo aaya sab record (cash ya transfer). Advance se zyada lekin total se kam = bara advance.
  Booking total se upar wala hissa: "Refund to player" ya "Keep as player credit" (choice). Row lock rakho.
- Business day = jis din venue khula (Mon 6 PM – Tue 4 AM = Monday), slots aur paisa dono.
  money_business_date + asal timestamp dono save karo. Business day aaj se aage nahi ho sakta.
- Har refund booking + us payment entry se link jo wapis hui. Refund ≤ refund due.
- Player credit: per player per venue, agli booking par use. Cash/transfer totals mein nahi.
- Koi month closing nahi. Kuch edit/delete nahi; ghalti = reversal/correction entry, wajah + link ke saath.
- Purani date ki payment: date ≤ aaj, note zaroori, entry date aaj ki.
- Screenshot + OCR wala tareeqa waisa hi rahe. Bank API / auto reconciliation nahi.

7. CONTROLS
Owner-only: refund, credit, cancel, reduce price, waive, reverse, no-show ulta.
Staff: payment record, attendance mark. Backend mein enforce, UI mein hide.
Caps: refund ≤ refund due, waive ≤ due, credit use ≤ credit aur ≤ balance, player payment ≤ total due.
Same booking + amount + method 10 min ke andar → duplicate warning.

8. TESTS (merge se pehle)
- 5,000 booking: 3,000 aaj, 2,000 mahine baad → Partly paid → Fully paid, dono entries apni date par.
- 5,000 booking, 1,000 advance, no-show → Final 1,000, settled; "Player was here" → 4,000 Due.
- 500 diya, cancel → rule ke mutabiq refund due (refund 500 wali entry se link) ya advance kept.
- 2,000 advance maanga, 3,000 diye (5,000 booking) → Due at slot 2,000.
- 6,500 diya 6,000 par → 500 refund ya credit.
- Walk-in 2,000 par 4,000 → extra 2,000 refund ya credit, chupke se accept nahi.
- Raat 1 baje ka paisa pichle din ke business day mein.
- Koi payment aaj ke baad ke business day par record nahi hoti.
- Date range badalne se "Right now" nahi badalta.
- Staff owner-only action UI ya API se nahi kar sakta.
- Formula har date range aur court par barabar. Web, mobile aur Overview same numbers. CSV = screen.
- Mobile: 390px aur chhote phone par kuch nahi katta; lambi lists FlashList se smooth.
- Web aur mobile ke screenshots design files ke saath compare karke dikhao.

9. PROCESS
Report (step 0) → meri approval → contract file → build. Schema = Migration-Go. Feature flag ledger_v2 (default OFF).
Naye branch par kaam, main par seedha nahi. docs/design/ files commit kar do.
Expenses, profit, charts, cash handover: abhi nahi.
```

## Step 0 ke sawalon ke jawab (12 Nov 2026)

```
1. Mobile History: haan. Paisa → Bookings mein shamil karo. /(owner)/history purane sab params ke saath wahan redirect
   (status, date, staff, act, booking + open=1). Bookings tab mein yeh sab ho: search, Muddat mein "Kal" bhi,
   status, court, staff filter banner, "sirf ye booking" focus, "Aur dikhao", CSV.
   Mobile Len-den nayi screen banegi (web Hisaab ki din-wise list jaisi).
2. Staff ka kaam: buttons sirf Kaam mein. Staff ka kaam mein sirf status line + "Kaam mein kholein" link.
3. "Kuch aur" / Doosra: naya paisa darj karne mein sirf Cash / Transfer. Purani "other" entries hisaab mein
   "Doosra" naam se dikhti rahein (data nahi hatega).
4. Record payment: Transfer = screenshot → Approvals (owner khud foran approve kar sakta hai). Seedha transfer darj nahi.
   Zyada paisa block nahi hoga: jo aaya sab darj, booking total se upar wala hissa "Player ko wapas" ya
   "Player ke jama mein" (choice). Haan, yeh behaviour badal raha hai, confirm.
   Web par record-payment-sheet.tsx ko isi rule ke saath use karo (naya feature).
5. Mobile hero ke Aaj / Is hafte / Is mahine tiles: hata do. Aaj ka paisa Aaj tab par pehle se hai.
   Muddat ka default web aur mobile dono par "Is mahina".

Miss list par:
- Mobile refund card ka player number: rakho (Kaam → Wapas dena row).
- Refunds hero "Kul wapas dena + sab se purana X din": Wapas dena group header mein.
- Notification links: refund → Paisa → Kaam (Wapas dena) + booking sheet khuli; history → Paisa → Bookings + booking khuli.
  Overview tiles, Staff ka kaam numbers, "History mein dekhein" links bhi naye Bookings tab par sahi filter ke saath.
- Badge: Kaam ka count = Paisa tab / sidebar ka badge (mark_refunds wala staff sirf Wapas dena ka count dekhe).
- Help text (point 7): sab hatao. Sirf confirm messages, errors, empty states aur data (jaise "Player ne abhi account
  nahi bataya") rahein.
- Points line: Players header mein theek hai.
- Admin pages: koi badlav nahi.

Ab step 0 ka baaqi hissa do (rules ka backend se milaan, walk-in 4,000 bug, Expo /refunds bug, schema, API list).
Phir mera GO.
```

## Step 0 (rules, bugs, schema, API) ke jawab (12 Nov 2026)

```
Report theek hai. Aap ki 2 correction maan li: Net = payments + jama se diya − refunds − jama mein gaya,
aur Waived alag entry (deduction nahi). 4 faislay:

1. Owner-only: aap ki tajweez theek. Refund mark = mark_refunds par rahe. Reverse, maaf, raqam kam karna, jama
   (credit) aur no-show ulta sirf owner. Jhagre ka faisla (Raqam lein / Maaf karein) aur "Bank mein nahi mila"
   bhi sirf owner. Booking cancel apni maujooda cancel_booking ijazat par rahe (Part 12 nahi todna).
2. Der se cancel: allow karo (ledger_v2 flag ke peeche). Player ko cancel se pehle saaf dikhe:
   "Advance PKR X wapas nahi hoga". Booking "Cancel · advance rakha", slot foran khul jaye aur
   jo players us slot ka intezar kar rahe the unhein maujooda "slot khul gaya" notification jaye.
3. No-show "poora charge": haan, baqi raqam par "kam mila" wala flow khud chale (24 ghante jawab).
4. Business day: haan, venue ka sab se der tak khulne wala court din tay kare.

Schema / data par meri 5 baatein:
a. Purani bookings ke liye sirf base_price nahi, audit log se purane points / maaf / no-show ki
   booking_adjustments rows bhi banao, taake purani bookings par bhi
   Final = Net + Due + Due at slot + Waived − Refund due barabar aaye. Migration ke baad yeh check har booking par chalao
   aur jo na mile unki list do.
b. bookings.price = Final (maaf ke baghair). Baqi = Final − Net − Waived. Jo purana code price − paid se baqi
   nikalta hai usay dhoond kar sahi karo, warna maaf ki hui bookings phir se baqi dikhengi.
c. Bug 3 aur 4: har refund (overpayment_excess, cancelled_payment_received samet) ki linked refund entry bane.
   Refund wapas khulna = us refund entry ka reversal, "other" payment nahi. Purane paid refunds jinki entry nahi bani,
   unki entry paid date par backfill karo.
d. Player credit: walk-in ka phone zaroori hai (28 Oct spec), to credit venue + phone number par bhi chal sake,
   sirf account par nahi. Jahan phone bhi na ho wahan sirf "Player ko wapas".
e. Bug 2 (balance screenshot zyada raqam): extra gum na ho; total se upar wala hissa refund ya jama ka choice.

GO sirf contract file ke liye: contract file banao (schema, migration, API shapes, screens, tests).
Code abhi nahi. Contract file dekh kar main build ka GO dunga.
```

## Contract review aur build GO (12 Nov 2026)

```
Contract achha hai. Build se pehle contract mein yeh 7 cheezein theek karo, phir build shuru:

1. Status table (1.1) mein 2 haalat missing hain:
   - `unpaid`: Abhi kuch nahi mila / Not paid yet (upcoming ya khel chuki, net = 0)
   - `refund_due`: Wapas dena / Refund due (cancel ke baghair zyada paisa, maslan 6,500 on 6,000)
2. Backfill ki tarteeb (3.2): step 6 (uncredited refunds ki entries) step 5 (purane cancel) se PEHLE chale,
   warna cancel adjustment ghalat net par banega.
3. Flag OFF par purana code: backfill waived bookings ka price wapas purana karta hai. Agar 4.2 ka
   "price − paid" wala fix sirf flag ON par ho to flag OFF par maaf ki hui bookings phir baqi dikhengi.
   Is liye 4.2 ka read-path fix (booking_money / balance_due mein waived) flag se azaad, hamesha lage.
   Backfill local par abhi, prod par sirf mere kehne par.
4. Owner / staff cancel: owner ki cancel sheet mein "Kis ne cancel ki: Player / Venue" ho.
   Player ne phone par cancel karwaya to player wala rule (cutoff se pehle refund, baad mein advance rakha).
   "Venue" chune tabhi hamesha poora refund.
5. Staff aur zyada paisa: jama (credit) owner-only hai, to staff ke liye extra ka sirf "Player ko wapas" option.
   Owner baad mein Kaam se "Jama rakhein" kar sakta hai.
6. Approve aur zyada paisa: manual approve dialog mein choice hamesha dikhe ("Player ko wapas" pehle se chuna).
   Auto-approve (Khud) par default refund. API par choice na ho to 409 wahi rule.
7. money_business_date backfill aaj ke closing schedule se hoga; jahan schedule badla ho wahan farq
   ho sakta hai, report mein note kar dena.

Section 10 ke jawab:
1. Cash refund: haan, note zaroori.
2. cancellation_allowed = false: wahan cancel BAND hi rahe. Owner ki setting nahi todni.
   Der se cancel sirf un venues par jahan cancel allowed hai.
3. Backfill ka asar: theek, report mein din-wise farq do.
4. Default refund: haan.

GO: build shuru karo, contract ke order (9) ke mutabiq. Migration-Go sirf local/dev DB ke liye.
Step 3 (backfill + check local DB par) ke baad RUK jao aur check report do. Report dekh kar main aage ka GO dunga.
Prod par kuch nahi.
```

## Step 3 report ke jawab (12 Nov 2026)

```
Report theek hai. 3 jawab aur 3 baatein:

1. S16 jaise walk-ins: haan, backfill overpayment_excess dispute banaye taake Kaam → Wapas dena mein aayein.
   Lekin aisa paisa aksar typing ki ghalti hota hai (4,000 likh diya, 2,000 mila). Is liye us row/booking par
   owner ke paas "Ghalti theek karein" (reverse) bhi ho; reverse karne par dispute khud band ho jaye.
2. S08 (no-show, owner 4,000 maang raha hai, short claim khula): Due hi rahe. Koi kami nahi lagani.
3. Hold / screenshot-review bookings: Statement mein na hon, LEKIN sirf jab un par koi approved paisa na ho.
   Jis booking par advance approve ho chuka aur sirf baqi ka screenshot review mein hai, woh Statement mein
   rahe (warna asal mila hua paisa gaib ho jayega).

Baatein:
a. C4 fail 1 par fix ke baad check dobara chalao. Aage badhne se pehle 9/9 OK hon.
b. Backfill ke baad flag OFF par bhi no-show ki price 5,000 → 1,000 dikhegi. Is liye prod par backfill aur
   flag ON ek saath hoga, alag alag nahi. Contract ke process mein yeh likh do.
c. Local DB khali tha, is liye asli data par yeh abhi pakka nahi. Prod se pehle prod ki copy par --dry-run +
   check zaroori hai (mere GO par). Contract mein gate ke taur par likh do.

GO: step 4, 5, 6 (likhne wale raaste + API, web Paisa, mobile Paisa). Sirf local.
Step 6 ke baad RUK jao aur do:
- web + mobile screenshots: Paisa ke 4 tabs, booking khuli, Paisa darj karein (zyada paise ka choice),
  Refund ho gaya, Kaam ke sab groups, Bank se mila lein, ek staff login ka view
- tests ka nateeja aur check report dobara.
Prod par kuch nahi, push nahi.
```

## Screenshots review (14 Nov 2026)

```
Screenshots dekh liye. Kaam achha hai, hisaab barabar hai (Asal = Mila + Lena baqi + Slot par lena + Maaf − Wapas,
aur Len-den footer Aaya − Gaya = Net). Waiver wala test badalna sahi tha: maaf karne par price nahi girti, flag OFF par bhi.

Yeh theek karo (web aur mobile dono):

A. Web aur mobile mein farq (ek cheez ek jaisi honi chahiye):
1. "Doosra" web par +PKR 2,000, mobile par −PKR 2,000. Ek hi number aur nishan ho.
   Aur yeh −2,000 / +2,000 hai kya? Corrections/reversals (S17 completion fix, S15 refund reopened) "Doosra"
   tareeqe mein nahi jane chahiye; reversal apni asal entry ke tareeqe (cash/transfer) mein gina jaye.
   "Doosra" sirf purani method=other payments ke liye. Batao kya nikla.
2. Tareekh ka format: web "Aaj, Kal, Budh 18 Nov", mobile "Today, Wed 18 Nov, Fri 13 Nov". Dono par ru mein
   Aaj / Kal / Budh ... (en mein Today / Wed). Ek hi helper.
3. Kaam → Wapas dena: web par "Jama rakhein" + "Refund ho gaya", mobile par sirf "Refund ho gaya".
   Mobile mein bhi "Jama rakhein" (owner).
4. "Kis din mila" (Paisa darj): mobile par 7 din ke chips 3 lines mein, web par dropdown. Mobile bhi
   SelectButton dropdown. Isi tarah Kaam → "Bank se mila lein" ke din web par chips hain: dropdown karo.

B. Galtiyan:
5. Wapas dena group mein "Baqi PKR 0" (Poora wapas, S15) wali booking nahi aani chahiye. Woh sirf
   "Refund Nahi mila" mein rahe. Wapas dena = sirf jin par abhi paisa wapas dena baqi hai.
6. Baqi wasooli group ka button "Raqam lein" ghalat hai (woh jhagre ka faisla hai). Yahan "Paisa darj karein"
   ho (purana "Done (paisa mil gaya)"). "Raqam lein" sirf Hisaab par faisla mein.
7. Len-den footer "Cash kis ne liya: System PKR 4,000". Cash koi insaan leta hai. Jin purani entries par
   banda pata nahi unhein "Pata nahi (purana)" dikhao, System nahi.
8. History mein English notes ("Advance credited at approval"). System ki har note ru + en label se aaye.
   "History" heading bhi ru mein "Kya kya hua".
9. Kaam cards par "History mein dekhein" link ab "Booking dekhein" ho (History screen ab Paisa → Bookings hai).
10. "padel" chhote harf mein: sport ka naam label se ("Padel").

C. Kaam ka page bohat lamba hai:
11. Wapas dena aur Refund Nahi mila mein har refund ki transfer history poori khuli hai, aur S11/S15 dono groups
    mein do dafa. Card compact rakho: naam, ID, wajah, baqi, buttons. Transfers aur jawab box "Details" ke andar,
    sirf "Nahi mila" wale group mein jawab box khula.
12. Hazri lagayein: row par seedhe "Khel liya" / "Nahi aaye" buttons.

D. Test data: local test accounts ka password sirf local DB mein rahe. Kisi seed/script/commit mein na jaye.

Phir: contract steps 7–9 (player cancel sheet, baqi redirects/notifications, poore tests). Sirf local.
Ruk kar do: in fixes ke before/after screenshots (web + mobile), player ka "Advance PKR X wapas nahi hoga"
cancel screen, tests ka nateeja, check report. Prod par kuch nahi, push nahi.
```

## Fixes review (14 Nov 2026)

```
Fixes dekh liye, achhe hain. Password wala lafz maine LEDGER-BUILD-PROMPT.md se hata diya hai (file update ho gayi), ab commit kar do.

Dono confirm:
1. "Khel liya" → "Abhi nahi": haan, "kam mila" flow chale aur player ko message jaye.
2. "Staff se wasool" cash mein: haan, theek.

3 chhoti cheezein:
1. Kaam ke groups ki tarteeb web aur mobile par alag hai (web: Hisaab par faisla pehle, mobile: Hazri pehle).
   Dono par ek hi tarteeb: Hisaab par faisla · No-show jawab · Wapas dena · Refund Nahi mila · Bank se mila lein ·
   Screenshots · Hazri lagayein · Baqi wasooli.
2. Bank se mila lein ke "nahi mila" card par "? ne approve kiya" aa raha hai. Banda na ho to "Khud (auto)" likho,
   jaise neeche list mein hai.
3. Player cancel sheet: "Venue ne darj kiya PKR 1,500" ki jagah "Aap ne diye PKR 1,500" (upar Paisa card jaisa).

Phir contract ka step 10 (aakhri report) do: kya bana, kya flag ke peeche hai, prod par jane se pehle kya karna hai
(prod ki copy par --dry-run + check, migration, backfill + flag ON ek saath, rollback ka tareeqa).
Ruk jao. Prod par kuch nahi, push nahi.
```
