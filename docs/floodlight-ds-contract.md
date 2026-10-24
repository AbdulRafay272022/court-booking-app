# Floodlight design system: contract for screen agents (M1 / M2 / W1)

Phase C (agent DS, branch `floodlight-ds`). Source of truth for values: `design/khelo-mobile-floodlight/System.dc.html` + README role table.
Screen agents **consume** this system; they do not add shared components (ask the lead). Screens set **no colours, fonts or radii of their own**.

## 1. Where things live

| What | Path | Import |
|---|---|---|
| Tokens (the ONLY place with hex) | `court-booking-frontend/packages/ui-tokens/src/tokens.ts`, `roles.ts` | `import { palette, role, space, radius, type, motion, tone, slot } from "@court-booking/ui-tokens"` |
| Pure rules (tested) | `packages/ui-tokens/src/rules/*.ts` (carousel, slot, status, countdown, format, amenities, platform, venue) | same package |
| Contrast math + pair list | `packages/ui-tokens/src/contrast.ts`, `pairs.ts` | same package |
| Generated Tailwind / CSS | `packages/ui-tokens/generated/tailwind.cjs` (mobile NativeWind), `generated/theme.css` (web Tailwind 4) | do not edit; `npm run generate --workspace=@court-booking/ui-tokens` |
| Mobile components | `apps/mobile/components/ui/*` | `import { Button, Sheet, ... } from "@/components/ui"` |
| Web components | `apps/web/components/fl/*` | `import { Button, Sheet, ... } from "@/components/fl"` |
| Dev galleries | mobile `app/dev/components.tsx` (`/dev/components?role=owner&lang=en&fs=1.3`, redirects when `!__DEV__`); web `app/dev/components/page.tsx` (`/dev/components?role=owner`, 404 when `NODE_ENV=production`) | |

## 2. Token shape

- `palette`: night `#0C1F1D`, white, ground `#F4F6F5`, mist, line, lineStrong, divider, bookedBg; text greys body `#3B4B48`, muted `#4A5D5A`, muted2 `#5B6E6B`, onDarkMuted `#B9C6C3`, onDarkSoft; orange `#FF6A2B`, orangeTint, orangePeach, orangeDeep `#B83E00`, orangeDeeper; teal `#0E7C74`, tealDeep `#0A5F59`, tealTint `#E3F4F1`, tealHalf, scanFrame; status open/openTint, waiting/waitingTint/waitingBorder, danger/dangerTint/dangerBorder; mint, amber, glow; `bannedGrey #8A9996` (exists only so tests can assert it is unused).
- `alpha`: scrim, glass (light/dark + borders), onPhoto (0.62, raised from the board's 0.38 so white text passes even on a white photo), heartOnPhoto (0.5), dot, arrow, ring tracks, ...
- `role.player` / `role.owner` (`RoleTheme`): `primary{bg,fg,border,shadow}`, `tabActive`, `tabIdle`, `selected`, `slotSelected`, `slotInRange`, `hero{bg,fg,fgMuted,gradient,stops}`, `link`, `accentText`, `focusBorder`, `control`, `switchOn`, `fab` (owner only), `badge` (orange + ink on BOTH roles), `nowLine`, `ring`, `ringOnHero`, `gutter` (20 / 16).
- `surface`, `text`, `tone` (open | waiting | danger | neutral | info | night | accent, each `{bg, fg, border, icon}`), `buttonVariant`, `slot`, `glass`.
- `space` {0,1:4,2:8,3:12,4:16,5:20,6:24,8:32} (keys = Tailwind numbers), `radius` {xs 8, sm 12, md 14, input 16, button 18, tile 20, card 24, cardL 28, sheet 30, pill 999}, `size` {tap 44, ctaM 52, cta 56, input 56, tabBar 70/72, fab 52}, `shadow` (CSS strings; mobile uses RN `boxShadow`), `motion` {fast 150, base 200, slow 250, slide 400, autoplay 3500, resumeAfterTouch 6000}.
- `type` variants: displayXL 44, display 36, h1 34, h2 26, h3 24, title 20 (Bricolage) · cta 17, bodyL 16, bodyStrong 16, button 15, body 14, bodyBold 14, meta 13, label 13, caption 12, eyebrow 12, tab 11 (Plus Jakarta). Always tabular numbers, never monospace.
- Web utilities (theme.css): `bg-fl-<palette-kebab>`, `text-fl-…`, `border-fl-…`, `bg-fl-a-<alpha-kebab>`, `rounded-fl-<radius>`, `shadow-fl-<shadow>`, `font-fl-display|body`, `ease-fl`, and role-aware `bg-fl-role-primary text-fl-role-on-primary bg-fl-role-selected border-fl-role-selected-border text-fl-role-link stroke-fl-role-ring ...` (resolve through `data-fl-role`).
- Mobile NativeWind classes (if you must use className): `bg-fl-night`, `text-fl-orange-deep`, `rounded-fl-card`, `font-fl-body-black`. Prefer the components.

## 3. Role theme (by route group, never per screen)

- Mobile: `app/(player)/_layout.tsx` and `app/(auth)/_layout.tsx` mount `<RoleProvider role="player">`, `app/(owner)/_layout.tsx` mounts `<RoleProvider role="owner">` (+ `<ToastProvider>` in each). Read with `useRole()` / `useRoleTheme()`. Never pass a role or colour from a screen.
- Web: context-only `<FlRoleProvider role="owner">` in `app/dashboard/owner/layout.tsx` and inside `app/venue-setup/layout.tsx`; everything else defaults to player. Every fl component writes `data-fl-role` on its root; `theme.css` maps it to CSS vars.
- Language: mobile `<LangProvider lang>` (default `"ru"`, no app-wide toggle exists yet; wrap a subtree if you add one); web uses the site cookie via `components/i18n/lang-provider`. Built-in copy is Roman Urdu with EN.

## 4. Components (mobile and web share names + props; differences noted)

| Component | Key props | Notes |
|---|---|---|
| `Text` (mobile) | `variant`, `tone` (primary/body/muted/subtle/onDark/onDarkMuted/danger/open/waiting/info/link/accent/hero/heroMuted/inherit), `weight`, `align`, `strike` | The only text primitive in components/ui. Web: use `font-fl-*` + `text-fl-*` classes. |
| `Screen` (mobile) | `scroll`, `background`, `gutter`, `edgeToEdgeTop`, `floatingBar: "tabs"\|"bar"`, `keyboard`, `refreshing/onRefresh`, `overlay` | Safe areas + role gutter + room under floating bars. |
| `Header` (mobile) | `title`, `eyebrow`, `subtitle`, `onBack`, `right`, `tone: light\|dark`, `size: large\|compact` | 44pt back ("Wapas"), title wraps. |
| `Hero` (mobile) | `children`, `topInset`, `roundedBottom` | Player night, owner teal gradient. Use `tone="hero"/"heroMuted"` text inside. |
| `Button` | `label`, `variant: primary\|secondary\|soft\|danger\|dangerSolid`, `size: sm\|md\|lg`, `loading`, `disabled`, `icon`, `block`; mobile `onPress`, `haptic` (default light, `false` off); web `onClick` + button attrs | **primary is role-aware**: player orange + ink, owner teal + white. One primary per screen. |
| `IconButton` | `icon`, **`accessibilityLabel` (mobile) / `aria-label` (web) required by the type**, `variant: plain\|surface\|mist\|onDark\|onPhoto\|primary\|night`, `badge` | 44 round. Put the count in the label ("Approvals, 3 baqi"). |
| `Card` | `variant: raised\|flat\|sunken\|night`, `padding 0\|3\|4\|5`, mobile `onPress` | |
| `Chip` | `label`, `selected`, `onPress/onClick`, `disabled`, `icon`, `count`, `shape: pill\|tile`, `meta` | Selected = role tint + 2px border + "✓ ". |
| `Pill`, `StatusPill`, `Badge` | `Pill{label, tone, size}`, `StatusPill{booking: {status, cancelled_by?, cancellation_reason?}}`, `Badge{count}` | StatusPill uses `statusPill()`: "Pakki ✓" only for `booked`. |
| `SlotChip` | `state` (from `slotChipState(slot, ctx)`), `label` (PKT time from shared formatters), `onPress/onClick`, `reason` | States open/selected/inRange/held/booked/noRoom/blocked/mine, each with a non-colour cue; only open/selected/inRange/mine press. |
| `Sheet` | `open`, `onClose`, `title`, `subtitle`, `footer` (confirm button; last block of the content on mobile, sticky on web), `children`, `hideClose` (mobile) | Mobile = `@gorhom/bottom-sheet` BottomSheetModal (dynamic height, scrolls, backdrop, pan down, 44pt "Band karein", reduce-motion), works on Expo web. Web = native `<dialog>`: bottom sheet < 640px, centered dialog above; Esc / backdrop close. |
| `Input` | `label` (always visible), `help`, `error`, `prefix` ("+92"), `trailing`, `secureToggle`, `multiline` (mobile), + TextInput / input props | Role focus border, error announced. Forms: `<Screen keyboard>`. |
| `Skeleton`, `SkeletonCard`, `SkeletonList` (mobile) | `width/height/r/shade` (mobile), `className/shade` (web) | Pulse off with reduce-motion. Loading never shows "0". |
| `EmptyState` | `title`, `body`, `icon`, `actionLabel/onAction` | |
| `ErrorState` | `onRetry` (req), `onBack` + `backLabel`, `title`, `message`, `reassurance` (only if true for the screen), `code`, mobile `showTopBack` | "Dobara koshish" + back, Roman Urdu default / EN. |
| `NotFound` | `onHome`, `title`, `body` | "Out!" night screen. |
| `OfflineBanner` | `visible`, `onRetry`, mobile `placement: overlay\|inline` | Wire `visible` to `useNetworkStatus() === false`. The old root banner (`components/offline-banner.tsx`) is unchanged; M1/M2 decide when to switch. |
| `Banner` | `tone: info\|waiting\|danger\|open\|neutral`, `title`, `body`, `icon`, `action` | |
| `Toast` / `useToast()` | `toast.show({ message, tone: neutral\|success\|danger, duration })` | Provider is in the role layouts (mobile); web: wrap with `<ToastProvider>` where needed. |
| `Stepper` | `label`, `value`, `onChange`, `min`, `max`, `step`, `unit`, `help` | Accessible adjustable. |
| `CountdownRing` | `expiresAt` (**real** `held_until`), `totalMs` (`windowMs(created_at, held_until)`), `caption`, `tone: dark\|light`, `diameter`, `onExpire` | mm:ss from `countdown()`. Owner ring is white on the teal hero. |
| `Timeline` | `steps: {label, sub?, state}[]` — pass `journeySteps(booking, lang)` | Hold → Screenshot bheja → Venue check → Pakki; failed state for reject/expire. |
| `StepBar`, `StepNumber` (mobile) | `labels`, `current`, `tone` / `n` | Pay hero bar; numbered step disc. |
| `MoneyRows` | `rows: {label, value (formatPkr), strong?, tone?, note?}[]` | Total / Mila / Baqi. Real API values only. |
| `Ticket` | `bookingId` (QR content = booking UUID), `booking` (status), `venueName`, `eyebrow`, `fields[]`, `qrTitle`, `qrBody`, mobile `footer`, `pageColor` | QR only when `status === "booked"`; otherwise an honest "QR pakki booking par milega". |
| `GlassBar` (mobile) | `tone: light\|dark`, `floating`, `solid` | expo-blur; SOLID on web, reduce-transparency, Android < 12 or < 4 GB RAM (`glassMode`). |
| `TabBar` (mobile) | `items: {key,label,icon,active,badge,accessibilityLabel,onPress}[]`, `fab` (owner + walk-in), `floating` | Presentational: plug into expo-router `<Tabs tabBar={(props) => <TabBar items={...} />}>`. Labels shrink to fit at 320 + large font. |
| `ActionBar` (mobile) | `caption`, `value`, `children` (buttons), `floating` | Floating Book / Pay / Approve bar; solid (money is on it). |
| `SectionHeader`, `ListRow`, `Avatar` (mobile) | see props in `Layout.tsx` | Menu rows min 64, chevron when pressable. |
| `SegmentedToggle` | `options[{value,label,count?}]`, `value`, `onChange`, `accessibilityLabel`/`aria-label`, `tone: light\|dark\|role` | List/Naqsha, Player/Owner, Aane wali/Purani, language. |
| `Checkbox`, `Switch`, `RadioGroup` (mobile) | `checked/value`, `onChange`, `label`, `hint`, RadioGroup `danger` | Whole row = 44 target. |
| `OtpInput` (mobile) | `value`, `onChange`, `length=6`, `error` | One hidden TextInput behind 6 boxes (`testID="otp-input"`, e2e uses `keyboard.type`). |
| `CopyField` (mobile) | `label`, `value`, `copyLabel`, `onCopied` | expo-clipboard + success haptic, "Copy ho gaya". |
| `VenueCard` | `venue: VenueCardData` (build with `venueCardData(summary, {sport})`), mobile `onPress`, `visible`, `times`, `onMoreTimes`; web `href`, `eager`, `action {label, href}`, `times`; both `saved`, `onToggleSave` | Photos: 0 = court placeholder, 1 = static, ≥2 = 3.5 s autoplay only while visible, pause on touch/hover/focus, resume 6 s after touch, off with reduce-motion and in background / hidden tab, prefetch next only. ONE "Amenities [n]" chip (hidden at 0). Heart 44. |
| `useVenueCardViewability()` (mobile) | returns `{ listProps, isVisible(id) }` | Spread `listProps` on FlatList/FlashList, pass `visible={isVisible(item.id)}`. Without it, cards never autoplay (manual swipe still works). |
| `AmenitiesSheet` (mobile) / `AmenitiesPopover` (web) | `venueName`, `amenities` (raw API strings) | Sheet: 2-col icon grid + "Ye list venue owner ne khud dali hai". Popover: hover/focus/click, opens upward, Esc closes, `role="dialog"`, `aria-haspopup`. |
| `AMENITY_ICONS` | icon id → lucide icon | Unknown amenity → check icon + the text as given. |

## 5. Rules for screen agents

1. Use `Button variant="primary"` for the one main action; never set colours, fonts, radii or shadows on screens. No hex / rgba in screens you touch.
2. Orange never carries white text; owner screens never get an orange primary (only `Badge` and the "now" line).
3. Booking labels come from `statusPill` / `journeySteps` / `isConfirmed`. Never write "Pakki", "Court aap ka hai" or "confirmed" yourself.
4. Slot chips: always `slotChipState(slot, { now, selectedStart, inRange, fits })`; `null` = do not render (past free slot).
5. Countdown from `booking.held_until` only. Money from the API, formatted with `formatPkr`. Times with the shared PKT formatters.
6. Venue cards: `venueCardData()`; `nextFree` stays null unless you have a real time (list API has none: contract B-dependency); rating hidden without reviews; `priceFrom` null → "Price abhi nahi".
7. No `numberOfLines` / `truncate` on money, time, names, phones. Wrap. Check 320 pt + large font.
8. Every icon-only control has a label (the type enforces it on `IconButton`).
9. Animations: components already respect reduce-motion; if you animate something yourself, check `useReduceMotion()` (mobile) / `useReducedMotion()` or `motion-reduce:` (web).
10. Glass only via `GlassBar` / `TabBar`; money and body text never sit on blur (`ActionBar` is solid).
11. Mobile test files stay `lib/*.test.ts` / `components/*.test.ts` (node:test, no RN imports). Shared pure logic you need belongs in `packages/ui-tokens/src/rules` (ask the lead first: Phase D agents must not edit packages).

## 6. Tests and gates

- Mobile unit tests (from `apps/mobile`): `npx tsx --test lib/*.test.ts components/*.test.ts`. DS added `lib/fl-rules.test.ts` (carousel 0/1/2/8 photos, touch pause + 6 s resume, hover/focus, reduce-motion, background; slot mapping; status honesty; journey; countdown; money; amenities; glass; venue card data) and `lib/fl-contrast.test.ts` (System-board ratios, every component colour pair ≥ 4.5 text / ≥ 3 UI, exempt list with reasons, no white-on-orange, no orange primary on owner, banned grey unused, generated files in sync, **no hex/rgba literal in `components/ui`, `app/dev`, web `components/fl`, web `app/dev`**). Print the full contrast table with `FL_CONTRAST_REPORT=1`.
- Mobile tsc: `npx tsc --noEmit -p apps/mobile`. Web: `npm run typecheck --workspace=@court-booking/web`. Root: `npm run check:time-inputs`.
- Expo web must be restarted after code changes when started with `CI=1` (Metro runs without watch mode in CI).
- `npm run generate --workspace=@court-booking/ui-tokens` after any token change (the sync test fails otherwise).

## 7. Known limits / decisions

- `@gorhom/bottom-sheet` trap: calling `dismiss()` on a never-presented `BottomSheetModal` leaves it in DISMISSING and a later `present()` never renders. `Sheet` only dismisses what it presented. Use `Sheet`, not BottomSheetModal directly.
- No photo thumbnails exist (contract B4): cards load full-size URLs (expo-image `memory-disk`, web lazy except first 2).
- `AMENITY_OPTIONS` (owner picker) is unchanged; the extra keys are in `AMENITY_KEYS_ALL` + `AMENITY_LABELS` (`packages/types`). Adopting them in the pickers is a screen decision.
- Owner hero muted text is white (onDarkSoft on the teal stop is 3.74:1). Photo overlays are darker than the board (0.62 / 0.5) to keep text/icons readable on bright photos.
- Contrast exemptions (all UI, all below 3:1 on purpose, state carried elsewhere): input resting border, card lines, player selected border on tint, player focus ring on white, player checkbox fill, switch off track, noRoom dashed border, held dashed border, idle carousel dot. Listed in `pairs.ts` `EXEMPT_PAIRS`.
- Needs a real phone: blur performance + fallback on low-end Android, haptics, swipe vs vertical scroll in lists, bottom-sheet keyboard behaviour, expo-image caching, OS large-font rendering.

## 8. QA evidence (DS phase)

Screenshots in `docs/floodlight-qa/ds/`: mobile dev page on Expo web at 390x844 (player, owner, EN) and at 320 wide with font x1.3
(`?fs=1.3`: the in-app FontScaleProvider, because Expo web has no OS font scale; on a phone the OS setting scales text the same way),
the confirm Sheet and the AmenitiesSheet for both roles; the web dev page at 390 and 1280 (both roles), the amenities popover and the sheet/dialog.
Scripted checks on both pages: no horizontal overflow, no ellipsis, sheet opens and closes, autoplay advances, hover pauses + arrows,
next arrow moves, popover opens above the chip inside the viewport, Esc closes, keyboard focus opens it.
