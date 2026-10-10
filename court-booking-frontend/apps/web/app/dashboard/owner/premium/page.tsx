"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { premiumStateText, selectionTotal } from "@court-booking/types";
import type { OwnerInvoice, PlatformPaymentDetails } from "@court-booking/types";
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
  invoice,
  instructions,
  onPaid,
}: {
  invoice: OwnerInvoice;
  instructions: PlatformPaymentDetails | null;
  onPaid: (fresh: Awaited<ReturnType<typeof api.premium.get>>) => void;
}) {
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
          Your last screenshot was not accepted: {invoice.last_rejection_reason}. Please upload it again.
        </p>
      ) : null}
      <p className="text-sm font-semibold">Pay PKR {formatPKR(invoice.total_pkr)} by bank transfer, then upload the screenshot</p>
      {instructions ? (
        <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {instructions.bank ? (<><dt className="text-owner-ink-faint">Bank</dt><dd className="font-mono">{instructions.bank}</dd></>) : null}
          {instructions.account_title ? (<><dt className="text-owner-ink-faint">Account title</dt><dd className="font-mono">{instructions.account_title}</dd></>) : null}
          {instructions.account_number ? (<><dt className="text-owner-ink-faint">Account number</dt><dd className="font-mono">{instructions.account_number}</dd></>) : null}
          {instructions.iban ? (<><dt className="text-owner-ink-faint">IBAN</dt><dd className="font-mono">{instructions.iban}</dd></>) : null}
        </dl>
      ) : (
        <p className="text-xs text-owner-ink-faint">Payment details are not available yet. Please contact support.</p>
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
          {upload.isPending ? `Sending… ${Math.round(progress * 100)}%` : "Send screenshot"}
        </button>
      </div>
      {upload.isError ? (
        <p role="alert" className="text-xs font-semibold text-owner-danger">
          {friendlyErrorMessage(upload.error)}
        </p>
      ) : null}
    </div>
  );
}
