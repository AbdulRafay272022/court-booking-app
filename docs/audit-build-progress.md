# Audit build progress (branch `feat/audit-build`, from main b708a20)

Source: the founder's RUN MODE brief (2026-10-28), based on `docs/full-audit-2026-10-28.md`. Never push. Commit after every item.
Decisions: `docs/decisions-made.md`. Deploy steps: `docs/deploy-steps.md`.

Status legend: TODO / DONE / PARTIAL / BLOCKED

## Phase 1 (no migration)
| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | /auth/me 401; owner session rotation | DONE | c048bb6 |  |
| 2 | venue status + is_active on page, availability, holds | DONE | 9f753c1 |  |
| 3 | AI language guard | DONE | 6717d37 |  |
| 4 | web booking cards clickable + detail | DONE | ffd8c22 | app needs EAS build |
| 5 | scroll lock (web), app slots jump | DONE | ce5d84a | app part needs device |
| 6 | player photo everywhere | DONE | 22c6849 | app needs EAS build |
| 7 | approvals badge | DONE | 220c6ed |  |
| 8 | audit real actor + bank edits | DONE | 573fcd1 |  |
| 9 | admin approve completeness | DONE | eeba958 |  |
| 10 | refund entry bugs | DONE | 9e86ad6, da563e7 | |
| 11 | web staff permissions | DONE | 2574091 |  |
| 12 | web English -> Roman Urdu | DONE | 44d888b | loanwords/admin/legal kept, decisions #7 |
| 13 | cards: no indoor/outdoor chips; amenities hover/tap | DONE | 9bce471 |  |
| 14 | refund policy everywhere + "Refund maangein" | DONE | 7094919, da563e7 | |
| 15 | settings required, no default controls | DONE | 69544bd | decisions #8 #9 |
| 16 | staff dashboard | DONE | d7dc3df | app needs EAS build |
| 17 | owner instant notice on staff no-show/short | DONE | a0bd16e | WA behind whatsapp_templates |
| 18 | player notice on no-show/short | DONE | a0bd16e | WA behind whatsapp_templates |
| 19 | walk-in phone + opt-in tick | DONE | a5422ef | opt-in stored in Phase 2 |
| 20 | payment instructions + Raast QR (flag iban_qr) | DONE | 05d08da | QR format assumption, device D7 |

## Phase 2 (small migrations)
| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | CNIC review columns + reject | DONE | 27184b8, 7e456ef | migration f7c3a9d2b415 |
| 2 | cnic_visibility_gate | DONE | 38d2ad9 | flag OFF; affected-venue query in deploy-steps |
| 3 | walk-in opt-in column, refund request fields | DONE | da563e7 | also finishes P1.10 and P1.14 |
| 4 | super admin in app | DONE | a2b32a9 | needs EAS build + device |

## Phase 3 (flags OFF)
| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | reject proof must not cancel booked | DONE | 2070d30 | |
| 2 | balance proof + bank reconcile list | DONE | 2070d30, 357df79, dd55026 | flag balance_proof; decisions #12 #13 |
| 3 | points | DONE | 93ddff1, d3d9e35 | flag player_points; migration a9d4e7b2c813; decision #14 |
| 4 | short payment reply | DONE | 93ddff1, d3d9e35 | flag short_payment_reply; cron short-payments; decision #15 |
| 5 | dues | DONE | 93ddff1, d3d9e35 | flag player_dues; decision #16 |
| 6 | no-show reply + GPS | DONE | 93ddff1, d3d9e35 | flag noshow_reply; needs device D10/D11 |
| 7 | AI chat all venues | DONE | cb89da5 | not tried on a live model |
| 8 | WhatsApp templates + buttons | DONE (code) / BLOCKED (Meta) | 93ddff1, 7ba290d | templates need Meta approval |
| 9 | dashboards: points, dues, disputes | DONE | 0f148aa | |

## Phase 4
| Item | Status |
|---|---|
| Firebase revert + preview build steps | DONE (steps) / BLOCKED (Firebase file) | docs/deploy-steps.md section 7
| Device test checklist | DONE | docs/device-test-checklist.md D1-D16
