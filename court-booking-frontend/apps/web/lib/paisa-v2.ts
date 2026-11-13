/** Ledger v2 "Paisa" (docs/design/LEDGER-V2-CONTRACT.md 6.1): pure helpers for the web page. Unit-tested in paisa-v2.test.ts.
 * Tabs live in `?tab=` (bookings | lenden | players | kaam) and a Kaam group in `&group=`. The v1 tab names (hisaab, bank,
 * baqi, wapas) still arrive from old links, notifications and the server redirects of /owner/ledger|dues|refunds|bank-check,
 * so they are mapped here. */
import { PAISA_TABS, type PaisaTab, type PaisaTaskKey } from "@court-booking/types";

export const PAISA_V2_PATH = "/dashboard/owner/paisa";

export interface PaisaV2Place {
  tab: PaisaTab;
  group: PaisaTaskKey | null;
}

const OLD: Record<string, PaisaV2Place> = {
  hisaab: { tab: "bookings", group: null },
  bank: { tab: "kaam", group: "bank_check" },
  baqi: { tab: "players", group: null },
  wapas: { tab: "kaam", group: "refund_due" },
};

const GROUPS: readonly PaisaTaskKey[] = [
  "short_decide",
  "noshow_reply",
  "refund_due",
  "refund_not_got",
  "bank_check",
  "screenshots",
  "attendance",
  "due_collect",
];

/** Where `?tab=` / `&group=` point, v1 names included. Unknown -> Bookings. */
export function parsePaisaV2(tab: string | null | undefined, group: string | null | undefined): PaisaV2Place {
  if (tab && OLD[tab]) return OLD[tab];
  const t = (PAISA_TABS as readonly string[]).includes(tab ?? "") ? (tab as PaisaTab) : "bookings";
  const g = t === "kaam" && GROUPS.includes(group as PaisaTaskKey) ? (group as PaisaTaskKey) : null;
  return { tab: t, group: g };
}

/** The URL of a tab (and group); `keep` carries other query values (booking, open, date, courts, staff ...). */
export function paisaV2Href(tab: PaisaTab, group?: PaisaTaskKey | null, keep: Record<string, string | undefined> = {}): string {
  const usp = new URLSearchParams();
  if (tab !== "bookings") usp.set("tab", tab);
  if (group) usp.set("group", group);
  for (const [k, v] of Object.entries(keep)) if (v !== undefined && v !== "" && k !== "tab" && k !== "group") usp.set(k, v);
  const qs = usp.toString();
  return qs ? `${PAISA_V2_PATH}?${qs}` : PAISA_V2_PATH;
}

/** Whole rupees, never a float on screen. */
export function pkrText(n: number): string {
  const v = Math.round(n);
  return `PKR ${Math.abs(v).toLocaleString("en-US")}`;
}

/** "+ PKR 1,000" / "− PKR 500" (a real minus sign). */
export function signedPkr(n: number): string {
  if (n === 0) return pkrText(0);
  return `${n > 0 ? "+" : "−"} ${pkrText(n)}`;
}

/** Digits only ("1,500" / "PKR 1500" -> 1500); NaN when empty or not a whole number. */
export function parseRupees(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^pkr/i, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}

/** wa.me link for a Pakistani mobile in any common form; null when there is no usable number. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("03")) d = `92${d.slice(1)}`;
  if (!/^923\d{9}$/.test(d)) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
