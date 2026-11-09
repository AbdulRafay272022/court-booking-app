/** fix/nov-9 items 9-12 (backend app/schemas/refund_flow.py): where the refund goes, each refund sent with its screenshot
 * check, the player's "Mil gaya / Nahi mila", and "Khelo se shikayat karein". */

export type PayoutMethod = "jazzcash" | "easypaisa" | "bank";

export interface RefundPayout {
  method: PayoutMethod;
  method_label: string;
  /** "****6789": what every screen shows. */
  account_masked: string | null;
  /** The FULL number: only from the owner "show number" call (the venue that owes it, while owed; audited). */
  account: string | null;
  title: string | null;
  bank: string | null;
  set_at: string | null;
}

export interface RefundPayoutInput {
  method?: PayoutMethod;
  account?: string;
  title?: string;
  bank?: string | null;
  use_previous?: boolean;
}

export type RefundCheckVerdict = "match" | "mismatch" | "unreadable" | "no_screenshot";

export interface RefundTransfer {
  id: string;
  amount: number;
  reference: string | null;
  sent_at: string;
  screenshot_url: string | null;
  ocr_amount: number | null;
  ocr_receiver: string | null;
  ocr_verdict: RefundCheckVerdict;
  /** amount | receiver | amount_not_visible | receiver_not_visible | no_payout_details */
  ocr_reasons: string[];
  player_response: "received" | "not_received" | null;
  player_note: string | null;
  responded_at: string | null;
  owner_reply: string | null;
  owner_replied_at: string | null;
  can_answer: boolean;
}

export type EscalationKind = "no_show" | "short_payment" | "refund";

export interface Escalation {
  id: string;
  kind: EscalationKind;
  status: "open" | "decided";
  reason: string | null;
  admin_decision: "player" | "venue" | null;
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface EscalationState {
  kind: EscalationKind;
  can_escalate: boolean;
  escalation: Escalation | null;
}

export interface PlayerRefundState {
  dispute_id: string;
  amount: number;
  sent: number;
  remaining: number;
  status: "owed" | "refunded";
  needs_payout: boolean;
  payout: RefundPayout | null;
  previous_payout: RefundPayout | null;
  transfers: RefundTransfer[];
}

export interface BookingDisputes {
  refund: PlayerRefundState | null;
  escalations: EscalationState[];
}

export interface AdminEscalation extends Escalation {
  booking_id: string;
  booking_code: string;
  venue_id: string;
  venue_name: string;
  court_name: string;
  starts_at: string | null;
  price: number | null;
  amount_paid: number | null;
  player_name: string | null;
  player_phone: string | null;
  detail: {
    player_note?: string | null;
    total_pkr?: number;
    paid_pkr?: number;
    due_pkr?: number;
    transfer?: RefundTransfer;
    payout?: RefundPayout | null;
  };
}

type Lang = "ru" | "en";

/** The check result as both sides see it: "Match" / "Farq hai". */
export function refundCheckLabel(verdict: RefundCheckVerdict, lang: Lang): string {
  const t: Record<RefundCheckVerdict, [string, string]> = {
    match: ["Match", "Match"],
    mismatch: ["Farq hai", "Doesn't match"],
    unreadable: ["Check nahi ho saka", "Couldn't check"],
    no_screenshot: ["Screenshot nahi diya", "No screenshot"],
  };
  return t[verdict][lang === "en" ? 1 : 0];
}

/** Why the check is not a match, one short phrase per reason. */
export function refundCheckReasons(reasons: string[], lang: Lang): string[] {
  const t: Record<string, [string, string]> = {
    amount: ["Raqam alag hai", "Amount is different"],
    receiver: ["Receiver ka naam/number alag hai", "Receiver name/number is different"],
    amount_not_visible: ["Raqam nazar nahi aayi", "Amount not visible"],
    receiver_not_visible: ["Receiver nazar nahi aaya", "Receiver not visible"],
    no_payout_details: ["Player ne account nahi diya tha", "The player gave no account"],
  };
  return reasons.map((r) => (t[r] ? t[r][lang === "en" ? 1 : 0] : r));
}

export function escalationKindLabel(kind: EscalationKind, lang: Lang): string {
  const t: Record<EscalationKind, [string, string]> = {
    no_show: ["No-show", "No-show"],
    short_payment: ["Baqi raqam", "Amount due"],
    refund: ["Refund", "Refund"],
  };
  return t[kind][lang === "en" ? 1 : 0];
}

/** What the player reads about an escalation: sent / Khelo's decision. */
export function escalationStatusLine(e: Escalation, lang: Lang): string {
  if (e.status === "open") return lang === "en" ? "Sent to Khelo. We will tell you the decision." : "Khelo ko bhej di. Faisla hone par bataya jayega.";
  const who =
    e.admin_decision === "player"
      ? lang === "en" ? "Khelo decided in your favour" : "Khelo ne aap ke haq mein faisla kiya"
      : lang === "en" ? "Khelo agreed with the venue" : "Khelo ne venue ki baat sahi maani";
  return e.admin_note ? `${who}: ${e.admin_note}` : who;
}

/** Client-side check before sending "Refund kahan bhejein?" (the server checks the same and is the authority). */
export function payoutInputError(input: RefundPayoutInput, lang: Lang): string | null {
  if (input.use_previous) return null;
  const en = lang === "en";
  const raw = (input.account ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (input.method === "bank") {
    if (!/^PK\d{2}[A-Z]{4}\d{16}$/.test(raw)) return en ? "Enter the full IBAN (PK + 22 characters)." : "Poora IBAN likhein (PK + 22 characters).";
  } else if (input.method === "jazzcash" || input.method === "easypaisa") {
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("92") && d.length === 12) d = "0" + d.slice(2);
    if (d.startsWith("3") && d.length === 10) d = "0" + d;
    if (!/^03\d{9}$/.test(d)) return en ? "Enter the account's mobile number, e.g. 0300 1234567." : "Account ka mobile number likhein, jaise 0300 1234567.";
  } else {
    return en ? "Choose JazzCash, Easypaisa or Bank." : "JazzCash, Easypaisa ya Bank chunein.";
  }
  const title = (input.title ?? "").trim();
  if (title.length < 2 || !/[A-Za-z]/.test(title)) return en ? "Enter the account title (the name on the account)." : "Account title likhein (account par jo naam hai).";
  return null;
}
