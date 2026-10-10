"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { OwnerBillingDetail, OwnerFeatureBilling, OwnerInvoiceDetail } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatRelativeTime } from "@/lib/format";

const FEATURE_STATE: Record<OwnerFeatureBilling["state"], { label: string; bg: string; fg: string }> = {
  trial: { label: "Free trial", bg: "#E7F2F5", fg: "#0E6274" },
  paid: { label: "Paid", bg: "#D6EDDE", fg: "#1F7A52" },
  grace: { label: "Overdue, still working", bg: "#FBF0DD", fg: "#8A5208" },
  lapsed: { label: "Switched off", bg: "#F6D6D6", fg: "#B3261E" },
  unpaid: { label: "Trial over, unpaid", bg: "#F6D6D6", fg: "#B3261E" },
};

const INVOICE_STATE: Record<string, string> = {
  issued: "Waiting for payment",
  proof_submitted: "Screenshot sent, to be checked",
  paid: "Paid",
  void: "Cancelled",
  expired: "Expired",
};

const PAYMENT_STATE: Record<string, string> = {
  submitted: "Waiting to be checked",
  approved: "Approved",
  rejected: "Rejected",
  reversal: "Reversed (correction)",
};

export default function OwnerBillingPage() {
  const { ownerId } = useParams<{ ownerId: string }>();
  const query = useQuery({ queryKey: ["admin-billing-owner", ownerId], queryFn: () => api.admin.billingOwner(ownerId), enabled: !!ownerId });

  if (query.isLoading) return <p className="p-8 text-owner-ink-faint">Loading…</p>;
  if (query.isError || !query.data) {
    return (
      <div className="p-8 max-w-xl">
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      </div>
    );
  }
  const d = query.data;

  return (
    <div className="p-4 sm:p-8 flex flex-col gap-8 max-w-5xl">
      <div>
        <Link href="/dashboard/admin/billing" className="text-sm font-semibold underline" style={{ color: "#0E6274" }}>
          ← Premium revenue
        </Link>
        <h1 className="text-2xl font-bold mt-2">{d.name ?? "No name"}</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          {d.phone}
          {d.email ? ` · ${d.email}` : ""}
        </p>
        {!d.enforced ? (
          <p className="mt-3 text-sm font-semibold rounded-lg px-4 py-3" style={{ background: "#FBF0DD", color: "#8A5208", border: "1px solid #EBCB93" }}>
            Billing is not switched on yet, so this owner is not being charged.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="owner-totals">
        <Stat label="Billed per month" value={`PKR ${formatPKR(d.monthly_pkr)}`} />
        <Stat label="Unpaid" value={`PKR ${formatPKR(d.outstanding_pkr)}`} tone={d.outstanding_pkr > 0 ? "#B3261E" : undefined} />
        <Stat label="Paid so far" value={`PKR ${formatPKR(d.collected_pkr)}`} />
      </div>

      <Features d={d} />
      <Invoices d={d} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl px-4 py-3 flex flex-col gap-0.5">
      <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint uppercase">{label}</span>
      <span className="font-mono text-xl font-extrabold" style={{ color: tone }}>{value}</span>
    </div>
  );
}

function Features({ d }: { d: OwnerBillingDetail }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Features</h2>
      {d.features.length === 0 ? (
        <p className="text-owner-ink-faint text-sm">This owner has not switched on any premium feature.</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="owner-features">
          {d.features.map((f) => {
            const st = FEATURE_STATE[f.state];
            return (
              <div key={f.key} className="bg-owner-surface border border-owner-border rounded-xl px-5 py-4 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{f.label}</span>
                  <span className="px-2 py-1 rounded-full text-xs font-bold" style={{ background: st.bg, color: st.fg }}>
                    {st.label}
                  </span>
                </div>
                <p className="text-sm text-owner-ink-faint">
                  PKR {formatPKR(f.price_pkr)} a month · switched on {formatDateString(f.enabled_at.slice(0, 10))} · free trial{" "}
                  {f.state === "trial" ? "ends" : "ended"} {formatDateString(f.trial_ends_on)}
                  {f.paid_through ? ` · paid through ${formatDateString(f.paid_through)}` : " · nothing paid yet"}
                </p>
                <p className="text-xs text-owner-ink-faint">
                  {f.entitled && f.works_until ? `Works until ${formatDateString(f.works_until)}. ` : "Not working for this owner. "}
                  {f.renewing ? "Renewing." : "Cancelled: will not renew."}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Invoices({ d }: { d: OwnerBillingDetail }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Invoices and payments</h2>
      {d.invoices.length === 0 ? (
        <p className="text-owner-ink-faint text-sm">No invoice has been issued yet.</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="owner-invoices">
          {d.invoices.map((inv) => (
            <InvoiceCard key={inv.id} inv={inv} />
          ))}
        </div>
      )}
    </section>
  );
}

function InvoiceCard({ inv }: { inv: OwnerInvoiceDetail }) {
  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl px-5 py-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {formatDateString(inv.period_start)} to {formatDateString(inv.period_end)}
        </span>
        <span className="font-mono font-bold">PKR {formatPKR(inv.total_pkr)}</span>
      </div>
      <p className="text-xs text-owner-ink-faint">
        {INVOICE_STATE[inv.status] ?? inv.status} · due {formatDateString(inv.due_date)}
        {inv.paid_at ? ` · paid ${formatRelativeTime(inv.paid_at)}` : ""}
      </p>
      <ul className="text-xs text-owner-ink-faint list-disc pl-5">
        {inv.lines.map((l) => (
          <li key={l.feature_key + l.period_start}>
            {l.description ?? l.feature_key}: PKR {formatPKR(l.amount_pkr)}
          </li>
        ))}
      </ul>
      {inv.payments.length > 0 ? (
        <div className="border-t border-owner-border pt-2 flex flex-col gap-1">
          {inv.payments.map((p) => (
            <p key={p.id} className="text-xs flex flex-wrap gap-x-3">
              <span className="font-mono font-semibold" style={{ color: p.amount_pkr < 0 ? "#B3261E" : undefined }}>
                {p.amount_pkr < 0 ? "-" : ""}PKR {formatPKR(Math.abs(p.amount_pkr))}
              </span>
              <span>{PAYMENT_STATE[p.status] ?? p.status}</span>
              <span className="text-owner-ink-faint">{p.method.replace(/_/g, " ")}</span>
              <span className="text-owner-ink-faint">{formatRelativeTime(p.reviewed_at ?? p.created_at)}</span>
              {p.rejection_reason ? <span className="text-owner-ink-faint">Reason: {p.rejection_reason}</span> : null}
              {p.note && p.status !== "rejected" ? <span className="text-owner-ink-faint">{p.note}</span> : null}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
