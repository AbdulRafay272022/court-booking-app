/** audit 2026-10-28 Phase 3 item 2: GET /owners/bank-check (backend app/schemas/bank_check.py) -- every transfer credited on one
 * Pakistan day, for the owner to tick off against the bank statement ("bank se mila lein"). */
export interface BankCheckItem {
  entry_id: string;
  booking_id: string;
  code: string;
  player_name: string | null;
  court_name: string;
  starts_at: string;
  amount_pkr: number;
  credited_at: string;
  approved_by: string;
  kind: "advance" | "balance";
  /** audit fixes 2026-10-31 (b): a balance transfer the owner may mark "bank mein nahi mila" (owner only, once). */
  can_mark?: boolean;
  not_received?: boolean;
  /** the owner's choice once marked: "staff" = Staff se wasool, "player" = Player se baqi maangein */
  decision?: BankMissingDecision | null;
  approved_by_role?: string | null;
}

export type BankMissingDecision = "staff" | "player";

export interface BankMissingState {
  entry_id: string;
  not_received: boolean;
  marked_at: string;
  decision: BankMissingDecision | null;
  decided_at: string | null;
}

export interface BankCheck {
  venue_id: string;
  date: string;
  items: BankCheckItem[];
  total_pkr: number;
}
