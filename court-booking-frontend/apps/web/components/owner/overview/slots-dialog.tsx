"use client";

import { useQueries } from "@tanstack/react-query";
import type { Slot } from "@court-booking/types";
import { api } from "@/lib/api";
import { pollInterval } from "@/lib/polling";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { courtLabel } from "@/components/court-label";
import type { MessageKey } from "@/lib/i18n";
import { SLOT_FILTERS, slotFilterMatches } from "@/lib/overview-helpers";
import type { SlotFilter } from "@/lib/overview-helpers";
import { Modal } from "./overlay";
import type { CourtOption } from "./court-select";

type SlotView = "booked" | "pending" | "blocked" | "free" | "past";

export function slotView(slot: Pick<Slot, "status" | "ends_at">, nowMs: number): SlotView {
  if (slot.status === "booked") return "booked";
  if (slot.status === "held" || slot.status === "payment_submitted") return "pending";
  if (slot.status === "blocked") return "blocked";
  return new Date(slot.ends_at).getTime() <= nowMs ? "past" : "free";
}

const VIEW_STYLE: Record<SlotView, string> = {
  booked: "bg-fl-teal text-fl-white border-fl-teal",
  pending: "bg-fl-waiting-tint text-fl-waiting border-dashed border-fl-waiting-border",
  blocked: "bg-fl-mist text-fl-muted border-dashed border-fl-line-strong line-through",
  free: "bg-fl-teal-tint text-fl-night border-fl-line-strong",
  past: "bg-fl-ground text-fl-muted border-dashed border-fl-line-strong line-through",
};

const VIEW_ICON: Record<SlotView, string> = {
  booked: "M5 12l5 5 9-10",
  pending: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
  blocked: "M6 6l12 12M12 3a9 9 0 100 18 9 9 0 000-18z",
  free: "",
  past: "M5 12h14",
};

const VIEWS: SlotView[] = ["booked", "pending", "blocked", "free", "past"];

function ViewIcon({ view }: { view: SlotView }) {
  if (!VIEW_ICON[view]) return null;
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={VIEW_ICON[view]} />
    </svg>
  );
}

/** "Sab slots dekhein": every slot of the chosen day, grouped by court, with a status legend and a filter. Loads only while open. */
export function SlotsDialog({
  open,
  onClose,
  date,
  courts,
  filter,
  onFilter,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  courts: CourtOption[];
  filter: SlotFilter;
  onFilter: (f: SlotFilter) => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const results = useQueries({
    queries: courts.map((c) => ({
      queryKey: ["ovw-slots", c.id, date],
      queryFn: () => api.availability.forCourtOnDate(c.id, date),
      placeholderData: undefined,
      enabled: open,
      refetchInterval: (query: Parameters<typeof pollInterval>[0]) => pollInterval(query, 15_000),
    })),
  });
  // "now" is the time of the latest fetch, so a slot that has ended since then flips to Past on the next poll
  const nowMs = Math.max(0, ...results.map((r) => r.dataUpdatedAt));
  const anyLoading = results.some((r) => r.isLoading);
  const failed = results.filter((r) => r.isError && !r.data).length;
  const retryAll = () => results.forEach((r) => r.isError && r.refetch());

  return (
    <Modal open={open} onClose={onClose} size="lg" title={t("ovw.slots.title")} subtitle={t("ovw.slots.subtitle", { date: fmt.dateString(date), n: courts.length })} testId="ovw-slots-dialog">
      <ul aria-label={t("ovw.slots.legend")} className="flex flex-wrap gap-x-4 gap-y-2 mb-4">
        {VIEWS.map((v) => (
          <li key={v} className="inline-flex items-center gap-2 text-[13px] font-semibold text-fl-night">
            <span aria-hidden="true" className={`inline-flex items-center justify-center w-6 h-6 rounded-md border ${VIEW_STYLE[v]}`}>
              <ViewIcon view={v} />
            </span>
            {t(`ovw.slots.${v}` as MessageKey)}
          </li>
        ))}
      </ul>

      <div role="group" aria-label={t("ovw.slots.filter")} className="mb-4 flex flex-wrap gap-2" data-testid="ovw-slots-filter">
        {SLOT_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => onFilter(f)}
            data-testid={`ovw-slots-filter-${f}`}
            className={`min-h-11 px-4 rounded-full text-[13px] font-bold whitespace-nowrap border-[1.5px] ${
              filter === f ? "bg-fl-night text-white border-fl-night" : "bg-fl-white text-fl-night border-fl-line-strong"
            }`}
          >
            {f === "all" ? t("ovw.slots.filterAll") : f === "free" ? t("ovw.slots.filterFree") : t(`ovw.slots.${f}` as MessageKey)}
          </button>
        ))}
      </div>

      <div aria-live="polite" role="status">
        {anyLoading ? <p className="text-sm text-fl-muted py-4">{t("ovw.slots.loading")}</p> : null}
        {failed > 0 ? (
          <p className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-owner-danger-soft px-4 py-3 text-sm font-semibold text-owner-danger">
            {t("ovw.slots.error")}
            <button type="button" onClick={retryAll} className="min-h-11 px-3 rounded-lg border-[1.5px] border-owner-danger font-bold">
              {t("ovw.slots.retry")}
            </button>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        {courts.map((court, i) => {
          const slots = results[i]?.data?.slots ?? [];
          const shown = slots.filter((s) => slotFilterMatches(slotView(s, nowMs), filter));
          const regular = shown.filter((s) => !s.after_midnight);
          const late = shown.filter((s) => s.after_midnight);
          const renderSlot = (s: Slot) => {
            const v = slotView(s, nowMs);
            return (
              <li
                key={s.starts_at}
                data-slot-view={v}
                aria-label={`${fmt.time(s.starts_at)}, ${t(`ovw.slots.${v}` as MessageKey)}`}
                className={`h-9 min-w-[5.4rem] px-2 inline-flex items-center justify-center gap-1 rounded-lg border text-[12.5px] font-bold tabular-nums whitespace-nowrap ${VIEW_STYLE[v]}`}
              >
                <ViewIcon view={v} />
                {fmt.time(s.starts_at)}
              </li>
            );
          };
          return (
            <section key={court.id} aria-label={courtLabel(court.name, court.sport)} data-testid="ovw-slots-court">
              <h3 className="flex items-baseline justify-between gap-3 mb-2 font-bold text-[15px] text-fl-night">
                {courtLabel(court.name, court.sport)}
                {slots.length > 0 ? <span className="text-[13px] font-semibold text-fl-muted">{t("ovw.slots.courtCount", { n: shown.length })}</span> : null}
              </h3>
              {slots.length === 0 && results[i] && !results[i].isLoading && !results[i].isError ? (
                <p className="text-sm text-fl-muted">{t("ovw.slots.noSlots")}</p>
              ) : slots.length > 0 && shown.length === 0 ? (
                <p className="text-sm text-fl-muted" data-testid="ovw-slots-filter-empty">
                  {t("ovw.slots.filterEmpty")}
                </p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-1.5">{regular.map(renderSlot)}</ul>
                  {late.length > 0 ? (
                    <>
                      <p className="mt-2 mb-1 text-[12px] font-bold uppercase tracking-wider text-fl-muted">{t("ovw.slots.afterMidnight")}</p>
                      <ul className="flex flex-wrap gap-1.5">{late.map(renderSlot)}</ul>
                    </>
                  ) : null}
                </>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
