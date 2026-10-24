"use client";

import { useState } from "react";
import type { PaymentMethod } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";
import { Chip } from "@/components/fl";

const METHODS: { value: PaymentMethod; label: MessageKey }[] = [
  { value: "cash_at_venue", label: "odash.pay.method.cash_at_venue" },
  { value: "bank_transfer_proof", label: "odash.pay.method.bank_transfer_proof" },
  { value: "other", label: "odash.pay.method.other" },
];

/**
 * "Record payment" (Section 32 Part 5): the owner records money actually received against a booking's
 * remaining balance -- refuses to record more than what's still owed, and shows the balance remaining
 * after. Booking is marked fully paid server-side (balance_due = 0) once the entries sum to the price.
 */
export function RecordPaymentSheet({
  bookingId, // i18n-ignore
  playerLabel, // i18n-ignore
  balanceDue, // i18n-ignore
  onClose, // i18n-ignore
  onRecorded, // i18n-ignore
}: {
  bookingId: string;
  playerLabel: string;
  balanceDue: number;
  onClose: () => void;
  onRecorded: (result: { amount_paid: number; balance_due: number }) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(String(Math.round(balanceDue)));
  const [method, setMethod] = useState<PaymentMethod>("cash_at_venue");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balanceDue; // i18n-ignore

  async function handleSubmit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.payments.recordEntry(bookingId, {
        amount_pkr: Math.round(amountNum),
        method, // i18n-ignore
        note: note.trim() || undefined,
      });
      onRecorded({ amount_paid: result.amount_paid, balance_due: result.balance_due });
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" style={{ background: "var(--color-fl-a-scrim)" }} onClick={onClose}>
      <div
        className="bg-owner-surface w-full md:w-[420px] rounded-t-3xl md:rounded-2xl px-5 pt-5 pb-8 md:pb-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-widest" style={{ color: "var(--color-fl-teal)" }}>{t("odash.rec.title")}</span>
            <span className="text-[17px] font-bold text-owner-ink">{playerLabel}</span>
            <span className="tabular-nums text-[13px] text-owner-ink-faint">{t("odash.rec.owed", { amount: formatPKR(balanceDue) })}</span>
          </div>
          <button onClick={onClose} aria-label={t("odash.rec.close")} className="w-10 h-10 rounded-xl flex items-center justify-center font-bold" style={{ background: "var(--color-fl-ground)" }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">{t("odash.rec.amount")}</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="tabular-nums text-[22px] font-semibold px-4 rounded-xl border border-owner-border"
            style={{ height: 54 }}
          />
          {!valid && amount.length > 0 ? (
            <span className="text-[12.5px] font-medium" style={{ color: "var(--color-fl-danger)" }}>
              {amountNum > balanceDue ? t("odash.rec.tooMuch", { amount: formatPKR(balanceDue) }) : t("odash.rec.zero")}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">{t("odash.rec.how")}</label>
          <div className="flex gap-2">
            {METHODS.map((m) => (
              <Chip key={m.value} label={t(m.label)} selected={method === m.value} onClick={() => setMethod(m.value)} className="flex-1" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">{t("odash.rec.note")}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("odash.rec.notePh")}
            className="text-[14px] px-4 rounded-xl border border-owner-border"
            style={{ height: 48 }}
          />
        </div>

        {error ? <p className="text-[13px] font-semibold" style={{ color: "var(--color-fl-danger)" }}>{error}</p> : null}

        <button
          onClick={handleSubmit}
          disabled={!valid || submitting}
          className="rounded-xl text-white font-bold text-[15px] disabled:opacity-50"
          style={{ height: 50, background: "var(--color-fl-teal)" }}
        >
          {submitting ? t("odash.rec.recording") : t("odash.rec.submit", { amount: valid ? formatPKR(amountNum) : "0" })}
        </button>
      </div>
    </div>
  );
}
