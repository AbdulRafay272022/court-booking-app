"use client";

import { useState } from "react";
import type { LedgerEntry } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";

/**
 * "Correct a payment" (Section 32 Part 5): reverses a mistaken ledger entry -- never edits or deletes it.
 * Touches real money, so this is a two-step confirm (open the sheet, read the entry back, type a reason,
 * then click Confirm) rather than a single-click action. A venue owner can correct their own venue's
 * entries; an admin can correct any (enforced server-side, same accessible-booking check as recording one).
 */
export function CorrectPaymentSheet({
  entry,
  onClose,
  onReversed,
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onReversed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length > 0;

  async function handleConfirm() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.reverseEntry(entry.entry_id, reason.trim());
      onReversed();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div
        className="bg-owner-surface w-full md:w-[420px] rounded-t-3xl md:rounded-2xl px-5 pt-5 pb-8 md:pb-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-widest" style={{ color: "#8C3823" }}>CORRECT A PAYMENT</span>
            <span className="text-[17px] font-bold text-owner-ink">{entry.player ?? "Walk-in"}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-xl flex items-center justify-center font-bold" style={{ background: "#F4F6F7" }}>
            ✕
          </button>
        </div>

        <div className="rounded-xl p-3.5 flex flex-col gap-1.5" style={{ background: "#F4F6F7" }}>
          <Row label="Amount" value={`PKR ${formatPKR(entry.amount_pkr)}`} />
          <Row label="Recorded" value={formatWhen(entry.recorded_at)} />
          <Row label="Court" value={entry.court} />
          <Row label="Booking" value={formatWhen(entry.starts_at)} />
          <Row label="Method" value={entry.method.replace(/_/g, " ")} />
        </div>

        <p className="text-owner-ink-faint text-[12.5px]">
          This will record a new entry for -PKR {formatPKR(entry.amount_pkr)}, so the original stays visible in the
          ledger -- nothing is edited or deleted. The booking&apos;s balance updates immediately.
        </p>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">Why is this being corrected?</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. entered the wrong amount"
            className="text-[14px] px-4 py-3 rounded-xl border border-owner-border resize-none"
            rows={2}
          />
        </div>

        {error ? <p className="text-[13px] font-semibold" style={{ color: "#8C3823" }}>{error}</p> : null}

        <button
          onClick={handleConfirm}
          disabled={!valid || submitting}
          className="rounded-xl text-white font-bold text-[15px] disabled:opacity-50"
          style={{ height: 50, background: "#8C3823" }}
        >
          {submitting ? "Reversing…" : "Confirm reversal"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-owner-ink-faint text-[12.5px]">{label}</span>
      <span className="font-mono text-[12.5px] font-semibold text-owner-ink">{value}</span>
    </div>
  );
}
