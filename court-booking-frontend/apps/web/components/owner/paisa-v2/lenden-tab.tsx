"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deductionKey, type PaisaDaybookRow, type PaisaKey } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { useAuthStore } from "@/lib/auth-store";
import { pkrText, signedPkr } from "@/lib/paisa-v2";
import { usePaisaT, type PaisaTFn } from "@/lib/use-paisa-v2";
import { RangeFilters, rangeParams, usePaisaRange } from "./bookings-tab";
import { ReverseSheet, refreshPaisa } from "./booking-sheet";
import { ErrorText, MoneyLine, Section, Select } from "./ui";

type Show = "money" | "with_deductions" | "deductions";
type Method = "" | "cash" | "transfer" | "other";

function rowKind(pt: PaisaTFn, r: PaisaDaybookRow): string {
  if (r.type === "adjustment") return pt(deductionKey(r.kind));
  const k = r.bucket === "correction" || r.kind === "correction" ? "correction" : r.bucket;
  return pt(`paisa.h.${k}` as PaisaKey);
}

/** Len-den (contract 5.4 / 6.1): every payment / refund by business day, the day's total in its header, In − Out = Net. */
export function LendenTab({ venueId, courts, onOpenBooking }: { venueId?: string; courts: { id: string; name: string }[]; onOpenBooking: (id: string) => void }) {
  const t = useT();
  const pt = usePaisaT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const isOwner = useAuthStore((s) => s.user?.role) !== "staff";
  const [range, setRange] = usePaisaRange();
  const [show, setShow] = useState<Show>("money");
  const [method, setMethod] = useState<Method>("");
  const [person, setPerson] = useState("");
  const [onlyRefunds, setOnlyRefunds] = useState(false);
  const [fix, setFix] = useState<PaisaDaybookRow | null>(null);
  const params = rangeParams(range, venueId);
  const q = useQuery({
    queryKey: ["paisa", "daybook", params, show, method, onlyRefunds],
    queryFn: () => api.paisa.daybook({ ...params, show, method: method || undefined, kind: onlyRefunds ? "refund" : undefined }),
    enabled: !!venueId,
    placeholderData: (prev) => prev,
  });
  const people = useMemo(() => {
    const names = new Set<string>();
    for (const d of q.data?.days ?? []) for (const r of d.rows) if (r.by) names.add(r.by);
    return [...names].sort();
  }, [q.data]);
  const days = (q.data?.days ?? [])
    .map((d) => ({ ...d, rows: person ? d.rows.filter((r) => r.by === person) : d.rows }))
    .filter((d) => d.rows.length);
  const f = q.data?.footer;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="paisa-lenden">
      <RangeFilters range={range} setRange={setRange} courts={courts} />
      <div className="flex flex-wrap items-end gap-3">
        <Select<Show>
          label={pt("paisa.lenden.show")}
          value={show}
          onChange={setShow}
          testId="lenden-show"
          options={(["money", "with_deductions", "deductions"] as const).map((v) => ({ value: v, label: pt(`paisa.lenden.show.${v}` as PaisaKey) }))}
        />
        <Select<Method>
          label={pt("paisa.lenden.method")}
          value={method}
          onChange={setMethod}
          testId="lenden-method"
          options={[
            { value: "", label: pt("paisa.lenden.method.all") },
            { value: "cash", label: pt("paisa.in.cash") },
            { value: "transfer", label: pt("paisa.in.transfer") },
            { value: "other", label: pt("paisa.in.other") },
          ]}
        />
        <Select<string>
          label={pt("paisa.lenden.person")}
          value={person}
          onChange={setPerson}
          testId="lenden-person"
          options={[{ value: "", label: pt("paisa.lenden.person.all") }, ...people.map((p) => ({ value: p, label: p }))]}
        />
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[14px] font-semibold text-owner-ink">
          <input type="checkbox" checked={onlyRefunds} onChange={(e) => setOnlyRefunds(e.target.checked)} data-testid="lenden-only-refunds" className="h-4 w-4" />
          {pt("paisa.lenden.onlyRefunds")}
        </label>
      </div>

      {q.isError ? <ErrorText text={friendlyErrorMessage(q.error, t)} /> : null}
      {q.isLoading ? <p className="py-6 text-center text-owner-ink-faint">{pt("paisa.loading")}</p> : null}
      {q.data && days.length === 0 ? (
        <p className="rounded-xl border border-owner-border bg-owner-surface py-8 text-center text-owner-ink-faint">{pt("paisa.empty.lenden")}</p>
      ) : null}

      {days.map((d) => (
        <section key={d.date} className="rounded-xl border border-owner-border bg-owner-surface" data-testid="lenden-day">
          <header className="flex items-baseline justify-between gap-3 rounded-t-xl border-b border-owner-border-light bg-owner-bg px-4 py-2.5">
            <h3 className="text-[14px] font-bold text-owner-ink">{fmt.dateRelative(`${d.date}T12:00:00+05:00`)}</h3>
            <span className="text-[13px] font-semibold tabular-nums text-owner-ink-muted">{pt("paisa.lenden.dayTotal", { amount: signedPkr(d.total) })}</span>
          </header>
          <ul className="divide-y divide-owner-border-light">
            {d.rows.map((r) => (
              <li key={`${r.type}-${r.id}`} className="flex items-center gap-3 px-4 py-3" data-testid="lenden-row">
                <button type="button" onClick={() => onOpenBooking(r.booking_id)} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left">
                  <span className="truncate text-[14.5px] font-semibold text-owner-ink">{r.player}</span>
                  <span className="text-[12.5px] text-owner-ink-muted">
                    {[rowKind(pt, r), r.method ? pt(`paisa.in.${r.method}` as PaisaKey) : null, r.by].filter(Boolean).join(" · ")}
                  </span>
                  <span className="text-[12.5px] text-owner-ink-faint">
                    {`${r.short_code} · ${pt("paisa.lenden.slotDay", { date: fmt.dateRelative(`${r.slot_business_date}T12:00:00+05:00`) })}`}
                  </span>
                </button>
                <span className={`shrink-0 text-right text-[15px] font-bold tabular-nums ${r.amount < 0 ? "text-owner-danger" : "text-owner-ink"}`}>{signedPkr(r.amount)}</span>
                <span className="w-9 shrink-0 text-right">
                  {isOwner && r.type === "entry" && r.kind === "payment" && r.amount > 0 ? (
                    <button
                      type="button"
                      aria-label={pt("paisa.act.fix")}
                      title={pt("paisa.act.fix")}
                      onClick={() => setFix(r)}
                      data-testid="lenden-fix"
                      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-lg font-bold text-owner-ink-muted hover:bg-owner-bg"
                    >
                      ⋯
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {f ? (
        <Section testId="lenden-footer">
          <MoneyLine label={pt("paisa.lenden.in")} value={pkrText(f.in)} />
          <MoneyLine label={`− ${pt("paisa.lenden.out")}`} value={signedPkr(-f.out)} tone={f.out ? "danger" : undefined} />
          <MoneyLine label={`= ${pt("paisa.lenden.net")}`} value={pkrText(f.net)} strong />
          {f.cash_by.length ? (
            <div className="flex flex-col gap-1 border-t border-owner-border-light pt-2">
              <span className="px-2 text-[12.5px] font-bold text-owner-ink-muted">{pt("paisa.lenden.cashBy")}</span>
              {f.cash_by.map((c) => (
                <MoneyLine key={c.name ?? "-"} label={c.name ?? pt("paisa.lenden.unknownPerson")} value={pkrText(c.amount)} />
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {fix ? (
        <ReverseSheet
          item={{ id: fix.id, type: "entry", amount: fix.amount, kind: fix.kind }}
          venueId={venueId}
          onClose={() => setFix(null)}
          onDone={() => {
            setFix(null);
            void refreshPaisa(qc);
          }}
        />
      ) : null}
    </div>
  );
}
