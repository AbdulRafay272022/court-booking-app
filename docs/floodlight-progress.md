# Floodlight progress (MASTER-PROMPT run)

Source: design/khelo-mobile-floodlight/MASTER-PROMPT.md. Read this file first after any restart/compaction.
Agent brief (env, commands, rules): scratchpad `agent-brief.md` (session temp dir).

| Phase | Branch | Status |
|---|---|---|
| A housekeeping | main | DONE 1fdef6b |
| B native foundation | native-foundation | DONE, merged f791e0a (unit 47→53, e2e 245/245) |
| D-BE backend findings | floodlight-be | DONE early, merged ce1315a (docs/floodlight-contract.md, docs/venue-card-contract.md, backend 1568 pass) |
| C design system | floodlight-ds | DONE, merged 003bc22 (unit 63→89, 102 contrast pairs pass, e2e 245/245) |
| D-FX leftover fixes | leftover-fixes | DONE, merged d985cda (unit 53→63) |
| D-W1 web | floodlight-web | DONE, merged ff2d23e (web tests 137→144, Playwright 278/278) |
| D-M1 player | floodlight-player | DONE, merged 3407fbb (unit →106, live journey 105/105) |
| D-M2 owner | floodlight-owner | DONE, merged 233b080 (unit →122, live 18/18, board checks 84+84) |
| E QA | floodlight-qa | in progress |

## BE key findings
- Direct hold exists: POST /bookings/hold (api.bookings.hold) → "Book karo" holds directly.
- Held-by-other: SlotOut.status held|payment_submitted with is_mine=false.
- Cancel policy: venue cancellation_allowed + cancellation_cutoff_hours (no free text).
- photos (max 8, ordered) + amenities already on GET /venues + favorites list (photo_urls[], amenities[]). No thumbnails.
- Backend dependencies (not built, for founder): B1 chat inbox, B2 short check-in code, B3 full growth heatmap, B4 thumbnails, B5 bank details re-fetch, B6 hold_minutes public, B7 server notification read state, B8 bulk approve endpoint.

## Next
- After C merges: W1, M1, M2 in worktrees; merge order W1 → FX → M1 → M2.

## Blockers
- none

## Phase D notes for QA / final report
- Not built (backend/native): chat inbox unread (B1), short check-in code (B2), growth discounts (B3), thumbnails (B4), walk-in payment method field (no backend field), map/Naqsha + "Pin khud lagao" (needs react-native-maps), calendar/confetti on Status.
- DS bugs found by M2: Sheet portal outside Role/Lang/FontScale providers; stacked sheets dismiss both on web; Sheet lingers ~1 s on unmount; onDismiss stale closure; RadioGroup no aria-checked.
- Local photo_urls use the S3 URL format (no CLOUDFRONT_DOMAIN locally) — founder decision.
- Empty folder C:\NOMANT~1 created by a path typo — founder removes by hand.
