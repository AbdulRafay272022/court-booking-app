/**
 * QA round 2 (count clarity): the Approvals badge (= queue total) counts BOTH payments waiting for approval and grey
 * cards (player cancelled / expired) that still need "Theek hai". The page header splits that one number honestly:
 * "N approvals baqi" + "(M cancel/expire hue, Theek hai dabayein)". N + M always equals the badge (minus cards the
 * owner just acted on). One implementation for web and mobile.
 */
import type { ApprovalState } from "./round2";

export interface ApprovalsHeaderCounts {
  /** Everything still listed (the badge number, minus cards already acted on here). */
  left: number;
  /** Payments really waiting for Approve / Reject. */
  awaiting: number;
  /** Grey cards (cancelled / expired) that only need "Theek hai". */
  closed: number;
}

export function approvalsHeaderCounts(
  total: number,
  loaded: readonly { payment_id: string; state: ApprovalState }[],
  removed: ReadonlySet<string>,
  overrides: Readonly<Record<string, ApprovalState>> = {},
): ApprovalsHeaderCounts {
  const left = Math.max(0, total - loaded.filter((i) => removed.has(i.payment_id)).length);
  const closed = Math.min(
    left,
    loaded.filter((i) => !removed.has(i.payment_id) && (overrides[i.payment_id] ?? i.state) !== "awaiting").length,
  );
  return { left, awaiting: Math.max(0, left - closed), closed };
}
