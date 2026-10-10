"use client";

import { useQuery } from "@tanstack/react-query";
import { DAY_LABELS, formatTime24As12 } from "@court-booking/types";
import type { AdminCourtActivity, AdminOverview } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatRelativeTime } from "@/lib/format";

const STATE_STYLE: Record<AdminCourtActivity["state"], { label: string; bg: string; fg: string }> = {
  active: { label: "Active", bg: "#D6EDDE", fg: "#1F7A52" },
  suspended: { label: "Suspended", bg: "#F6D6D6", fg: "#B3261E" },
  not_live: { label: "Not live yet", bg: "#E7ECEE", fg: "#5B7079" },
};

export default function AdminOverviewPage() {
  const query = useQuery({ queryKey: ["admin-overview"], queryFn: () => api.admin.overview(), refetchInterval: 60_000 });

  if (query.isLoading) return <p className="p-8 text-owner-ink-faint">Loading…</p>;
  if (query.isError || !query.data) {
    return (
      <div className="p-8 max-w-xl">
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      </div>
    );
  }
  const o = query.data;

  return (
    <div className="p-4 sm:p-8 flex flex-col gap-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Platform overview</h1>
        <p className="text-owner-ink-faint text-sm mt-1">Read-only. Refreshes every minute. Days are Pakistan days.</p>
      </div>

      <UsageSection o={o} />
      <UsersSection o={o} />
      <CourtsSection o={o} />
      <UnderperformingSection o={o} />

      <details className="text-xs text-owner-ink-faint">
        <summary className="cursor-pointer font-semibold">How these numbers are counted</summary>
        <ul className="list-disc pl-5 mt-2 flex flex-col gap-1">
          {o.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint uppercase">{label}</span>
      <span className="font-mono text-xl font-extrabold">{value}</span>
      {sub ? <span className="text-xs text-owner-ink-faint">{sub}</span> : null}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 grid-cols-2 md:grid-cols-4">{children}</div>;
}

function pct(n: number | null): string {
  return n == null ? "n/a" : `${Math.round(n * 100)}%`;
}

function UsageSection({ o }: { o: AdminOverview }) {
  const u = o.usage;
  const decided = u.payments_approved_30_days + u.payments_rejected_30_days;
  return (
    <Section title="Platform usage">
      <Grid>
        <Stat label="Bookings today" value={String(u.bookings.today)} sub={`${u.bookings.last_7_days} in 7 days · ${u.bookings.last_30_days} in 30`} />
        <Stat label="GMV today (PKR)" value={formatPKR(u.gmv_pkr.today)} sub={`${formatPKR(u.gmv_pkr.last_7_days)} in 7 days · ${formatPKR(u.gmv_pkr.last_30_days)} in 30`} />
        <Stat label="Collected today (PKR)" value={formatPKR(u.collected_pkr.today)} sub={`${formatPKR(u.collected_pkr.last_7_days)} in 7 days · ${formatPKR(u.collected_pkr.last_30_days)} in 30`} />
        <Stat
          label="Payment approval rate"
          value={pct(u.payment_approval_rate)}
          sub={`30 days: ${u.payments_approved_30_days} approved · ${u.payments_rejected_30_days} rejected · ${u.payments_pending_30_days} pending${decided === 0 ? "" : ` · ${u.payments_auto_approved_30_days} automatic`}`}
        />
        <Stat label="AI chat · app" value={String(u.chat_messages_app.today)} sub={`today · ${u.chat_messages_app.last_7_days} in 7 days · ${u.chat_messages_app.last_30_days} in 30`} />
        <Stat label="AI chat · WhatsApp" value={String(u.chat_messages_whatsapp.today)} sub={`today · ${u.chat_messages_whatsapp.last_7_days} in 7 days · ${u.chat_messages_whatsapp.last_30_days} in 30`} />
        <Stat label="AI model calls (30 days)" value={String(u.ai_model_calls_30_days)} sub={`${u.ai_tokens_30_days.toLocaleString("en-US")} tokens`} />
      </Grid>
    </Section>
  );
}

function UsersSection({ o }: { o: AdminOverview }) {
  const u = o.users;
  return (
    <Section title="Users">
      <Grid>
        <Stat label="Players" value={String(u.total_players)} sub={`+${u.new_players_7_days} this week · +${u.new_players_30_days} this month`} />
        <Stat label="Venue owners" value={String(u.total_owners)} sub={`+${u.new_owners_7_days} this week · +${u.new_owners_30_days} this month`} />
        <Stat label="Active, last 30 days" value={`${u.active_30_days} of ${u.active_30_days_of_total}`} sub="players and owners" />
        <Stat label="Staff · admins" value={`${u.total_staff} · ${u.total_admins}`} />
      </Grid>
    </Section>
  );
}

function CourtsSection({ o }: { o: AdminOverview }) {
  return (
    <Section title={`Venues and courts (${o.courts.length})`}>
      {o.courts.length === 0 ? (
        <p className="text-owner-ink-faint text-sm">No courts yet.</p>
      ) : (
        <div className="bg-owner-surface border border-owner-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wider uppercase text-owner-ink-faint">
                {["Venue · court", "Sport", "Owner", "Status", "Today", "7 days", "Last booking made", "Activity"].map((h) => (
                  <th key={h} className="px-4 py-3 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {o.courts.map((c) => {
                const st = STATE_STYLE[c.state];
                return (
                  <tr key={c.court_id} className="border-t border-owner-border-light">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{c.venue_name}</p>
                      <p className="text-xs text-owner-ink-faint">{c.court_name}</p>
                    </td>
                    <td className="px-4 py-3">{c.sport}</td>
                    <td className="px-4 py-3">
                      <p>{c.owner_name ?? "No name"}</p>
                      <p className="text-xs text-owner-ink-faint font-mono">{c.owner_phone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{c.bookings_today}</td>
                    <td className="px-4 py-3 font-mono">{c.bookings_7_days}</td>
                    <td className="px-4 py-3">{c.last_booking_at ? formatRelativeTime(c.last_booking_at) : "never"}</td>
                    <td className="px-4 py-3">
                      {c.state !== "active" ? (
                        <span className="text-owner-ink-faint">n/a</span>
                      ) : c.idle ? (
                        <span className="font-semibold" style={{ color: "#9A6208" }}>
                          Idle ({o.idle_days}+ days)
                        </span>
                      ) : (
                        <span className="font-semibold" style={{ color: "#1F7A52" }}>
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function UnderperformingSection({ o }: { o: AdminOverview }) {
  return (
    <Section title="Lowest booking rates (last 28 days)">
      <p className="text-xs text-owner-ink-faint -mt-2">
        Booked hours as a share of open hours. Courts with under a week of history are left out.
      </p>
      {o.underperforming.length === 0 ? (
        <p className="text-owner-ink-faint text-sm">Not enough history yet.</p>
      ) : (
        <div className="bg-owner-surface border border-owner-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wider uppercase text-owner-ink-faint">
                {["Venue · court", "Owner", "Booking rate", "Booked / open hours", "Weakest times"].map((h) => (
                  <th key={h} className="px-4 py-3 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {o.underperforming.map((c) => (
                <tr key={c.court_id} className="border-t border-owner-border-light">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{c.venue_name}</p>
                    <p className="text-xs text-owner-ink-faint">
                      {c.court_name} · {c.sport}
                    </p>
                  </td>
                  <td className="px-4 py-3">{c.owner_name ?? "No name"}</td>
                  <td className="px-4 py-3 font-mono font-bold">{pct(c.booking_rate)}</td>
                  <td className="px-4 py-3 font-mono">
                    {c.booked_hours} / {c.open_hours}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.weakest_slots.length === 0
                      ? "Not enough data yet"
                      : c.weakest_slots
                          .map((w) => `${DAY_LABELS[w.day_of_week]} ${formatTime24As12(`${String(w.hour).padStart(2, "0")}:00`)} (${pct(w.booking_rate)})`)
                          .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
