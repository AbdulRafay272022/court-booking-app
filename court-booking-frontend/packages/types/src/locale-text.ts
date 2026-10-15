/**
 * Word tables for the shared formatters (Phase 4). `en` is the text the apps always showed; `ru` is Roman Urdu (Latin script).
 * Every formatter that produces user-visible words takes an optional trailing `lang: TextLang = "en"`, so existing callers
 * (and the mobile app) keep getting English unchanged. Numbers, "AM"/"PM" and "PKR" are the same in both languages.
 */
export type TextLang = "en" | "ru";

/** Sunday-first (JavaScript's getUTCDay order). */
export const WEEKDAY_SHORT: Record<TextLang, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ru: ["Itwar", "Peer", "Mangal", "Budh", "Jumerat", "Jumma", "Hafta"],
};

export const WEEKDAY_LONG: Record<TextLang, readonly string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ru: ["Itwar", "Peer", "Mangal", "Budh", "Jumerat", "Jumma", "Hafta"],
};

/** Short month names ("23 Sep"): people write these the same way in both languages. */
export const MONTH_SHORT: Record<TextLang, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** Month names for a month header ("Sep 2026" in English, "Sitambar 2026" in Roman Urdu). */
export const MONTH_HEADER: Record<TextLang, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["Janwari", "Farwari", "March", "April", "May", "June", "July", "August", "Sitambar", "Aktoobar", "Navambar", "Disambar"],
};

export const WORDS = {
  en: {
    today: "Today",
    tomorrow: "Tomorrow",
    to: "to",
    minutes: (n: number) => `${n} minutes`,
    oneHour: "1 hour",
    hours: (n: number) => `${n} hours`,
    everyDay: "Every day",
    closed: "Closed",
    open24: "Open 24 hours",
    nextDay: " (next day)",
    horizon: (d: number) => `Bookable up to ${d} ${d === 1 ? "day" : "days"} ahead`,
    reason: { maintenance: "Maintenance", weather: "Weather", private_event: "Private event", other: "Closed" } as Record<string, string>,
    happeningNow: "happening now",
    finished: "finished",
    inMin: (n: number) => `in ${n} min`,
    inHours: (n: number) => `in ${n} hour${n === 1 ? "" : "s"}`,
    inDays: (n: number) => `in ${n} day${n === 1 ? "" : "s"}`,
    tooShort: "These hours are too short for even one slot.",
    nextMorning: " the next morning",
    slotsADay: (n: number, from: string, to: string) => `${n} ${n === 1 ? "slot" : "slots"} a day, ${from} to ${to}`,
    noCancel: "This venue does not allow cancellations once booked.",
    freeCancel: (h: number) => `Free cancellation up to ${h}h before your booking.`,
    cancelAnytime: "You can cancel any time before your booking starts.",
    checkinFrom: (t: string) => `You can check in starting at ${t}.`,
    checkinClosed: (t: string) => `Check-in for this booking closed at ${t}.`,
  },
  ru: {
    today: "Aaj",
    tomorrow: "Kal",
    to: "se",
    minutes: (n: number) => `${n} minute`,
    oneHour: "1 ghanta",
    hours: (n: number) => `${n} ghante`,
    everyDay: "Har roz",
    closed: "Band",
    open24: "24 ghante khula",
    nextDay: " (agle din)",
    horizon: (d: number) => `${d} din pehle tak booking ho sakti hai`,
    reason: { maintenance: "Maintenance", weather: "Mausam", private_event: "Private event", other: "Band" } as Record<string, string>,
    happeningNow: "abhi chal raha hai",
    finished: "khatam",
    inMin: (n: number) => `${n} minute mein`,
    inHours: (n: number) => `${n} ghante mein`,
    inDays: (n: number) => `${n} din mein`,
    tooShort: "In ghanton mein ek slot bhi nahi banta.",
    nextMorning: " agli subah",
    slotsADay: (n: number, from: string, to: string) => `Roz ${n} slot, ${from} se ${to} tak`,
    noCancel: "Is venue par booking ke baad cancel nahi ho sakti.",
    freeCancel: (h: number) => `Booking se ${h} ghante pehle tak free cancel kar sakte hain.`,
    cancelAnytime: "Booking shuru hone se pehle kabhi bhi cancel kar sakte hain.",
    checkinFrom: (t: string) => `Aap ${t} se check in kar sakte hain.`,
    checkinClosed: (t: string) => `Is booking ka check-in ${t} par band ho gaya.`,
  },
} as const;

/** Amenity labels by key. Sports are never translated; amenities only where a natural Roman Urdu term exists. */
export const AMENITY_LABELS: Record<TextLang, Record<string, string>> = {
  en: { floodlights: "Floodlights", parking: "Parking", washrooms: "Washrooms", changing_room: "Changing room" },
  ru: {
    floodlights: "Roshni (floodlights)",
    parking: "Parking ki jagah",
    washrooms: "Washroom",
    changing_room: "Kapray badalne ka kamra",
    drinking_water: "Peene ka paani",
    seating: "Baithne ki jagah",
  },
};
