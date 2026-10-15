// English mode must equal the shared package functions (the pre-Phase-4 output); Roman Urdu mode is checked on key outputs.
//   TZ=UTC npx tsx --tsconfig tsconfig.p4.json --test lib/format-i18n.test.ts   (plain `npx tsx --test` when node_modules resolves the worktree packages)
import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_LABELS,
  GENDER_OPTIONS,
  CITY_OPTIONS,
  amenityLabel,
  bookingHorizonText,
  cancellationPolicyText,
  formatDate,
  formatDateRelative,
  formatDateString,
  formatDuration,
  formatMonth,
  formatSlotLabel,
  formatSlotTimes,
  formatTime,
  formatTime24As12,
  formatTimeRange,
  formatWhen,
  formatWhenRange,
  scheduleHoursText,
  slotPreviewText,
  startsInText,
  validateProfile,
  validateSignup,
  weeklyHoursLines,
  weeklyHoursError,
  courtSetupProblem,
  defaultCourtSetup,
  hiddenRates,
  passwordError,
  bankDetailsError,
} from "@court-booking/types";
import { formatDistance, formatRelativeTime } from "./format";
import { makeFmt } from "./format-i18n";
import { en, ru } from "../messages";

const en_ = makeFmt("en");
const ru_ = makeFmt("ru");
const a = new Date(Date.now() + 26 * 3_600_000).toISOString();
const b = new Date(Date.now() + 27.5 * 3_600_000).toISOString();

test("en mode equals the shared package output", () => {
  assert.equal(en_.date(a), formatDate(a));
  assert.equal(en_.dateString("2026-09-22"), formatDateString("2026-09-22"));
  assert.equal(en_.dateRelative(a), formatDateRelative(a));
  assert.equal(en_.when(a), formatWhen(a));
  assert.equal(en_.whenRange(a, b), formatWhenRange(a, b));
  assert.equal(en_.slotLabel(a, b), formatSlotLabel(a, b));
  assert.equal(en_.slotTimes({ starts_at: a, ends_at: b }), formatSlotTimes({ starts_at: a, ends_at: b }));
  assert.equal(en_.timeRange(a, b), formatTimeRange(a, b));
  assert.equal(en_.time(a), formatTime(a));
  assert.equal(en_.time24("18:30"), formatTime24As12("18:30"));
  assert.equal(en_.month("2026-09"), formatMonth("2026-09"));
  for (const m of [15, 30, 60, 90, 120, 360]) assert.equal(en_.duration(m), formatDuration(m));
  assert.equal(en_.distance(850), formatDistance(850));
  assert.equal(en_.distance(1200), formatDistance(1200));
  assert.equal(en_.distance(null), null);
  const ago = new Date(Date.now() - 5 * 60_000).toISOString();
  for (const iso of [new Date().toISOString(), ago, new Date(Date.now() - 3 * 3_600_000).toISOString(), new Date(Date.now() - 3 * 86_400_000).toISOString()]) {
    assert.equal(en_.relative(iso), formatRelativeTime(iso));
  }
  const now = Date.now();
  const s1 = new Date(now + 2 * 86_400_000).toISOString();
  const e1 = new Date(now + 2 * 86_400_000 + 3_600_000).toISOString();
  assert.equal(en_.startsIn(s1, e1), startsInText(s1, e1));
  const t = { open_time: "06:00:00", close_time: "23:00:00", closes_next_day: false };
  assert.equal(en_.hoursText(t), scheduleHoursText(t));
  const tpl = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, ...t, is_active: true })) as never;
  assert.deepEqual(en_.weeklyHoursLines(tpl), weeklyHoursLines(tpl));
  assert.equal(en_.bookingHorizon(90), bookingHorizonText(90));
  assert.equal(en_.slotPreviewText("06:00", "23:00", 90), slotPreviewText("06:00", "23:00", 90));
  const v = { cancellation_allowed: true, cancellation_cutoff_hours: 6 };
  assert.equal(en_.cancellationPolicy(v), cancellationPolicyText(v));
  for (const k of ["floodlights", "parking", "washrooms", "changing_room", "lounge_area"]) assert.equal(en_.amenity(k), amenityLabel(k));
  assert.deepEqual(["indoor", "outdoor", "both"].map((k) => en_.setting(k as "indoor")), ["Indoor", "Outdoor", "Indoor + Outdoor"]);
  for (const s of ["held", "payment_submitted", "booked", "completed", "no_show", "cancelled", "something_new"]) {
    assert.equal(en_.bookingStatus(s), s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
  }
  for (const g of GENDER_OPTIONS) assert.equal(en_.gender(g.label), g.label);
  for (const c of CITY_OPTIONS) assert.equal(en_.city(c.label), c.label);
  assert.equal(en_.sport("Futsal"), "Futsal");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => en_.weekday(i)), [...DAY_LABELS]);
  assert.equal(en_.weekday(0, "long"), "Monday");
  assert.equal(en_.weekday(6, "long"), "Sunday");
});

test("ru mode on key outputs", () => {
  assert.equal(ru_.duration(90), "1.5 ghante");
  assert.equal(ru_.duration(60), "1 ghanta");
  assert.equal(ru_.duration(45), "45 minute");
  assert.equal(ru_.hoursText({ open_time: "00:00:00", close_time: "00:00:00", closes_next_day: false }), "24 ghante khula");
  assert.equal(ru_.bookingHorizon(90), "90 din pehle tak booking ho sakti hai");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => ru_.weekday(i)), ["Peer", "Mangal", "Budh", "Jumerat", "Jumma", "Hafta", "Itwar"]);
  assert.equal(ru_.month("2026-10"), "Aktoobar 2026");
  assert.equal(ru_.bookingStatus("booked"), "Book ho gaya");
  assert.equal(ru_.bookingStatus("payment_submitted"), "Payment ka intezar");
  assert.equal(ru_.bookingStatus("unheard_of"), "Unheard of");
  assert.equal(ru_.amenity("floodlights"), "Roshni (floodlights)");
  assert.equal(ru_.amenity("parking"), "Parking ki jagah");
  assert.equal(ru_.setting("indoor"), "Andar (Indoor)");
  assert.equal(ru_.setting("outdoor"), "Bahar (Outdoor)");
  assert.equal(ru_.sport("Padel"), "Padel");
  assert.equal(ru_.relative(new Date().toISOString()), "abhi abhi");
  assert.equal(ru_.relative(new Date(Date.now() - 5 * 60_000).toISOString()), "5 minute pehle");
  assert.equal(ru_.relative(new Date(Date.now() - 3 * 3_600_000).toISOString()), "3 ghante pehle");
  assert.equal(ru_.relative(new Date(Date.now() - 3 * 86_400_000).toISOString()), "3 din pehle");
  assert.equal(ru_.gender("Female"), "Aurat");
  assert.equal(ru_.dateRelative(new Date()), "Aaj");
});

test("every validator message translates (en passes through, ru differs)", () => {
  const messages = new Set<string>();
  const signup = validateSignup({ name: "", email: "", phone: "", city: "", gender: "", password: "x", confirmPassword: "y" });
  Object.values(signup).forEach((m) => messages.add(m as string));
  Object.values(validateProfile({ name: "", email: "", city: "", gender: "" })).forEach((m) => messages.add(m as string));
  messages.add("Enter your current password");
  messages.add("Enter your password");
  messages.add(passwordError("a") as string);
  for (const bank of [
    { bankName: "", accountTitle: "", accountNumber: "" },
    { bankName: "!!", accountTitle: "Ali", accountNumber: "12", iban: "x" },
    { bankName: "HBL", accountTitle: "Ali R!", accountNumber: "12345678", iban: "" },
  ]) Object.values(bankDetailsError(bank)).forEach((m) => messages.add(m as string));
  const setup = defaultCourtSetup();
  setup.pricingRules[0].pricePerSlot = "";
  messages.add(courtSetupProblem(setup) as string);
  setup.sameHoursEveryDay = false;
  setup.perDayOverrides = { 2: { open: "", close: "" } };
  setup.pricingRules[0].pricePerSlot = "100";
  messages.add(courtSetupProblem(setup) as string);
  const over = defaultCourtSetup();
  over.sameHoursEveryDay = false;
  over.perDayOverrides = { 3: { open: "15:00", close: "03:00" }, 4: { open: "02:00", close: "23:00" } };
  messages.add(weeklyHoursError(false, "06:00", "23:00", over.perDayOverrides, DAY_LABELS) as string);
  const rules = defaultCourtSetup();
  rules.pricingRules = [
    { id: "a", name: "Peak", pricePerSlot: "100", dayOfWeek: [0], startTime: "18:00", endTime: "22:00" },
    { id: "b", name: "Evening", pricePerSlot: "90", dayOfWeek: null, startTime: null, endTime: null },
  ];
  Object.values(hiddenRates(rules)).forEach((h) => messages.add(h.message));
  rules.pricingRules.reverse();
  Object.values(hiddenRates(rules)).forEach((h) => messages.add(h.message));
  assert.ok(messages.size >= 15, `collected ${messages.size}`);
  for (const m of messages) {
    assert.equal(en_.validation(m), m);
    assert.notEqual(ru_.validation(m), m, `no Roman Urdu text for: ${m}`);
    assert.ok(!/\{\w+\}/.test(ru_.validation(m)), `unfilled placeholder: ${m}`);
  }
  assert.equal(ru_.validation("Something nobody wrote"), "Something nobody wrote");
  assert.equal(ru_.validation("Mon: Choose an opening time and a closing time."), "Peer: Khulne aur band hone ka waqt chunein.");
  assert.equal(ru_.validation("Use at least 8 characters"), "Kam az kam 8 characters rakho");
});

test("fmt and validation keys exist in both dictionaries", () => {
  for (const k of Object.keys(ru).filter((x) => x.startsWith("fmt.") || x.startsWith("validation."))) assert.ok(k in en, k);
});
