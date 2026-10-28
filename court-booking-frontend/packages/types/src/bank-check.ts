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
}

export interface BankCheck {
  venue_id: string;
  date: string;
  items: BankCheckItem[];
  total_pkr: number;
}
