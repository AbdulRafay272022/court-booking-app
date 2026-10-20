/**
 * Round 2 Stage 2 (CNIC): pure helpers for the 13-digit Pakistani CNIC input (no React Native, so node tests load them).
 * The number is typed as 12345-1234567-1; the server gets the same text (it strips the dashes and checks 13 digits).
 */

export const CNIC_DIGITS = 13;

/** Only the digits, at most 13. */
export function cnicDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, CNIC_DIGITS);
}

/** Live mask while typing: "1234512" -> "12345-12", "1234512345671" -> "12345-1234567-1". */
export function formatCnicInput(input: string): string {
  const d = cnicDigits(input);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export function isValidCnic(input: string): boolean {
  return cnicDigits(input).length === CNIC_DIGITS && input.replace(/[\d-\s]/g, "") === "";
}

/** Roman Urdu problem with the typed number, or null. Empty input is "not done yet", not an error. */
export function cnicProblem(input: string): string | null {
  const d = cnicDigits(input);
  if (d.length === 0) return null;
  if (d.length !== CNIC_DIGITS) return `CNIC ke ${CNIC_DIGITS} hindse hote hain (abhi ${d.length}).`;
  return null;
}

/** A local masked form for display before the server answers: "*****-*******-1". */
export function maskCnic(input: string): string {
  const d = cnicDigits(input);
  if (d.length !== CNIC_DIGITS) return "";
  return `*****-*******-${d.slice(12)}`;
}

export interface CnicDraft {
  number: string;
  /** Local photo uri (native) or object URL (web); never persisted. */
  front: string | null;
  back: string | null;
}

export const EMPTY_CNIC_DRAFT: CnicDraft = { number: "", front: null, back: null };

/** Ready to send: a full number and both photos. */
export function cnicDraftComplete(d: CnicDraft): boolean {
  return isValidCnic(d.number) && !!d.front && !!d.back;
}

export const IDENTITY_STATUS_TEXT: Record<"missing" | "submitted" | "verified", string> = {
  missing: "Abhi nahi diya",
  submitted: "Jama ho gaya, team check kar rahi hai",
  verified: "Verified",
};
