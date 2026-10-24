/** React Query keys of the owner screens whose numbers move when money or a booking changes. A walk-in and a ledger
 * correction used to invalidate `["owner-today"]`, a key nothing reads since Overview moved to `["owner-overview", ...]`,
 * so Overview kept the old totals until its next poll (docs/mobile-audit-2026-10.md P0-6). Invalidate by prefix through
 * `invalidateOwnerMoney` instead of listing keys at each call site. */
export const OWNER_MONEY_KEYS = [
  ["owner-overview"],
  ["owner-overview-slots"],
  ["owner-ledger"],
  ["owner-history"],
  ["owner-badges"],
  ["owner-approvals-queue"],
  ["owner-refunds"],
  ["owner-booking-detail"],
] as const;

export async function invalidateOwnerMoney(qc: { invalidateQueries: (f: { queryKey: readonly unknown[] }) => Promise<unknown> }) {
  await Promise.all(OWNER_MONEY_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}
