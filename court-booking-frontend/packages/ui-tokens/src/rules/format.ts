/** Money in the Floodlight style: "PKR 4,000". Manual grouping (toLocaleString is banned by check:time-inputs). */
export function formatPkr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "PKR –";
  const neg = amount < 0;
  const whole = Math.round(Math.abs(amount));
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}PKR ${grouped}`;
}

/** Initials for Avatar: "Demo Arena" -> "DA", "khelo" -> "K". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
