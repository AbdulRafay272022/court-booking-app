# VenueCard contract: data part (agent BE)

STEP 0 of `design/khelo-mobile-floodlight/venue-card-photos-amenities-prompt.md`. Findings come from main `1fdef6b`.
**No API change was needed:** the data exists and the list endpoints already return it. A contract test pins this:
`court-booking-backend/tests/test_venue_card_contract.py`.
The component props and the list of replaced files are for the screen agents (W1/M1) to fill in below.

## a) Photos: a venue has MULTIPLE photos

- **Database:** `venues.photos` is `ARRAY(Text)`, an ordered list of S3 keys (`court-booking-backend/app/models/venue.py:39`). Index 0 is the cover.
  - There is no separate table, so no N+1 can come from it. The photos load with the venue row.
- **Cap:** `MAX_VENUE_PHOTOS = 8` (`app/services/venue_service.py:28`). An upload past 8 returns 400 `PHOTO_LIMIT_REACHED` (`venue_service.py:151-158`).
- **Order:** the owner sets it with `PUT /venues/{id}/photos {photos: keys[]}` (`venue_service.py:161-170`).
- **URLs:** `public_url(key)` gives the CloudFront URL, or the S3 URL when CloudFront is not configured (`app/utils/s3.py:66-69`).
- **Thumbnails: none.** A photo is uploaded once at one size (`utils/s3.py:54-57`). No resize step and no variant keys exist.
  - Cards must use the same URL as the venue page and let `expo-image` / `next/image` scale it down.
  - **BACKEND DEPENDENCY (B4):** real ~720 px thumbnails need resize-on-upload or a CDN image transform. That is an infra change, not a column.
- **Where owners set photos:**
  - Mobile: `apps/mobile/app/(owner)/venue-settings.tsx`, `venue-setup/pending.tsx`.
  - Web: `apps/web/app/dashboard/owner/settings/page.tsx`, `venue-setup/status/page.tsx`.
  - API: `POST /venues/{id}/photos` (multipart `file`) and `PUT /venues/{id}/photos`. Both need the `photos` flag and the `manage_photos` permission.
- **Court photos also exist.** `courts.photos` is an ARRAY with the same rules and is exposed as `CourtOut.photo_urls`. The card does not use them.

## b) Amenities: they EXIST

- **Database:** `venues.amenities` is `ARRAY(String(50))`, nullable, free strings (`app/models/venue.py:38`).
- **Known keys:** `AMENITY_OPTIONS` = `floodlights, parking, washrooms, changing_room` (`court-booking-frontend/packages/types/src/sports.ts:16-21`).
  - Labels come from `AMENITY_LABELS` (`packages/types/src/locale-text.ts:89`) through `amenityLabel(key, lang)` (`sports.ts:23-30`).
  - An unknown key gets a prettified label (`_` replaced by a space, first letter capitalised).
- **Where owners set them:**
  - Wizard: mobile `app/(owner)/venue-setup/register.tsx` and `courts.tsx`; web `app/venue-setup/register/page.tsx` with `components/setup/amenities-picker.tsx`.
  - Settings: mobile `app/(owner)/venue-settings.tsx`; web `app/dashboard/owner/settings/page.tsx`.
  - API: `POST /venues` and `PATCH /venues/{id}` take `amenities: string[]` (`app/schemas/venue.py:96,116`).
- **Search filter:** `GET /venues?amenities=a,b` requires ALL the listed amenities, case-insensitive (`venue_service.py:215-220`). This is today's "Sahooliat" filter. Renaming it to "Amenities" is a copy change only.
- **Keys the design wants but the picker lacks:** drinking water, cafe, indoor, seating, wifi, equipment rent, prayer area.
  - These are a **frontend-only** addition to `AMENITY_OPTIONS`, with no migration, because the column holds free strings.
  - "indoor" is already a court field (`has_indoor` on the card). Do not duplicate it as an amenity.

## Which endpoint returns what

| Surface | Endpoint | Photos field | Amenities field |
|---|---|---|---|
| Search results (list) | `GET /venues` (`api/venues.py:45`) → `VenueListItemOut` | `photo_urls: string[]`, **all** photos, in owner order, max 8, `[]` if none | `amenities: string[]`, `[]` if none (`schemas/venue.py:225-226`, built at `venue_service.py:434-435`) |
| Map ("Naqsha") | same `GET /venues` (items carry `latitude`/`longitude`) | same | same |
| Home "tonight" | there is no dedicated endpoint. Use `GET /venues?date=<today>[&start_time=HH:MM]` | same | same |
| Saved / favourites | `GET /users/me/favorites` (`api/favorites.py:12`) → the same `VenueListItemOut` builder (`VenueService.to_list_item`) | same | same |
| Venue detail | `GET /venues/by-slug/{slug}` and `GET /venues/{id}` → `VenuePublicOut` | `photo_urls` (all) + `photo_keys` | `amenities: string[] \| null`, **nullable on detail**, so treat null as `[]` |

- **N+1:** the list builder is bulk. It uses 1 grouped ratings query plus a fixed number of queries for free slots, and `photos`/`amenities` are columns on the venue row itself (`venue_service.py:420-446`). `tests/test_venue_search_phase2.py` already checks the query count.
- **Types:** `VenueSummary.photo_urls: string[]` and `amenities: string[]` already exist in `court-booking-frontend/packages/types/src/venue.ts:13-37`. `Venue.amenities` is `string[] | null`. **No change to the types package was needed.**
- **Today's cards use only the cover:** web `components/discovery/venue-card.tsx:54-58` (`photo_urls[0]`), mobile `app/(player)/_components.tsx:57` (search card) and `components/saved-venues.tsx:56` (saved list). The venue page already shows all photos (`app/(player)/venue/[slug].tsx:74`). The carousel just has to use the whole array.

## Props mapping for `VenueCard` (from the API; nothing invented)

| Prop | Source |
|---|---|
| `id`, `slug`, `name` | the same fields |
| `sport` | `sports[0]` or the active search sport. The full list is `sports[]`. |
| `area` | `area ?? city` |
| `distance?` | `distance_meters`. It is null without lat/lng, so hide it then. |
| `rating?` | `average_rating`, with `review_count`. If `review_count === 0`, show no rating. |
| `priceFrom` | `min_price`. It is PKR per 30-minute slot of the cheapest active court and can be null. Null means "no price yet", never 0. |
| `nextFree?` | Use `today_free_slots` (count only; null = unknown). **The next free TIME is not in the list response.** Showing "next free 7:00 PM" needs an availability call per venue (avoid on lists) or a new field (B-dependency). |
| `photos: string[]` | `photo_urls` |
| `amenities: string[]` | `amenities`, labelled with `amenityLabel(key, lang)` |
| extras | `has_indoor`, `has_outdoor` (court-derived) |

## Web screens using VenueCard (agent W1, branch `floodlight-web`)

| Surface | File | How |
|---|---|---|
| /search results grid | `apps/web/app/search/page.tsx` | `components/discovery/venue-card.tsx` wraps the fl `VenueCard`: `venueCardData(summary, { sport: filters.sport })`, `eager` for the first 2 cards, heart = `useFavoriteToggle()` (hidden for owners/admins, signed out goes to login), opening a card remembers the search for "Back to results". |
| Saved venues (Account > Saved, bookings strip) | `apps/web/components/bookings/saved-venues.tsx` | same wrapper, data from `GET /users/me/favorites`. |
| Search loading | `apps/web/app/search/loading.tsx` | fl `SkeletonCard`. |
| Venue detail hero | `apps/web/components/photo-gallery.tsx` | NO autoplay: swipe (touch), 44px arrows, arrow keys, thumbnails, "1/6" counter; click the photo = full-screen gallery (Esc / Close / backdrop). Pure helpers in `lib/gallery-nav.ts` (tested). |
| Venue page amenities | `apps/web/components/amenity-badges.tsx` | full list with the same `amenityItems()` + `AMENITY_ICONS` as the popover. |

Home has no venue list on web (marketing sections only), so nothing to replace there. "Sahooliat"/"Sahulatein" copy is now "Amenities" (RU + EN).
Old card (`venue-card.tsx` v1 with sport/area/Open-in-Maps links and the availability tags) is gone; those links still exist on the venue page.
Local QA note: the local backend has no `CLOUDFRONT_DOMAIN`, so `photo_urls` use the S3 URL format; the W1 Playwright run serves those URLs from localstack via a route handler (the browser never contacts AWS).

## Mobile screens using `VenueCard` (agent M1, branch `floodlight-player`)

| Surface | File | Data | Notes |
|---|---|---|---|
| Home "Aaj raat khaali" | `apps/mobile/app/(player)/(tabs)/index.tsx` | `GET /venues?city=Karachi&date=<today>` (sorted by `today_free_slots`, 0 hidden) | `times` = real open starts from 5 PM PKT today for the first 3 cards (`GET /venues/:id/availability?date=today`, `lib/player-flow.ts tonightStarts`). FlatList + `useVenueCardViewability`. |
| Search results | `apps/mobile/app/(player)/search.tsx` | `GET /venues` with the route-param filters | FlatList + `useVenueCardViewability`; sport from the active filter. |
| Saved venues | `apps/mobile/app/(player)/(tabs)/profile.tsx` | `GET /users/me/favorites` | compact photo tiles (not the full card) in a horizontal strip, per the PAccount board. |
| Map ("Naqsha") | not built | — | the app has no map module (needs `react-native-maps`, a native dependency). |

Replaced (deleted, player-only): `components/saved-venues.tsx`, `components/favorite-button.tsx`, `components/amenity-badges.tsx`, `components/photo-gallery.tsx` and the old `VenueCard` in `app/(player)/_components.tsx`.
The venue DETAIL hero (`app/(player)/venue/[slug].tsx`, `PhotoHero` in `app/(player)/_components.tsx`) never autoplays: swipe + "1 / N tasveerein" + tap = full-screen gallery.
