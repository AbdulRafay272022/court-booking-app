import { formatDateString } from "./datetime";

/** Owner premium billing (admin price list, an owner's chosen features, invoices). Money is whole PKR. */

export interface PremiumFeature {
  key: string;
  label: string;
  description: string | null;
  monthly_price_pkr: number;
  is_sellable: boolean;
  updated_at: string;
}

export interface PremiumFeatureUpdate {
  monthly_price_pkr?: number;
  is_sellable?: boolean;
}

export interface InvoiceLine {
  feature_key: string;
  description: string | null;
  amount_pkr: number;
  period_start: string;
  period_end: string;
  prorated_days: number | null;
}

export interface OwnerInvoice {
  id: string;
  period_start: string;
  period_end: string;
  total_pkr: number;
  status: "issued" | "proof_submitted" | "paid" | "void" | "expired";
  due_date: string;
  created_at: string;
  lines: InvoiceLine[];
  /** Why the last screenshot was not accepted, while the invoice waits for a new one. */
  last_rejection_reason: string | null;
}

/** Where an owner pays the platform; null until the operator has configured the receiving account. */
export interface PlatformPaymentDetails {
  bank: string;
  account_title: string;
  account_number: string;
  iban: string;
}

export type PremiumState =
  | "not_billed"
  | "not_enforced"
  | "trial"
  | "paid"
  | "grace"
  | "lapsed"
  | "unpaid"
  | "not_purchased";

export interface OwnerPremiumFeature {
  key: string;
  label: string;
  description: string | null;
  monthly_price_pkr: number;
  enabled: boolean;
  your_price_pkr: number | null;
  entitled: boolean;
  state: PremiumState;
  trial_ends_on: string | null;
  paid_through: string | null;
  cancelled: boolean;
}

export interface OwnerPremium {
  payment_instructions: PlatformPaymentDetails | null;
  enforced: boolean;
  trial_days: number;
  grace_days: number;
  features: OwnerPremiumFeature[];
  monthly_total_pkr: number;
  invoices: OwnerInvoice[];
}

/** One plain sentence about where a feature stands for this owner ("Free trial until Sat, 24 Oct"). The one place that wording lives. */
export function premiumStateText(f: OwnerPremiumFeature, enforced: boolean, trialDays = 15): string {
  if (!f.enabled && !f.cancelled) {
    return `Not switched on. Switching it on starts a ${trialDays}-day free trial.`;
  }
  if (f.cancelled) {
    const until = f.paid_through ?? f.trial_ends_on;
    return until && f.entitled ? `Cancelled. Keeps working until ${formatDateString(until)}.` : "Cancelled.";
  }
  if (!enforced) return f.trial_ends_on ? `Switched on. Free trial until ${formatDateString(f.trial_ends_on)}.` : "Switched on.";
  switch (f.state) {
    case "trial": {
      const trial = f.trial_ends_on ? `Free trial until ${formatDateString(f.trial_ends_on)}.` : "Free trial.";
      // an invoice paid ahead of the end of the trial: say so, or the owner cannot tell their payment landed
      return f.paid_through && f.trial_ends_on && f.paid_through > f.trial_ends_on ? `${trial} Paid until ${formatDateString(f.paid_through)}.` : trial;
    }
    case "paid":
      return f.paid_through ? `Paid until ${formatDateString(f.paid_through)}.` : "Paid.";
    case "grace":
      return "Payment is overdue. It still works for a few more days: pay now to keep it.";
    case "lapsed":
      return "Switched off because payment is overdue. Pay to turn it back on straight away.";
    case "unpaid":
      return "Free trial is over. Pay your invoice to keep it.";
    default:
      return "Switched on.";
  }
}

/** What the total would be if the owner saves this selection: kept features at their locked price, new ones at today's price. */
export function selectionTotal(features: OwnerPremiumFeature[], selected: ReadonlySet<string>): number {
  return features.reduce((sum, f) => (selected.has(f.key) ? sum + (f.enabled ? (f.your_price_pkr ?? f.monthly_price_pkr) : f.monthly_price_pkr) : sum), 0);
}

/** Admin side: a payment an owner made (or an admin recorded) against a premium invoice. */
export interface AdminOwnerPayment {
  id: string;
  invoice_id: string;
  owner_id: string;
  owner_name: string | null;
  owner_phone: string;
  amount_pkr: number;
  method: string;
  status: "submitted" | "approved" | "rejected" | "reversal";
  note: string | null;
  reference: string | null;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  proof_url: string | null;
  invoice_period_start: string;
  invoice_period_end: string;
  invoice_total_pkr: number;
  lines: InvoiceLine[];
  reversed: boolean;
}

export interface AdminOwnerInvoice {
  id: string;
  owner_id: string;
  owner_name: string | null;
  owner_phone: string;
  period_start: string;
  period_end: string;
  total_pkr: number;
  status: OwnerInvoice["status"];
  due_date: string;
  created_at: string;
  lines: InvoiceLine[];
}

export type RecordablePaymentMethod = "bank_transfer" | "cash" | "other";
