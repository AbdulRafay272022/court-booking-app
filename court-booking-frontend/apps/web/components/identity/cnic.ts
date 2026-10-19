/**
 * Round 2 Stage 2: CNIC input helpers (pure). The backend accepts 13 digits once dashes are removed (422 CNIC_INVALID
 * otherwise); the UI shows the usual 12345-1234567-1 mask while typing. Never persisted anywhere on the client.
 */

export const CNIC_DIGITS = 13;

/** Same image rules as the other uploads (backend ALLOWED_*_TYPES, 10 MB like payment proofs). */
export const CNIC_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CNIC_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function cnicDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, CNIC_DIGITS);
}

/** "3520212345671" -> "35202-1234567-1"; partial input is masked as far as it goes ("35202-12"). */
export function formatCnic(input: string): string {
  const d = cnicDigits(input);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export function isValidCnic(input: string): boolean {
  return input.replace(/\D/g, "").length === CNIC_DIGITS && input.replace(/[\d\s-]/g, "") === "";
}

export type CnicImageProblem = "type" | "size" | null;

export function cnicImageProblem(file: { type: string; size: number }): CnicImageProblem {
  if (!(CNIC_IMAGE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > CNIC_IMAGE_MAX_BYTES) return "size";
  return null;
}
