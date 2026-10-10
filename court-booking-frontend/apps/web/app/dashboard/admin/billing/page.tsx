"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { BillingSummary, OwnerBillingState } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatRelativeTime } from "@/lib/format";

const STATE_STYLE: Record<OwnerBillingState, { label: string; bg: string; fg: string }> = {
  off: { label: "Switched off", bg: "#F6D6D6", fg: "#B3261E" },
  overdue: { label: "Overdue", bg: "#FBF0DD", fg: "#8A5208" },
  trial: { label: "Free trial", bg: "#E7F2F5", fg: "#0E6274" },
  paying: { label: "Paying", bg: "#D6EDDE", fg: "#1F7A52" },
  none: { label: "No features", bg: "#E7ECEE", fg: "#5B7079" },
};

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export default function PremiumRevenuePage() {
  const summary = useQuery({ queryKey: ["admin-billing-summary"], queryFn: () => api.admin.billingSummary(), refetchInterval: 60_000 });
  const [search, setSearch] = useState("");
  const owners = useQuery({
    queryKey: ["admin-billing-owners", search],
    queryFn: () => api.admin.billingOwners(search.trim() || undefined),
    placeholderData: (prev) => prev,
  });

  if (summary.isLoading) return <p className="p-8 text-owner-ink-faint">Loading…</p>;
  if (summary.isError || !summary.data) {
    return (
      <div className="p-8 max-w-xl">
        <ErrorState message={friendlyErrorMessage(summary.error)} onRetry={() => summary.refetch()} tone="owner" />
      </div>
    );
  }
  const s = summary.data;

  return (
    <div className="p-4 sm:p-8 flex flex-col gap-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Premium revenue</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          Read-only. Money owners pay for premium features. Days are Pakistan days.
        </p>
        {!s.enforced ? (
          <p
            className="mt-3 text-sm font-semibold rounded-lg px-4 py-3"
            style={{ background: "#FBF0DD", color: "#8A5208", border: "1px solid #EBCB93" }}
            data-testid="not-enforced-note"
          >
            Billing is not switched on yet, so nobody is being charged. These figures show what would be billed from the
            features owners have turned on.
          </p>
        ) : null}
      </div>

      <MoneySection s={s} />
      <FeaturesSection s={s} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Owners</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search owners"
            className="h-10 px-3 rounded-lg border border-owner-border bg-owner-surface text-sm w-64 max-w-full"
          />
        </div>
        {owners.isError ? (
          <ErrorState message={friendlyErrorMessage(owners.error)} onRetry={() => owners.refetch()} tone="owner" />
        ) : !owners.data ? (
          <p className="text-owner-ink-faint text-sm">Loading…</p>
        ) : owners.data.length === 0 ? (
          <p className="text-owner-ink-faint text-sm">
            {search.trim() ? "No owner matches that." : "No owner has switched on a premium feature yet."}
          </p>
        ) : (
          <div className="bg-owner-surface border border-owner-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm" data-testid="owners-table">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-owner-ink-faint">
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Standing</th>
                  <th className="px-4 py-3 text-right">Features</th>
                  <th className="px-4 py-3 text-right">Per month</th>
                  <th className="px-4 py-3 text-right">Unpaid</th>
                  <th className="px-4 py-3 text-right">Paid so far</th>
                  <th className="px-4 py-3">Works until</th>
                  <th className="px-4 py-3">Last payment</th>
                </tr>
              </thead>
              <tbody>
                {owners.data.map((o) => {
                  const st = STATE_STYLE[o.state];
                  return (
                    <tr key={o.owner_id} className="border-t border-owner-border">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/admin/billing/${o.owner_id}`} className="font-semibold underline" style={{ color: "#0E6274" }}>
                          {o.name ?? "No name"}
                        </Link>
                        <div className="text-xs text-owner-ink-faint">{o.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-full text-xs font-bold" style={{ background: st.bg, color: st.fg }}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{o.features_on}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatPKR(o.monthly_pkr)}</td>
                      <td className="px-4 py-3 text-right font-mono" style={{ color: o.outstanding_pkr > 0 ? "#B3261E" : undefined }}>
                        {formatPKR(o.outstanding_pkr)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatPKR(o.collected_pkr)}</td>
                      <td className="px-4 py-3">{o.next_due ? formatDateString(o.next_due) : "—"}</td>
                      <td className="px-4 py-3">{o.last_payment_at ? formatRelativeTime(o.last_payment_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="text-xs text-owner-ink-faint">
        <summary className="cursor-pointer font-semibold">How these numbers are counted</summary>
        <ul className="list-disc pl-5 mt-2 flex flex-col gap-1">
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint uppercase">{label}</span>
      <span className="font-mono text-xl font-extrabold" style={{ color: tone }}>{value}</span>
      {sub ? <span className="text-xs text-owner-ink-faint">{sub}</span> : null}
    </div>
  );
}

function MoneySection({ s }: { s: BillingSummary }) {
  const max = Math.max(1, ...s.months.map((m) => m.collected_pkr));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Money</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="money-stats">
        <Stat label="Collected this month" value={`PKR ${formatPKR(s.collected_this_month_pkr)}`} sub={`Last month PKR ${formatPKR(s.collected_last_month_pkr)}`} />
        <Stat label="Recurring a month" value={`PKR ${formatPKR(s.recurring_pkr)}`} sub="Paid for or overdue" />
        <Stat label="In free trial" value={`PKR ${formatPKR(s.trial_value_pkr)}`} sub="a month, not revenue yet" />
        <Stat label="At risk" value={`PKR ${formatPKR(s.at_risk_pkr)}`} sub="a month, switched off" tone={s.at_risk_pkr > 0 ? "#B3261E" : undefined} />
        <Stat label="Unpaid invoices" value={`PKR ${formatPKR(s.outstanding.total_pkr)}`} sub={`${s.outstanding.count} invoice${s.outstanding.count === 1 ? "" : "s"}`} />
        <Stat label="Past their due date" value={`PKR ${formatPKR(s.overdue.total_pkr)}`} sub={`${s.overdue.count} invoice${s.overdue.count === 1 ? "" : "s"}`} tone={s.overdue.count > 0 ? "#B3261E" : undefined} />
        <Stat label="Screenshots to check" value={String(s.screenshots_to_check)} sub="waiting for you" />
        <Stat label="Collected, all time" value={`PKR ${formatPKR(s.collected_all_time_pkr)}`} sub="after reversals" />
      </div>

      <div className="bg-owner-surface border border-owner-border rounded-xl px-4 py-4">
        <p className="text-[11px] font-bold tracking-wider text-owner-ink-faint uppercase mb-3">Collected by month</p>
        <div className="flex items-end gap-3 h-32" data-testid="month-bars">
          {s.months.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0">
              <span className="text-[11px] font-mono text-owner-ink-faint">{m.collected_pkr > 0 ? formatPKR(m.collected_pkr) : "0"}</span>
              <div
                className="w-full rounded-t"
                style={{ height: `${Math.max(2, (m.collected_pkr / max) * 80)}%`, background: m.collected_pkr > 0 ? "#0E6274" : "#D5DEE1" }}
              />
              <span className="text-[11px] text-owner-ink-faint">{monthLabel(m.month)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection({ s }: { s: BillingSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">By feature</h2>
      <div className="bg-owner-surface border border-owner-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm" data-testid="feature-table">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-owner-ink-faint">
              <th className="px-4 py-3">Feature</th>
              <th className="px-4 py-3 text-right">List price</th>
              <th className="px-4 py-3 text-right">Owners</th>
              <th className="px-4 py-3 text-right">Trial</th>
              <th className="px-4 py-3 text-right">Paying</th>
              <th className="px-4 py-3 text-right">Overdue</th>
              <th className="px-4 py-3 text-right">Off</th>
              <th className="px-4 py-3 text-right">Per month</th>
            </tr>
          </thead>
          <tbody>
            {s.by_feature.map((f) => (
              <tr key={f.key} className="border-t border-owner-border">
                <td className="px-4 py-3 font-semibold">
                  {f.label}
                  {!f.is_sellable ? <span className="ml-2 text-xs font-normal text-owner-ink-faint">not on sale</span> : null}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatPKR(f.list_price_pkr)}</td>
                <td className="px-4 py-3 text-right font-mono">{f.owners_on}</td>
                <td className="px-4 py-3 text-right font-mono">{f.on_trial}</td>
                <td className="px-4 py-3 text-right font-mono">{f.paying}</td>
                <td className="px-4 py-3 text-right font-mono">{f.overdue}</td>
                <td className="px-4 py-3 text-right font-mono">{f.off}</td>
                <td className="px-4 py-3 text-right font-mono">{formatPKR(f.recurring_pkr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-owner-ink-faint">
        Owners: {s.owners.with_premium} with a premium feature · {s.owners.paying} paying · {s.owners.on_trial_only} only on free trial ·{" "}
        {s.owners.overdue} overdue · {s.owners.off} with something switched off.
      </p>
    </section>
  );
}
