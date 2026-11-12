# Current owner design: reference for the mobile Ledger / "Paisa" redesign

Snapshot taken 2026-11-10 from branch `fix/bank-details-key-loss`, which is local `main` plus one commit.

Screenshots come from the real app running against a **local** backend: a scratch DB with seed data (`Demo Owner`, `Demo Arena`, two courts) plus about 10 sample walk-ins, payments, one cancel/refund and two pending approvals. Nothing here touched prod.

- Mobile shots are Expo web at 390×844 with DPR 2, so the PNGs are 780 px wide.
- `-full` shots use a 390×2000 viewport so the whole scroll fits in one image.
- Web shots are the Next dashboard at 1440 wide, full page.

Paths: **M** = `court-booking-frontend/apps/mobile`, **T** = `court-booking-frontend/packages/ui-tokens/src`, **W** = `court-booking-frontend/apps/web`.

---

## 0. Screenshots

| File | What it shows |
|---|---|
| `m01-paisa-ledger-top.png` | Paisa / Ledger tab, first screen. Teal hero with "Paisa", CSV button, Ledger/Refunds/History switch, 30-day total, and the Aaj / Is hafte / Is mahine glass tiles. |
| `m02-paisa-ledger-full.png` | The whole Ledger scroll: outstanding tiles (Bookings par baqi / Refund dena hai), range chips, court chips, the payment row card with a "Theek karein" button on every row, and the tab bar. |
| `m03-aaj-today.png` | Aaj (Today) tab, first screen: venue switcher, date stepper, "Aaj aaya PKR 15,000" hero, the approvals nudge, the status-baqi banner and the start of the court timeline. |
| `m04-aaj-today-full.png` | The whole Aaj screen: courts timeline with booking blocks and "+ Add" free slots. |
| `m05-approvals.png` | Approvals tab: hero with a Baqi / Cancel-expire switch, payment cards (thumbnail, Chahiye vs Screenshot mein, warning banner, Approve / Reject). Uses FlashList. |
| `m06-booking-detail-sheet.png` | Booking detail bottom sheet, opened from a booking on Aaj: ID, pills, key/value block, Total / Mila / Baqi tiles, Waqt-nama, action buttons. |
| `m07-approvals-full.png` | Approvals, the whole scroll. |
| `m08-refunds.png` | Paisa → Refunds segment ("Refunds dene hain"): total hero and a refund card with reason, player number and "Bhej diya · record karein". |
| `m09-dues.png` | Baqi raqam (dues) stack screen, opened from Aur. It shows the empty state; see §3.3 for why it is empty while Ledger shows PKR 1,500 baqi. |
| `m10-aur-more.png` | Aur tab: hero profile card, BOOKINGS and PAISA groups (IconTile + ListRow), and the bottom tab bar with the centre + FAB. |
| `m11-aur-more-full.png` | Aur, the whole menu: Venue, Team aur growth, Account, language, help, logout. |
| `m12-history.png` | Bookings history, the third Paisa segment. |
| `w01-web-paisa-hisaab-ledger.png` | Web owner dashboard, Paisa → Hisaab tab (the redesigned web ledger): period chips Aaj / Is hafta / Is mahina, three tiles (Mila with cash/transfer split, Lena baqi, Wapas dena), court chips, and rows grouped by day with a "⋯" menu. |
| `w02-web-overview.png` | Web owner Overview ("Aaj ka jaiza"): filter bar, slots card, pending card, five KPI tiles, today's bookings table. |

---

## 1. Theme (Floodlight)

- Owner screens use **Floodlight** tokens: `T/tokens.ts`, `T/roles.ts` and `T/generated/*` (web gets the same values as CSS vars in `packages/ui-tokens/generated/theme.css`).
- **Light only.** There is no dark mode and no `useColorScheme`. `darkMode: "class"` exists in `M/tailwind.config.js` only to avoid a NativeWind crash. The only "dark" thing is the **teal gradient hero** at the top of every tab, with a light `ground` sheet overlapping it.
- `M/lib/colors.ts` (`ownerColors`, accent `#0E6274`) and the tailwind `owner-*` classes are **legacy** (pre-Floodlight). Current owner tabs don't use them.
- Screens style with inline `style={{}}` using token values, not NativeWind classes. All UI is imported from `@/components/ui` (`M/components/ui/index.ts`).

### 1.1 Colours (`T/tokens.ts` `palette`, lines ~15-74)

| Role | Token | Hex |
|---|---|---|
| Page background | `ground` | `#F4F6F5` |
| Surface / card | `white` | `#FFFFFF` |
| Sunken / key-value block | `ground` | `#F4F6F5` |
| Neutral pill / segmented track | `mist` | `#E8ECEB` |
| Text primary (ink) | `night` | `#0C1F1D` |
| Text body | `body` | `#3B4B48` |
| Text muted | `muted` | `#4A5D5A` |
| Text subtle | `muted2` | `#5B6E6B` |
| Text on dark | `onDarkMuted` / `onDarkSoft` | `#B9C6C3` / `#D5E0DE` |
| Border (cards) | `line` | `#DDE3E1` |
| Border (inputs / chips) | `lineStrong` | `#CFD8D6` |
| Row divider | `divider` | `#EEF2F1` |
| Skeleton / disabled fill | `bookedBg` | `#E1E7E5` |
| **Primary teal** | `teal` | **`#0E7C74`** |
| Teal deep (links, info fg, gradient mid) | `tealDeep` | `#0A5F59` |
| Teal tint (selected bg, info bg) | `tealTint` | `#E3F4F1` |
| Teal half | `tealHalf` | `#CFE9E5` |
| **Orange accent** | `orange` | **`#FF6A2B`** |
| Orange variants | `orangeTint` / `orangePeach` / `orangeDeep` / `orangeDeeper` | `#FFE7DB` / `#FFB48F` / `#B83E00` / `#8F3000` |
| **Success** ("open") | `open` / `openTint` | `#0B6B43` / `#DFF5EA` |
| **Warning** ("waiting") | `waiting` / `waitingTint` / `waitingBorder` | `#8A5A00` / `#FFF1D6` / `#B87300` |
| **Danger** | `danger` / `dangerTint` / `dangerBorder` | `#B42318` / `#FDE8E5` / `#F0C3BD` |
| **Info** | `tealDeep` on `tealTint` | `#0A5F59` / `#E3F4F1` |
| Decorative only (never text) | `mint` / `amber` / `glow` | `#3DDC97` / `#FFB020` / `#FFF1D0` |
| Banned as text (2.97:1) | `bannedGrey` | `#8A9996` |

Notes on the teal and orange:
- Teal is the owner role's primary colour.
- On owner screens, orange is used **only** for the notification/count badge (with ink text) and the "now" line on the timeline.

**Alpha colours** (`T/tokens.ts` ~79-115):

| Token | Value |
|---|---|
| scrim | `rgba(12,31,29,0.5)` |
| glassOnTeal (hero chips/tiles) | `rgba(12,31,29,0.16)` |
| glassOnTealBorder | `rgba(255,255,255,0.22)` |
| glassLight / glassLightStrong / glassLightBorder | white at 0.74 / 0.86 / 0.9 |
| glassDark / glassDarkBorder | white at 0.10 / 0.16 |
| softOnLight | `rgba(14,20,18,0.06)` |

**Owner role theme** (`T/roles.ts` ~68-97):

| Part | Value |
|---|---|
| Hero gradient | `linear-gradient(165deg, #0E7C74 0%, #0A5F59 55%, #0C1F1D 100%)` |
| Hero text | white; heroMuted is also white |
| primary button | teal bg, white fg, `ctaTeal` shadow |
| Active tab | teal pill, white |
| Idle tab | `body` |
| selected | tealTint bg, tealDeep fg, teal border |
| badge | orange bg, night fg |
| ring / focus | teal (white on hero) |
| gutter | 16 |

**Semantic sets** (`T/roles.ts`):

| Set | Lines | Contents |
|---|---|---|
| `surface` | 101-111 | page, card, sunken, border, divider, scrim |
| `text` | 113-125 | primary, body, muted, subtle, onDark, danger, open, waiting, info |
| `tone` | 128-137 | for Pill / Banner, each `{bg, fg, border, icon}`: open, waiting, danger, neutral (mist/body), info (tealTint/tealDeep), night (night/white, amber icon), accent (orangeTint/orangeDeep) |
| `buttonVariant` | 140-153 | secondary, quiet, soft, danger, dangerSolid, disabled |

### 1.2 Fonts

**Loaded** in `M/app/_layout.tsx`:
- **Bricolage Grotesque** 600 / 700 / 800 (display)
- **Plus Jakarta Sans** 400 / 500 / 600 / 700 / 800 (body)
- Figtree and IBM Plex are still loaded but legacy.

**Text component** (`M/components/ui/Text.tsx`):
- Props: `variant`, `tone`, `color`, `weight`, `align`, `strike`.
- Always sets `fontVariant: ["tabular-nums"]`, so every number is tabular. **Never monospace.**
- Sizes are multiplied by the user's font scale.

**Type scale** (`T/tokens.ts` ~206-223): size / lineHeight, weight, letterSpacing. "D" means Bricolage; everything else is Jakarta. "Black" means Jakarta 800.

| Variant | Spec | Used for |
|---|---|---|
| `displayXL` | 44/46 black D, -1.3 | `BigMoney` (centred money) |
| `display` | 36/38 black D, -1.08 | **Ledger hero total** `PKR 22,500` |
| `h1` | 34/36 D, -1 | Tab titles: "Paisa", "Aur", "Approvals" |
| `h2` | 26/30 D, -0.5 | Stack Header title |
| `h3` | 24/28 D, -0.4 | Sheet title |
| `title` | 20/25 D | Section titles, outstanding tiles' amount |
| `cta` | 17/22 black | |
| `bodyL` | 16/24 regular | |
| `bodyStrong` | 16/22 black | **Row amounts** |
| `button` | 15/20 black | |
| `body` / `bodyBold` | 14/20 regular / black | Row player name (bodyBold) |
| `meta` / `label` | 13/18 regular / black | |
| `caption` | 12/17 regular | Row sub-line (date · time · court · method) |
| `eyebrow` | 12/16 black, letterSpacing 1.2, uppercase | `GroupLabel` ("BOOKINGS", "PAISA") |
| `tab` | 11/14 black | Tab bar labels |

**Money formatting:**
- `` `PKR ${formatPKR(n)}` `` from `M/lib/format.ts`, which uses `toLocaleString("en-US")`.
- Or `formatPkr` from `T/rules/format.ts`, which prints "PKR 1,234" and uses a real "−" for negatives.

### 1.3 Spacing, radius, size, shadow, motion (`T/tokens.ts`)

- **space**: `{0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32}`. Gutter is 16. Common one-offs: 14 (row padding), 10, 6.
- **radius**: xs 8 · sm 12 · md 14 · input 16 · button 18 · tile 20 · card 24 · cardL 28 · sheet 30 · pill 999.
- **size**: tap 44 · ctaS 44 · ctaM 52 · cta 56 · input 56 · tabBarOwner 72 · fab 52 · icon 20 / 16 / 24.
- **shadow** (CSS `boxShadow` strings, used on RN too):

  | Name | Value |
  |---|---|
  | card | `0 8px 22px rgba(12,31,29,0.06)` |
  | cardSoft | `0 4px 12px rgba(14,20,18,0.05)` |
  | raised | `0 16px 40px …` |
  | popover | `0 18px 40px rgba(12,31,29,0.18)` |
  | ctaTeal | `0 8px 18px rgba(14,124,116,0.4)` |
  | segment | `0 2px 8px rgba(12,31,29,0.1)` |

- **motion**: fast 150 · base 200 · slow 250 ms.

### 1.4 Card styles actually used on owner screens

| Style | Recipe |
|---|---|
| `Card` (`M/components/ui/Card.tsx`) | Radius 24, padding 16. Variants: `raised` (white + shadow.card), `flat` (white + 1px `line`), `sunken` (ground), `night`. |
| Ledger list container | White, radius 24, `overflow:hidden`, shadow.card. Rows: padding 14, gap 12, 1px `divider` bottom border. |
| `GroupCard` (`_fl.tsx`) | White, radius 20, no border, no shadow. Used for Aur menu groups. |
| Hero glass tile | Radius 16, padding 12×10, glassOnTeal bg, 1px glassOnTealBorder. |
| Outstanding tiles | `waitingTint` or `dangerTint` bg, radius 20, padding 14, `title`-variant amount. |
| Board sheet over the hero (`HeroLayout`) | marginTop −28, top radius 30, ground bg, padding-top 20, side padding 16, gap 14. |

### 1.5 Components a Ledger screen can reuse

**From `M/app/(owner)/_fl.tsx`:**

| Export | Props / notes |
|---|---|
| `HeroLayout` | `{hero: ReactNode; children; testID?}`: teal hero plus the overlapping ground sheet. Put it in a ScrollView or as a FlashList `ListHeaderComponent`. |
| `HeroChip` | `{label; onPress?; accessibilityLabel?; testID?}`: glass pill on the hero. |
| `PaisaSwitch` | `{current: "ledger"\|"refunds"\|"history"; tone?: "dark"\|"light"}`: the segmented Ledger/Refunds/History switch, filtered by permissions. |
| `OwnerHeader` | `{title; subtitle?; eyebrow?; right?; onBack?; testID?}` |
| `IconTile` | `{icon; tone?: teal\|open\|waiting\|danger\|neutral}`: 40×40, radius 12. |
| `GroupLabel` | `{children: string}`: uppercase eyebrow. |
| `GroupCard` | `{children; style?; testID?}` |
| `KeyValue` | `{label; value; valueTone?; last?}` |
| `KeyValueBlock` | `{children}`: ground bg, radius 18. |
| `BigMoney` | `{value: string; tone?: "primary"\|"hero"; testID?}` |

**From `M/components/ui/*`** (barrel `@/components/ui`):

| Need | Component (file) | Key props |
|---|---|---|
| Text | `Text` (Text.tsx) | variant, tone, weight, align, strike |
| Card | `Card` (Card.tsx) | variant raised\|flat\|sunken\|night, padding 0\|3\|4\|5, radiusSize tile\|card\|cardL, onPress |
| List row | `ListRow` (Layout.tsx) | title, subtitle?, icon?, leading?, trailing?, onPress?, divider?, danger?. Min height 64, padding 12×14, chevron by default. |
| Money summary | `MoneyRows` (Layout.tsx) | rows: `{label, value, strong?, tone?: default\|open\|danger\|waiting, note?}[]` |
| Section header | `SectionHeader` (Layout.tsx) | title, subtitle?, actionLabel?, onAction? |
| Avatar | `Avatar` (Layout.tsx) | name, size?, tone?, uri? |
| Gradient hero | `Hero` (Layout.tsx) | children, topInset?, roundedBottom?, style? |
| Pill / badge | `Pill`, `StatusPill`, `Badge` (StatusPill.tsx) | Pill takes label, tone (Tone), icon?, size sm (26) \| md (30). Badge takes {count}. |
| Chips | `Chip` (Chip.tsx) | label, selected?, solid?, onPress?, icon?, count?, shape pill\|tile, block?, meta?. `solid` + owner gives a teal fill with "✓ ". |
| Segmented tabs | `SegmentedToggle<V>` (Controls.tsx) | options `{value,label,count?}[]`, value, onChange, accessibilityLabel, tone light\|dark\|role |
| Dropdown trigger | `SelectButton` (`M/components/overview/ui.tsx`) | label?, value, onPress, disabled?, compact? (chevron button) |
| Date picker sheet | `DateChooserSheet` (`M/components/overview/pickers.tsx`) | title?, value, onPick(date), onClose. Monday-first, Pakistan dates. |
| Multi-select sheet | `MultiSelectSheet` (pickers.tsx) | title, options `{id,label,sub?}[]`, value, allLabel, exclusiveFromAll?, onApply, onClose. Empty selection means "all". |
| Court tabs | `CourtTabs` (`M/components/court-tabs.tsx`) | tabs `{key,label}[]`, selectedKey, onSelect, onAdd? |
| Search box | `Input` (Input.tsx) | label (required), `leading` (search icon), `labelHidden`, help?, error?, prefix?, trailing? |
| Bottom sheet | `Sheet` (Sheet.tsx, @gorhom BottomSheetModal) | open, onClose, title?, eyebrow?, subtitle?, footer?, hideClose? |
| Bottom sheet (overview) | `BottomSheet` (`M/components/overview/ui.tsx`) | open?, title, eyebrow?, subtitle?, onClose, footer? |
| Buttons | `Button` (Button.tsx) | label, variant primary\|secondary\|quiet\|soft\|danger\|dangerSolid, size sm 44 \| md 52 \| lg 56, loading?, icon?, block? |
| Icon button | `IconButton` (IconButton.tsx) | icon, accessibilityLabel, variant plain\|surface\|mist\|onDark\|onPhoto\|primary\|night, badge? |
| Empty state | `EmptyState` (States.tsx) | title, body?, icon?, actionLabel?, onAction?. 72px tealTint icon box (see `m09`). |
| Error state | `ErrorState` (States.tsx) | title?, message?, onRetry, onBack?, reassurance?, code? |
| Banner | `Banner` (States.tsx) | tone info\|waiting\|danger\|open\|neutral, title?, body, icon?, action? |
| Skeleton | `Skeleton`, `SkeletonList`, `SkeletonCard` (Skeleton.tsx) | Skeleton: width?, height?, r?, shade strong\|soft\|photo |
| Tab bar padding | `useTabBarRoom()` (GlassBar.tsx) | Bottom padding so content clears the floating tab bar. |
| Floating action bar | `ActionBar` (TabBar.tsx) | caption?, value?, children |
| Toast | `useToast().show({message, tone})` (Toast.tsx) | |
| Screen wrapper | `Screen` (Screen.tsx) | scroll?, background, floatingBar, refreshing / onRefresh … |
| Theme / copy | `useRoleTheme`, `useCopy()(ru, en)`, `useLang` (theme.tsx) | |

**Owner money components:**

| Component | File | Notes |
|---|---|---|
| `MoneyHealthTiles({totals, title})` | `M/components/money-health-card.tsx` | White card, radius 24, 2-column grid. **Closest thing to a shared stat-tile.** There is no dedicated StatTile/KPI component; Ledger defines its own local `Tile`. |
| `VenueMoneyHealth({venueId})` | `M/components/money-health-card.tsx` | |
| `CorrectPaymentSheet({entry, onClose, onReversed})` | `M/components/correct-payment-sheet.tsx` | The "Theek karein" flow. |
| `RecordPaymentSheet` | `M/components/record-payment-sheet.tsx` | |
| `DueDoneSheet`, `NoShowReverseSheet` | `M/components/money-sheets.tsx` | |
| `BookingDetailSheet` | `M/components/booking-detail-sheet.tsx` | See `m06`. |

**Lists and icons:**
- `@shopify/flash-list` 2.0.2 is used **only** in Approvals (`M/app/(owner)/(tabs)/approvals.tsx`, with `HeroLayout` as the `ListHeaderComponent`). Ledger maps rows inside a ScrollView.
- Icons: **lucide-react-native**, e.g. CalendarDays, ShieldCheck, Wallet, Ellipsis, Download, ChevronRight, Receipt, RotateCcw. `M/components/icons.tsx` is a legacy custom SVG set.
- `M/components/error-state.tsx` is a legacy NativeWind ErrorState. Use `ui/States` instead.

### 1.6 Owner navigation

- **Stack** (`M/app/(owner)/_layout.tsx`):
  - Wrappers: `RoleProvider role="owner"`, `LangProvider`, `FontScaleProvider`, `ToastProvider`.
  - Declared screens: index, (tabs), walkin, history, staff, staff-activity, bank-check, dues, premium, notifications, venue-setup, account, change-phone.
  - Registered automatically: checkin*, growth, reviews, venue-settings.
- **Tabs** (`M/app/(owner)/(tabs)/_layout.tsx`):
  - `Tabs` navigator, initialRoute `today`, `backBehavior="firstRoute"`, custom `OwnerTabBar`.
  - Route files: `today.tsx`, `approvals.tsx`, `ledger.tsx`, `refunds.tsx`, `more.tsx`.
- **Tab bar** (`M/components/owner-tab-bar.tsx` + `M/lib/owner-floodlight.ts` ~29-75), order **Aaj · Approvals · [+] · Paisa · Aur**:

  | Tab | Icon | Route | Shown when |
  |---|---|---|---|
  | Aaj | CalendarDays | `today` | |
  | Approvals | ShieldCheck | `approvals` | badge = pending count |
  | Paisa | Wallet | `ledger` (or `refunds` if staff has only `mark_refunds`) | badge = refunds count; lit for both routes |
  | Aur | Ellipsis | `more` | always |

  - The **centre +** is a 52×52 teal FAB (radius 18, ctaTeal shadow). It pushes `/(owner)/walkin` and is shown only with the `walkin` permission. `TabBar.tsx` splices it in at `Math.floor(cells/2)`.
  - The bar is glass, min height 72. The active tab is a teal pill (radius 20). The badge is an 18px orange circle with ink text.
  - Badges poll `/owners/badges` every 15 s.
- **Aur menu** (`more.tsx`):
  - Hero: profile card with a "Profile" button.
  - Bookings: history, check-in, add booking.
  - **Paisa**: Ledger, Bank se mila lein (`/bank-check`), Baqi raqam (`/dues`), Refunds, Premium.
  - Venue: settings, CNIC.
  - Team aur growth: staff, staff activity, growth, reviews, notifications.
  - Account, language toggle, WhatsApp help, log out.

### 1.7 Web owner dashboard (brief)

- **Styling:** Tailwind v4, CSS-first. `W/app/globals.css` imports `generated/theme.css` (`--color-fl-*`, the same hex values as above). The `--color-owner-*` names are remapped onto the fl vars.
- **Fonts:** Bricolage Grotesque + Plus Jakarta Sans via next/font (`W/app/layout.tsx`).
- **Shell:** `W/components/owner/owner-shell.tsx`, with a 240 px sidebar. The active item is a teal fill; badges are orange.
- **Paisa page:** a single page, `W/app/dashboard/owner/paisa/page.tsx`, with `?tab=` set to `hisaab` | `bank` | `baqi` | `wapas`. The tab bodies are in `W/components/owner/paisa/{hisaab,bank,dues,refunds}-tab.tsx`. `/dashboard/owner/ledger` redirects to `paisa?tab=hisaab`.

---

## 2. Current Paisa / Ledger screen

### 2.1 Files

| | Path |
|---|---|
| Mobile Ledger (Paisa tab) | `M/app/(owner)/(tabs)/ledger.tsx` (261 lines) |
| Mobile Refunds segment | `M/app/(owner)/(tabs)/refunds.tsx` |
| Mobile History segment | `M/app/(owner)/history.tsx` |
| Mobile Dues / Bank check (only reachable from Aur) | `M/app/(owner)/dues.tsx`, `M/app/(owner)/bank-check.tsx` |
| Paisa switch + hero layout | `M/app/(owner)/_fl.tsx` (`PaisaSwitch`, `HeroLayout`) |
| Correction sheet | `M/components/correct-payment-sheet.tsx` |
| Web Paisa page | `W/app/dashboard/owner/paisa/page.tsx` |
| Web ledger (Hisaab tab) | `W/components/owner/paisa/hisaab-tab.tsx` |
| API client | `packages/api-client/src/owners.ts` (`ledger`, `ledgerExportCsv`) |
| Types | `packages/types/src/owner.ts` (`Ledger`, `LedgerEntry`, `LedgerSummary`) |

### 2.2 API

**`GET /api/v1/owners/ledger?start_date&end_date&venue_id&court_id`** returns `Ledger`:

```ts
Ledger = { entries: LedgerEntry[]; summary: LedgerSummary }

LedgerEntry = {
  entry_id, recorded_at, court, court_id?, court_sport?, booking_id, starts_at,
  player: string|null,              // null => "Walk-in"
  method,                           // "bank_transfer_proof" | "cash_at_venue" | "other"
  entry_type?: "payment"|"refund"|"correction", label?, note?,
  amount_pkr,                       // negative for refund/correction
  running_total,
  booking_status,                   // booked|completed|payment_submitted|cancelled|no_show|held
  paid_before_pkr?, paid_after_pkr? // on corrections: booking's total paid before -> after
}

LedgerSummary = {
  collected_today, collected_this_week, collected_this_month,   // always "now"-relative, ignore range & court filter
  outstanding_balance, cancelled_refund_pending,
  total_in_range,                                               // respects range + filters
  by_court: Record<courtName, number>, by_day: Record<"YYYY-MM-DD", number>
}
```

Other endpoints:
- CSV: `GET /owners/ledger/export` (same params). Mobile shares it with `shareCsv`.
- Correction: `POST /payment-entries/{id}/reverse`. Needs permission `record_payments` and flag `split_payments`.
- Related:
  - `GET /owners/refunds?venue_id&date&court_ids` (Refunds)
  - `GET /owners/dues?venue_id` (Dues: short-payment claims)
  - `GET /owners/badges` (tab badges)
- Permissions: `view_ledger` to see the screen (otherwise `NoAccess`). The Refunds segment needs `mark_refunds`.
- React Query key: `["owner-ledger", venueId, courtId, start, end]`. It only polls while focused (`subscribed: useIsFocused()`). Pull-to-refresh is on.

### 2.3 What the mobile screen shows, top to bottom (`m01`, `m02`)

1. **Teal hero** (`HeroLayout`):
   - Row: `h1` "Paisa" on the left; glass pill button "⬇ CSV" on the right (shows "Ban raha hai" while exporting; disabled when there are no entries).
   - `PaisaSwitch`: dark segmented control **Ledger | Refunds | History**.
   - Headline (`bodyBold`), for example "Pichle 30 din mein mila", which follows the range chip.
   - `display` total: `PKR {summary.total_in_range}`, or a skeleton while loading.
   - `meta`: "9 payments".
   - Three glass tiles: **Aaj** `collected_today` · **Is hafte** `collected_this_week` · **Is mahine** `collected_this_month`. The numbers have no "PKR" prefix.
2. **Ground sheet:**
   - Optional `Banner` (danger) "Export nahi hua".
   - Outstanding tiles, shown only when > 0:
     - **Bookings par baqi** (`outstanding_balance`, waiting tint) opens History filtered to `booked`.
     - **Refund dena hai ›** (`cancelled_refund_pending`, danger tint) opens the Refunds tab.
   - Range chips: **7 din · 30 din (default) · Is mahine** (solid teal when selected, with ✓).
   - Court chips (only when the venue has more than one court): **Sab courts · Court 1 · padel · Futsal Pitch · futsal**. These wrap onto 2-3 lines.
   - States: 3 skeleton rows (h72, r20), then `ErrorState` with retry, then `EmptyState` "Is muddat mein koi payment nahi".
   - **Rows card** (white, r24, shadow): one row per entry, newest first (`entries.slice().reverse()`).
     - Left side:
       - Player name (`bodyBold`; "Walk-in" if null)
       - Caption `Tue, 10 Nov · 10:40 PM · Court 1 · padel · Cash`
       - Pills: status (Paid/open · Mukammal/info · Review/waiting · Cancelled/danger · No-show/neutral · Hold/neutral), plus "Refund" or "Correction" in danger
       - Refund note
     - Right side: amount (`bodyStrong`, red with "-" for corrections), and a **"Theek karein"** quiet button on every non-correction row when allowed.
3. `CorrectPaymentSheet` opens over the screen. On success it invalidates the owner money queries.
4. Floating owner tab bar: content is padded with `useTabBarRoom()`.

### 2.4 Web Hisaab tab, for comparison (`w01`)

The web ledger was redesigned in fix/nov-7. The mobile Ledger was **not** brought along. Web has:
- Period chips **Aaj (default) / Is hafta / Is mahina** instead of 7 / 30 days.
- **3 tiles:**
  - **Mila** with a **Cash / Transfer split**
  - **Lena baqi** (warn)
  - **Wapas dena** (danger)
  - Each tile opens its list.
- Rows **grouped by day** with a day header and "Kul PKR …".
- `+`/`−` signed amounts, the entry kind as text (Cash / Transfer / Refund / "Raqam theek ki gayi 3,000 → 1,000").
- A **"⋯" row menu** for "Ghalti theek karein" instead of a button on every row.
- Paisa tabs: Hisaab · Bank check · Lena baqi · Wapas dena. On mobile, Bank check and Dues are only in the Aur menu.

### 2.5 Missing, inconsistent or broken (observed)

1. **Mobile and web disagree.** Different periods (7d / 30d / month vs Aaj / hafta / mahina), different tiles, no day grouping on mobile, no cash/transfer split on mobile, and different Paisa sections (mobile Ledger/Refunds/History vs web Hisaab/Bank check/Lena baqi/Wapas dena).
2. **Unused data.** `summary.by_day` and `summary.by_court` come back from the API but mobile never shows them. `running_total`, `paid_before_pkr` / `paid_after_pkr` (the correction old → new text) and `label` are not shown either.
3. **Confusing numbers.**
   - The hero total follows the range and court filter, but the Aaj / Hafte / Mahine tiles directly under it ignore both (they are "now"-relative).
   - The hero tiles have no "PKR".
4. **"Theek karein" on every row** (`m02`), including the row of a **cancelled** booking. It is visually heavy: a large grey button repeated 9 times. Web hides it behind "⋯".
5. **Performance and scale.** All rows are `.map`ped inside a ScrollView. There is no FlashList, no pagination and no search. A 30-day range at a busy venue renders hundreds of rows. Rows are reversed on the client.
6. **Filters take a lot of space.** Range chips plus court chips wrap onto 3 lines before the first row (`m02`). There is no dropdown or `SelectButton` and no date picker, even though `SelectButton`, `DateChooserSheet` and `MultiSelectSheet` already exist.
7. **"Baqi" means two different things.**
   - The Ledger tile "Bookings par baqi PKR 1,500" (`outstanding_balance`) opens History.
   - The Aur → "Baqi raqam (dues)" screen showed **"Koi baqi nahi"** at the same moment (`m09`). It lists short-payment *claims* (`/owners/dues`), not booking balances.
   - Same word, different numbers.
8. **Bank check and Dues are not in the Paisa switch** on mobile; they are only reachable through Aur.
9. **Web-only routing bug (Expo web).** Opening `/refunds` directly lands the owner on **Today**, because the URL is shared with `(admin)/refunds.tsx`. The PaisaSwitch tab works because it navigates by group path. Native is not affected.
10. **Sample-data observation, not verified as a product bug.** A walk-in was accepted with `amount_paid` 4,000 on a 2,000 booking. The detail sheet then shows Total 2,000 / Mila 4,000 / Baqi 0 (`m06`), and the ledger counts the full 4,000. Worth a check if overpayment on walk-ins should be capped or turned into a refund.
