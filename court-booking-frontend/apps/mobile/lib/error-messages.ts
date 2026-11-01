import { ApiError } from "@court-booking/api-client";

/**
 * Maps every backend ErrorCode (FRONTEND_INTEGRATION.md §7) to a human-readable message, in Roman Urdu (the app's
 * default, PAuth / PStates boards) or English (the language toggle). The language follows the app's LangProvider
 * (`setErrorLang`), so the 100+ call sites keep calling `friendlyErrorMessage(e)` unchanged.
 * Roman Urdu tone: polite "karein" (shared by players and owners).
 */
type Lang = "ru" | "en";

const EN: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Check WhatsApp and try again.",
  OTP_EXPIRED: "This code has expired. Request a new one.",
  OTP_RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
  OTP_DELIVERY_FAILED: "We couldn't send the code right now. Please try again in a moment.",
  INVALID_CREDENTIALS: "Invalid phone number or password.",
  LOGIN_RATE_LIMITED: "Too many failed attempts. Wait a few minutes, or reset your password.",
  PHONE_REVERIFICATION_REQUIRED: "Please verify your phone number to continue.",
  PASSWORD_NOT_SET: "Set a password for your account to continue.",
  PHONE_ALREADY_REGISTERED: "An account with this number already exists. Log in instead.",
  EMAIL_ALREADY_IN_USE: "That email address is already in use.",
  SESSION_EXPIRED: "Your session has expired. Please log in again.",
  SESSION_REVOKED: "You've been logged out on this device. Please log in again.",
  NOT_AUTHENTICATED: "Please log in to continue.",
  OTP_SUPERSEDED: "That code is no longer valid — a newer one was sent. Enter the latest code.",
  OTP_IP_RATE_LIMITED: "Too many codes requested from this device. Please try again later.",
  SIGNUP_ALREADY_PENDING: "A verification is already in progress for this number. Check WhatsApp for the code, or wait a few minutes and try again.",
  ALREADY_VERIFIED: "This number is already verified — please log in.",
  USER_NOT_FOUND: "No account found for this number. Please sign up.",
  SLOT_ALREADY_TAKEN: "Someone just booked this slot. Pick another one.",
  INVALID_SLOT_TIME: "That time isn't available anymore — please pick a slot from the list.",
  SLOT_IN_PAST: "That time has already passed.",
  WALKIN_IN_PAST: "That time has already passed. Record a walk-in for the slot happening now or a later one.",
  SLOT_BLOCKED: "This slot isn't available right now.",
  ALREADY_YOUR_SLOT: "This slot is already yours.",
  BOOKING_NOT_FOUND: "We couldn't find that booking.",
  INVALID_BOOKING_STATE: "That action can't be done on this booking anymore.",
  NOT_YOUR_BOOKING: "This isn't your booking.",
  CANCELLATION_NOT_ALLOWED: "This venue doesn't allow cancelling a booking once it's paid for.",
  CANCELLATION_WINDOW_CLOSED: "The cancellation window for this booking has closed.",
  INVALID_CHECKIN_CODE: "That check-in code isn't right. Try scanning the venue's QR again.",
  TOO_EARLY_FOR_NO_SHOW: "It's too early to mark this as a no-show yet.",
  VENUE_NOT_APPROVED: "This venue isn't live yet.",
  VENUE_INCOMPLETE: "The venue isn't complete yet: courts, hours, prices, a photo and bank details are required.",
  VENUE_NOT_FOUND: "We couldn't find that venue.",
  NOT_VENUE_OWNER: "You don't manage this venue.",
  DUPLICATE_PROOF: "This screenshot looks like it's already been used.",
  PAYMENT_EXCEEDS_BALANCE: "That's more than what's still owed on this booking.",
  PROOF_TOO_LARGE: "That image is too large — please use one under 10MB.",
  INVALID_IMAGE_FORMAT: "Please upload a JPEG, PNG, or WebP image.",
  FEATURE_NOT_AVAILABLE: "That feature is not available to buy right now.",
  INVALID_PRICE: "A feature that owners can buy needs a price above zero.",
  INVOICE_NOT_FOUND: "We couldn't find that invoice.",
  INVOICE_NOT_PAYABLE: "This invoice is not waiting for a payment right now.",
  PAYMENT_ALREADY_REVIEWED: "This payment was already reviewed.",
  PAYMENT_ALREADY_SUBMITTED: "A payment screenshot for this is already being checked.",
  PREMIUM_FEATURE_REQUIRED: "This is a premium feature. Switch it on under Premium to use it.",
  REFUND_ALREADY_MARKED: "This refund has already been marked as paid.",
  REFUND_EXCEEDS_OWED_AMOUNT: "That's more than what's owed on this booking.",
  COMPLETION_TOO_EARLY: "The slot hasn't ended yet. Mark it complete after the game.",
  BOOKING_NO_LONGER_PENDING: "This booking is no longer waiting for approval (it was cancelled or expired). Tap OK on the card.",
  PAYMENT_STILL_PENDING: "This payment is still waiting for approval. Approve or reject it.",
  REASON_REQUIRED: "Some money is still owed, so a reason is required.",
  HOLD_EXPIRED: "This booking's time ran out and the slot is no longer held for you. The owner has your screenshot and will contact you.",
  NOT_STAFF_PERMITTED: "You don't have permission for this. Ask the owner.",
  RATE_LIMITED: "You're doing that too much — please slow down a little.",
  FORBIDDEN: "You don't have permission to do that.",
  VALIDATION_ERROR: "Some of the details entered aren't valid.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

const RU: Record<string, string> = {
  INVALID_OTP: "Code galat hai. WhatsApp check kar ke dobara likhein.",
  OTP_EXPIRED: "Is code ka waqt khatam ho gaya. Naya code mangwayein.",
  OTP_RATE_LIMITED: "Bohat zyada koshishein. Kuch minute ruk kar dobara koshish karein.",
  OTP_DELIVERY_FAILED: "Abhi code nahi bhej sake. Thori dair baad dobara koshish karein.",
  INVALID_CREDENTIALS: "Phone number ya password galat hai.",
  LOGIN_RATE_LIMITED: "Bohat zyada galat koshishein. Kuch minute ruk jayein, ya password reset karein.",
  PHONE_REVERIFICATION_REQUIRED: "Aage barhne ke liye apna phone number verify karein.",
  PASSWORD_NOT_SET: "Aage barhne ke liye apne account ka password banayein.",
  PHONE_ALREADY_REGISTERED: "Is number ka account pehle se hai. Login karein.",
  EMAIL_ALREADY_IN_USE: "Ye email pehle se istemal ho rahi hai.",
  SESSION_EXPIRED: "Aap ka session khatam ho gaya. Dobara login karein.",
  SESSION_REVOKED: "Is device se aap logout ho gaye. Dobara login karein.",
  NOT_AUTHENTICATED: "Aage barhne ke liye login karein.",
  OTP_SUPERSEDED: "Ye code ab nahi chalega, naya code bheja gaya hai. Sab se naya code likhein.",
  OTP_IP_RATE_LIMITED: "Is device se bohat zyada codes mangwaye gaye. Baad mein koshish karein.",
  SIGNUP_ALREADY_PENDING: "Is number ki verification pehle se chal rahi hai. WhatsApp par code dekhein, ya kuch minute baad dobara koshish karein.",
  ALREADY_VERIFIED: "Ye number pehle se verify hai. Login karein.",
  USER_NOT_FOUND: "Is number ka koi account nahi. Pehle sign up karein.",
  SLOT_ALREADY_TAKEN: "Ye slot abhi kisi ne book kar liya. Koi aur slot chunein.",
  INVALID_SLOT_TIME: "Ye waqt ab khaali nahi. List se koi slot chunein.",
  SLOT_IN_PAST: "Ye waqt guzar chuka hai.",
  WALKIN_IN_PAST: "Ye waqt guzar chuka hai. Abhi chalne wale ya baad ke slot ka walk-in likhein.",
  SLOT_BLOCKED: "Ye slot abhi available nahi.",
  ALREADY_YOUR_SLOT: "Ye slot pehle se aap ka hai.",
  BOOKING_NOT_FOUND: "Ye booking nahi mili.",
  INVALID_BOOKING_STATE: "Is booking par ab ye kaam nahi ho sakta.",
  NOT_YOUR_BOOKING: "Ye aap ki booking nahi.",
  CANCELLATION_NOT_ALLOWED: "Ye venue paid booking cancel karne nahi deta.",
  CANCELLATION_WINDOW_CLOSED: "Is booking ko cancel karne ka waqt guzar chuka hai.",
  INVALID_CHECKIN_CODE: "Check-in code galat hai. Venue ka QR dobara scan karein.",
  TOO_EARLY_FOR_NO_SHOW: "Abhi No-show mark karna jaldi hai.",
  VENUE_NOT_APPROVED: "Ye venue abhi live nahi.",
  VENUE_INCOMPLETE: "Venue abhi mukammal nahi: courts, auqaat, qeemat, photo aur bank details zaroori hain.",
  VENUE_NOT_FOUND: "Ye venue nahi mila.",
  NOT_VENUE_OWNER: "Ye venue aap ke paas nahi.",
  DUPLICATE_PROOF: "Ye screenshot pehle istemal ho chuka lagta hai.",
  PAYMENT_EXCEEDS_BALANCE: "Ye is booking par baqi raqam se zyada hai.",
  PROOF_TOO_LARGE: "Tasveer bohat bari hai. 10MB se choti tasveer lagayein.",
  INVALID_IMAGE_FORMAT: "JPEG, PNG ya WebP tasveer lagayein.",
  FEATURE_NOT_AVAILABLE: "Ye feature abhi khareedne ke liye nahi.",
  INVALID_PRICE: "Owners ke liye feature ki qeemat zero se zyada honi chahiye.",
  INVOICE_NOT_FOUND: "Ye invoice nahi mili.",
  INVOICE_NOT_PAYABLE: "Is invoice par abhi payment nahi ho sakti.",
  PAYMENT_ALREADY_REVIEWED: "Ye payment pehle hi check ho chuki hai.",
  PAYMENT_ALREADY_SUBMITTED: "Is ka payment screenshot pehle se check ho raha hai.",
  PREMIUM_FEATURE_REQUIRED: "Ye premium feature hai. Istemal ke liye Premium mein on karein.",
  REFUND_ALREADY_MARKED: "Ye refund pehle hi bheja hua mark ho chuka hai.",
  REFUND_EXCEEDS_OWED_AMOUNT: "Ye is booking par wapas dene wali raqam se zyada hai.",
  COMPLETION_TOO_EARLY: "Slot abhi khatam nahi hua. Khel khatam hone ke baad mukammal mark karein.",
  BOOKING_NO_LONGER_PENDING: "Yeh booking ab approval ke intezar mein nahi (cancel ya expire ho chuki hai). Card par Theek hai dabayein.",
  PAYMENT_STILL_PENDING: "Yeh payment abhi approval ke intezar mein hai. Approve ya Reject karein.",
  REASON_REQUIRED: "Baqi paisa reh gaya hai, is liye wajah likhna zaroori hai.",
  HOLD_EXPIRED: "Is booking ka waqt khatam ho gaya, slot ab aapke liye hold nahi. Owner ko screenshot mil gaya hai, woh aap se rabta karega.",
  NOT_STAFF_PERMITTED: "Aap ke paas is kaam ki ijazat nahi. Owner se ijazat mangein.",
  RATE_LIMITED: "Bohat tezi se ho raha hai. Thora ruk kar koshish karein.",
  FORBIDDEN: "Aap ke paas is kaam ki ijazat nahi.",
  VALIDATION_ERROR: "Kuch maloomat theek nahi likhi gayin.",
  NOT_FOUND: "Jo aap dhoond rahe hain woh nahi mila.",
  UNKNOWN_ERROR: "Kuch gadbad ho gayi. Dobara koshish karein.",
};

let current: Lang = "ru";

/** Called by the app's LangProvider so every error follows the chosen language. */
export function setErrorLang(lang: Lang): void {
  current = lang;
}

/** Any 5xx without a known code (an unhandled crash, a gateway error, maintenance). */
export const SERVER_ERROR_MESSAGE = "Server mein abhi masla hai. Thori dair baad dobara koshish karein.";
const SERVER_ERROR_EN = "The server has a problem right now. Please try again in a little while.";
const NETWORK = { ru: "Server tak nahi pohanch sake. Internet check kar ke dobara koshish karein.", en: "Can't reach the server. Check your connection and try again." };

export function friendlyErrorMessage(error: unknown, lang: Lang = current): string {
  const messages = lang === "en" ? EN : RU;
  if (error instanceof ApiError) {
    // A known code keeps its own message (the 4xx business errors). An unknown code on a 5xx carries the server's raw
    // text ("Internal server error"), which means nothing to the user: say it in plain words instead.
    if (messages[error.code] && error.code !== "UNKNOWN_ERROR") return messages[error.code];
    if (error.status >= 500) return lang === "en" ? SERVER_ERROR_EN : SERVER_ERROR_MESSAGE;
    return messages[error.code] ?? error.message ?? messages.UNKNOWN_ERROR;
  }
  if (error instanceof Error && error.message === "Network request failed") return NETWORK[lang];
  return messages.UNKNOWN_ERROR;
}

/** Every code has both languages (checked by the unit test). */
export const ERROR_CODES = Object.keys(EN);
export const hasBothLanguages = (code: string): boolean => !!EN[code] && !!RU[code];
