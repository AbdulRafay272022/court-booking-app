"use client";

import { useState } from "react";
import type { LedgerEntry } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";

/**
 * "Correct a payment" (Section 32 Part 5): reverses a mistaken ledger entry -- never edits or deletes it.
 * Touches real money, so this is a two-step confirm (open the sheet, read the entry back, type a reason,
 * then click Confirm) rather than a single-click action. A venue owner can correct their own venue's
 * entries; an admin can correct any (enforced server-side, same accessible-booking check as recording one).
 */
export function CorrectPaymentSheet({
  entry, // i18n-ignore
  onClose, // i18n-ignore
  onReversed, // i18n-ignore
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onReversed: () => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length > 0;
  const methodLabel = (m: string) => {
    const key = `odash.fix.m.${m}` as MessageKey;
    const label = t(key);
    return label !== key ? label : m.replace(/_/g, " ");
  };

  async function handleConfirm() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.reverseEntry(entry.entry_id, reason.trim());
      onReversed();
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
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
            <span className="text-[11px] font-bold tracking-widest" style={{ color: "#8C3823" }}>{t("odash.fix.title")}</span>
            <span className="text-[17px] font-bold text-owner-ink">{entry.player ?? t("odash.fix.walkin")}</span>
          </div>
          <button onClick={onClose} aria-label={t("odash.rec.close")} className="w-10 h-10 rounded-xl flex items-center justify-center font-bold" style={{ background: "#F4F6F7" }}>
            ✕
          </button>
        </div>

        <div className="rounded-xl p-3.5 flex flex-col gap-1.5" style={{ background: "#F4F6F7" }}>
          <Row label={t("odash.fix.amount")} value={`PKR ${formatPKR(entry.amount_pkr)}`} />
          <Row label={t("odash.fix.recorded")} value={fmt.when(entry.recorded_at)} />
          <Row label={t("odash.fix.court")} value={entry.court} />
          <Row label={t("odash.fix.booking")} value={fmt.when(entry.starts_at)} />
          <Row label={t("odash.fix.method")} value={methodLabel(entry.method)} />
        </div>

        <p className="text-owner-ink-faint text-[12.5px]">{t("odash.fix.note", { amount: formatPKR(entry.amount_pkr) })}</p>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-owner-ink">{t("odash.fix.why")}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("odash.fix.whyPh")}
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
          {submitting ? t("odash.fix.reversing") : t("odash.fix.confirm")}
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
