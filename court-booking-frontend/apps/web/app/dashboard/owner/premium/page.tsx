"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { premiumStateText, selectionTotal } from "@court-booking/types";
import type { OwnerInvoice } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR } from "@/lib/format";

const INVOICE_STATUS: Record<OwnerInvoice["status"], string> = {
  issued: "Waiting for your payment",
  proof_submitted: "Payment sent, being checked",
  paid: "Paid",
  void: "Cancelled",
  expired: "Expired",
};

export default function OwnerPremiumPage() {
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

  if (query.isLoading) return <p className="p-8 text-owner-ink-faint">Loading…</p>;
  if (query.isError || !data) {
    return (
      <div className="p-8 max-w-xl">
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      </div>
    );
  }

  const total = selectionTotal(data.features, selected);

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Premium features</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          Pick only the features you want and pay only for those. Each one has a {data.trial_days}-day free trial that starts the day
          you switch it on, and you keep the price you switched it on at.
        </p>
      </div>

      {!data.enforced ? (
        <p className="text-sm rounded-lg px-4 py-3" style={{ background: "#E7F2F5", color: "#0E6274" }}>
          Billing has not started yet. Every feature is free for everyone right now and nothing is charged.
        </p>
      ) : null}

      {data.features.length === 0 ? (
        <p className="text-owner-ink-faint">No premium features are on offer right now.</p>
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
                    {premiumStateText(f, data.enforced, data.trial_days)}
                  </p>
                </div>
                <p className="font-mono text-sm font-bold whitespace-nowrap">
                  PKR {formatPKR(f.enabled ? (f.your_price_pkr ?? f.monthly_price_pkr) : f.monthly_price_pkr)}
                  <span className="text-owner-ink-faint font-normal"> / month</span>
                </p>
              </label>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <p className="text-sm">
          Your monthly total: <span data-testid="premium-total" className="font-mono font-extrabold text-lg">PKR {formatPKR(total)}</span>
        </p>
        <button
          data-testid="premium-save"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate([...selected])}
          className="h-11 px-5 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "#0E6274" }}
        >
          {save.isPending ? "Saving…" : "Save my choices"}
        </button>
      </div>
      {save.isError ? (
        <p role="alert" className="text-sm font-semibold text-owner-danger">
          {friendlyErrorMessage(save.error)}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="text-owner-ink-faint text-sm">No invoices yet. The first one arrives about a week before your free trial ends.</p>
        ) : (
          data.invoices.map((inv) => (
            <div key={inv.id} className="bg-owner-surface border border-owner-border rounded-xl px-5 py-4 flex flex-col gap-2">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-sm">
                  {formatDateString(inv.period_start)} to {formatDateString(inv.period_end)}
                </p>
                <p className="font-mono font-bold">PKR {formatPKR(inv.total_pkr)}</p>
              </div>
              <p className="text-xs text-owner-ink-faint">
                {INVOICE_STATUS[inv.status]}. Due {formatDateString(inv.due_date)}.
              </p>
              <ul className="text-xs text-owner-ink-faint list-disc pl-5">
                {inv.lines.map((l) => (
                  <li key={l.feature_key}>
                    {l.description ?? l.feature_key}: PKR {formatPKR(l.amount_pkr)}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
