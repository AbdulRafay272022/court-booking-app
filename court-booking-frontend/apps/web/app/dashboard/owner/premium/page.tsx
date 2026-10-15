"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { selectionTotal } from "@court-booking/types";
import type { OwnerInvoice, OwnerPremiumFeature, PlatformPaymentDetails } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { Fmt } from "@/lib/format-i18n";
import type { MessageKey, TFunction } from "@/lib/i18n";

/** Where a feature stands for this owner, in the visitor's language (mirrors `premiumStateText` in packages/types, which is English only). */
function stateText(t: TFunction, fmt: Fmt, f: OwnerPremiumFeature, enforced: boolean, trialDays: number): string {
  if (!f.enabled && !f.cancelled) return t("odash.premium.s.notOn", { days: trialDays });
  if (f.cancelled) {
    const until = f.paid_through ?? f.trial_ends_on;
    return until && f.entitled ? t("odash.premium.s.cancelledUntil", { date: fmt.dateString(until) }) : t("odash.premium.s.cancelled");
  }
  if (!enforced) return f.trial_ends_on ? t("odash.premium.s.onTrial", { date: fmt.dateString(f.trial_ends_on) }) : t("odash.premium.s.on");
  switch (f.state) {
    case "trial": {
      const trial = f.trial_ends_on ? t("odash.premium.s.trialUntil", { date: fmt.dateString(f.trial_ends_on) }) : t("odash.premium.s.trial");
      return f.paid_through && f.trial_ends_on && f.paid_through > f.trial_ends_on ? `${trial} ${t("odash.premium.s.paidUntil", { date: fmt.dateString(f.paid_through) })}` : trial;
    }
    case "paid":
      return f.paid_through ? t("odash.premium.s.paidUntil", { date: fmt.dateString(f.paid_through) }) : t("odash.premium.s.paid");
    case "grace":
      return t("odash.premium.s.grace");
    case "lapsed":
      return t("odash.premium.s.lapsed");
    case "unpaid":
      return t("odash.premium.s.unpaid");
    default:
      return t("odash.premium.s.on");
  }
}

export default function OwnerPremiumPage() {
  const t = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["owner-premium"], queryFn: () => api.premium.get() });
  const data = query.data;

  // The owner's unsaved ticks. null = nothing touched yet, so the screen simply shows what is switched on.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const enabledKeys = new Set((data?.features ?? []).filter((f) => f.enabled).map((f) => f.key));
  const selected = picked ?? enabledKeys;

  const save = useMutation({
    mutationFn: (keys: string[]) => api.premium.setSelection(keys),
    onSuccess: (fresh) => {
      qc.setQueryData(["owner-premium"], fresh);
      setPicked(null);
    },
  });

  const changed = enabledKeys.size !== selected.size || [...selected].some((k) => !enabledKeys.has(k));

  if (query.isLoading) return <p className="p-8 text-owner-ink-faint">{t("odash.premium.loading")}</p>;
  if (query.isError || !data) {
    return (
      <div className="p-8 max-w-xl">
        <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
      </div>
    );
  }

  const total = selectionTotal(data.features, selected);

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.premium.title")}</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          {t("odash.premium.intro", { days: data.trial_days })}
        </p>
      </div>

      {!data.enforced ? (
        <p className="text-sm rounded-lg px-4 py-3" style={{ background: "#E7F2F5", color: "#0E6274" }}>
          {t("odash.premium.notEnforced")}
        </p>
      ) : null}

      {data.features.length === 0 ? (
        <p className="text-owner-ink-faint">{t("odash.premium.none")}</p>
      ) : (
        <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden">
          {data.features.map((f) => {
            const on = selected.has(f.key);
            return (
              <label key={f.key} className="flex items-start gap-4 px-5 py-4 border-b border-owner-border-light last:border-0 cursor-pointer">
                <input
                  data-testid={`pick-${f.key}`}
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(f.key);
                    else next.delete(f.key);
                    setPicked(next);
                  }}
                  className="w-5 h-5 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{f.label}</p>
                  {f.description ? <p className="text-xs text-owner-ink-faint mt-0.5">{f.description}</p> : null}
                  <p className="text-xs mt-1.5" style={{ color: f.entitled || !f.enabled ? "#5B7079" : "#B3261E" }}>
                    {stateText(t, fmt, f, data.enforced, data.trial_days)}
                  </p>
                </div>
                <p className="font-mono text-sm font-bold whitespace-nowrap">
                  PKR {formatPKR(f.enabled ? (f.your_price_pkr ?? f.monthly_price_pkr) : f.monthly_price_pkr)}
                  <span className="text-owner-ink-faint font-normal">{t("odash.premium.perMonth")}</span>
                </p>
              </label>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <p className="text-sm">
          {t("odash.premium.total")} <span data-testid="premium-total" className="font-mono font-extrabold text-lg">PKR {formatPKR(total)}</span>
        </p>
        <button
          data-testid="premium-save"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate([...selected])}
          className="h-11 px-5 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "#0E6274" }}
        >
          {save.isPending ? t("odash.premium.saving") : t("odash.premium.save")}
        </button>
      </div>
      {save.isError ? (
        <p role="alert" className="text-sm font-semibold text-owner-danger">
          {friendlyErrorMessage(save.error, t)}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t("odash.premium.invoices")}</h2>
        {data.invoices.length === 0 ? (
          <p className="text-owner-ink-faint text-sm">{t("odash.premium.noInvoices")}</p>
        ) : (
          data.invoices.map((inv) => (
            <div key={inv.id} className="bg-owner-surface border border-owner-border rounded-xl px-5 py-4 flex flex-col gap-2">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-sm">
                  {t("odash.premium.period", { from: fmt.dateString(inv.period_start), to: fmt.dateString(inv.period_end) })}
                </p>
                <p className="font-mono font-bold">PKR {formatPKR(inv.total_pkr)}</p>
              </div>
              <p className="text-xs text-owner-ink-faint">
                {t("odash.premium.due", { status: t(`odash.premium.inv.${inv.status}` as MessageKey), date: fmt.dateString(inv.due_date) })}
              </p>
              <ul className="text-xs text-owner-ink-faint list-disc pl-5">
                {inv.lines.map((l) => (
                  <li key={l.feature_key}>
                    {l.description ?? l.feature_key}: PKR {formatPKR(l.amount_pkr)}
                  </li>
                ))}
              </ul>
              {inv.status === "issued" ? (
                <PayBox invoice={inv} instructions={data.payment_instructions} onPaid={(fresh) => qc.setQueryData(["owner-premium"], fresh)} />
              ) : null}
            </div>
          ))
        )}
      </section>
    </div>
  );
}


function PayBox({
  invoice, // i18n-ignore
  instructions, // i18n-ignore
  onPaid, // i18n-ignore
}: {
  invoice: OwnerInvoice;
  instructions: PlatformPaymentDetails | null;
  onPaid: (fresh: Awaited<ReturnType<typeof api.premium.get>>) => void;
}) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const upload = useMutation({
    mutationFn: (f: File) => api.premium.submitInvoiceProof(invoice.id, f, f.name, f.type || "image/jpeg", setProgress),
    onSuccess: (fresh) => {
      setFile(null);
      onPaid(fresh);
    },
    onSettled: () => setProgress(0),
  });

  return (
    <div className="mt-2 rounded-lg border border-owner-border px-4 py-3 flex flex-col gap-2" style={{ background: "#F7FAFB" }}>
      {invoice.last_rejection_reason ? (
        <p role="alert" className="text-xs font-semibold text-owner-danger">
          {t("odash.premium.rejected", { reason: invoice.last_rejection_reason })}
        </p>
      ) : null}
      <p className="text-sm font-semibold">{t("odash.premium.payInstr", { amount: formatPKR(invoice.total_pkr) })}</p>
      {instructions ? (
        <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {instructions.bank ? (<><dt className="text-owner-ink-faint">{t("odash.premium.bank")}</dt><dd className="font-mono">{instructions.bank}</dd></>) : null}
          {instructions.account_title ? (<><dt className="text-owner-ink-faint">{t("odash.premium.accTitle")}</dt><dd className="font-mono">{instructions.account_title}</dd></>) : null}
          {instructions.account_number ? (<><dt className="text-owner-ink-faint">{t("odash.premium.accNumber")}</dt><dd className="font-mono">{instructions.account_number}</dd></>) : null}
          {instructions.iban ? (<><dt className="text-owner-ink-faint">{t("odash.premium.iban")}</dt><dd className="font-mono">{instructions.iban}</dd></>) : null}
        </dl>
      ) : (
        <p className="text-xs text-owner-ink-faint">{t("odash.premium.noDetails")}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          data-testid={`proof-${invoice.id}`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <button
          data-testid={`send-proof-${invoice.id}`}
          disabled={!file || upload.isPending}
          onClick={() => file && upload.mutate(file)}
          className="h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "#0E6274" }}
        >
          {upload.isPending ? t("odash.premium.sending", { pct: Math.round(progress * 100) }) : t("odash.premium.send")}
        </button>
      </div>
      {upload.isError ? (
        <p role="alert" className="text-xs font-semibold text-owner-danger">
          {friendlyErrorMessage(upload.error, t)}
        </p>
      ) : null}
    </div>
  );
}
