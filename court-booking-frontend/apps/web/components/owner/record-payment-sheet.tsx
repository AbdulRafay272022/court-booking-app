"use client";

import { useState } from "react";
import type { PaymentMethod } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash_at_venue", label: "Cash" },
  { value: "bank_transfer_proof", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

/**
 * "Record payment" (Section 32 Part 5): the owner records money actually received against a booking's
 * remaining balance -- refuses to record more than what's still owed, and shows the balance remaining
 * after. Booking is marked fully paid server-side (balance_due = 0) once the entries sum to the price.
 */
export function RecordPaymentSheet({
  bookingId,
  playerLabel,
  balanceDue,
  onClose,
  onRecorded,
}: {
  bookingId: string;
  playerLabel: string;
  balanceDue: number;
  onClose: () => void;
  onRecorded: (result: { amount_paid: number; balance_due: number }) => void;
}) {
  const [amount, setAmount] = useState(String(Math.round(balanceDue)));
  const [method, setMethod] = useState<PaymentMethod>("cash_at_venue");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balanceDue;

  async function handleSubmit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.payments.recordEntry(bookingId, {
        amount_pkr: Math.round(amountNum),
        method,
        note: note.trim() || undefined,
      });
      onRecorded({ amount_paid: result.amount_paid, balance_due: result.balance_due });
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
            <span className="text-[11px] font-bold tracking-widest" style={{ color: "#0E6274" }}>RECORD PAYMENT</span>
            <span className="text-[17px] font-bold text-owner-ink">{playerLabel}</span>
            <span className="font-mono text-[13px] text-owner-ink-faint">PKR {formatPKR(balanceDue)} still owed</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-xl flex items-center justify-center font-bold" style={{ background: "#F4F6F7" }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">Amount (PKR)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="font-mono text-[22px] font-semibold px-4 rounded-xl border border-owner-border"
            style={{ height: 54 }}
          />
          {!valid && amount.length > 0 ? (
            <span className="text-[12.5px] font-medium" style={{ color: "#8C3823" }}>
              {amountNum > balanceDue ? `Can't be more than PKR ${formatPKR(balanceDue)}` : "Enter an amount greater than zero"}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">How was it paid?</label>
          <div className="flex gap-2">
            {METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className="flex-1 rounded-xl text-[13px] font-semibold"
                style={{ height: 44, background: method === m.value ? "#0E6274" : "#F4F6F7", color: method === m.value ? "#fff" : "#5B7079" }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. paid at the counter"
            className="text-[14px] px-4 rounded-xl border border-owner-border"
            style={{ height: 48 }}
          />
        </div>

        {error ? <p className="text-[13px] font-semibold" style={{ color: "#8C3823" }}>{error}</p> : null}

        <button
          onClick={handleSubmit}
          disabled={!valid || submitting}
          className="rounded-xl text-white font-bold text-[15px] disabled:opacity-50"
          style={{ height: 50, background: "#0E6274" }}
        >
          {submitting ? "Recording…" : `Record PKR ${valid ? formatPKR(amountNum) : "0"}`}
        </button>
      </div>
    </div>
  );
}
