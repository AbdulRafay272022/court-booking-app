"use client";

import {
  DAY_LABELS,
  GRID_MINUTES,
  SLOT_MINUTES_OPTIONS,
  WEEKDAY_NUMBERS,
  WEEKEND_NUMBERS,
  courtSetupProblem,
  hiddenRates,
  formatTime24As12,
  hoursKind,
  makePricingRule,
  slotPreview,
  type CourtSetup,
  type PricingRuleDraft,
} from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { TFunction } from "@/lib/i18n";
import { Chip, Field, FieldLabel, SectionCard, SectionLabel } from "./ui";
import { TimeField12 } from "./time-fields";

/**
 * Everything an owner sets for ONE court -- slot length (with a live "you will get N slots" preview), opening hours
 * and prices (with weekday choices for weekend/peak rules). The wizard and Venue Settings both render this, once per
 * court, so no court ever silently takes another court's hours or prices (Section 32 Part 4).
 */
export function CourtSetupFields({
  value,
  onChange,
  slotChangeNote = false,
}: {
  value: CourtSetup;
  onChange: (patch: Partial<CourtSetup>) => void;
  /** Venue Settings only: say what changing the slot length does to bookings that already exist. */
  slotChangeNote?: boolean;
}) {
  const t = useT();
  const fmt = useFmt();
  const problem = courtSetupProblem(value);
  const hoursProblem = problem && !/price/i.test(problem) ? problem : null;
  const hidden = hiddenRates(value);

  function updateRule(id: string, patch: Partial<PricingRuleDraft>) {
    onChange({ pricingRules: value.pricingRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function removeRule(id: string) {
    const rules = value.pricingRules.filter((r) => r.id !== id);
    onChange({ pricingRules: rules.length > 0 ? rules : [makePricingRule("All day")] });
  }

  return (
    <>
      <SectionCard>
        <SectionLabel>{t("setup.slot.title")}</SectionLabel>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">
          {t("setup.slot.help")}
        </p>
        <div className="flex flex-wrap gap-2">
          {SLOT_MINUTES_OPTIONS.map((m) => (
            <Chip key={m} label={t("setup.slot.min", { m })} selected={value.slotMinutes === m} onClick={() => onChange({ slotMinutes: m })} />
          ))}
        </div>
        <SlotPreviewLine value={value} />
        {slotChangeNote ? (
          <p className="text-[12.5px] font-medium text-owner-ink-faint">
            {t("setup.slot.changeNote")}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <SectionLabel>{t("setup.hours.title")}</SectionLabel>
          <button
            type="button"
            onClick={() => onChange({ sameHoursEveryDay: !value.sameHoursEveryDay })}
            className="min-h-10 text-[13px] font-semibold text-owner-accent"
          >
            {value.sameHoursEveryDay ? t("setup.hours.toggleDifferent") : t("setup.hours.toggleSame")}
          </button>
        </div>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">{t("setup.hours.pkt")}</p>

        {value.sameHoursEveryDay ? (
          <div className="flex flex-col gap-2">
            <HoursSummary open={value.openTime} close={value.closeTime} t={t} />
            <div className="flex flex-wrap gap-3">
              <TimeField12 label={t("setup.hours.opens")} value={value.openTime} onChange={(v) => onChange({ openTime: v })} />
              <TimeField12 label={t("setup.hours.closes")} value={value.closeTime} onChange={(v) => onChange({ closeTime: v })} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {DAY_LABELS.map((_label, day) => {
              const dayName = t(`setup.day.${day}` as "setup.day.0");
              const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
              const kind = hoursKind(o.open, o.close);
              return (
                <div key={day} role="group" aria-label={dayName} className="flex flex-col gap-2 rounded-[10px] border border-owner-border p-3" data-testid={`hours-day-${day}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-owner-ink">{dayName}</span>
                    {kind !== "same-day" ? (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-owner-border bg-owner-bg px-2.5 py-0.5 text-[11.5px] font-semibold text-owner-ink-muted" data-testid="hours-pill">
                        {kind === "24-hours" ? t("setup.hours.pillOpen24") : t("setup.hours.pillNextDay")}
                      </span>
                    ) : null}
                  </div>
                  <HoursSummary open={o.open} close={o.close} t={t} />
                  <div className="flex flex-wrap gap-3">
                    <TimeField12
                      label={t("setup.hours.opens")}
                      ariaLabel={t("setup.hours.opensAria", { day: dayName })}
                      value={o.open}
                      onChange={(v) => onChange({ perDayOverrides: { ...value.perDayOverrides, [day]: { ...o, open: v } } })}
                    />
                    <TimeField12
                      label={t("setup.hours.closes")}
                      ariaLabel={t("setup.hours.closesAria", { day: dayName })}
                      value={o.close}
                      onChange={(v) => onChange({ perDayOverrides: { ...value.perDayOverrides, [day]: { ...o, close: v } } })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {value.sameHoursEveryDay ? <HoursKindNote open={value.openTime} close={value.closeTime} /> : null}
        {hoursProblem ? (
          <p role="alert" className="text-[13px] font-semibold text-owner-danger">
            {fmt.validation(hoursProblem)}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard>
        <SectionLabel>{t("setup.pricing.title")}</SectionLabel>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">
          {t("setup.pricing.help")}
        </p>
        {value.pricingRules.map((rule) => (
          <div key={rule.id} className="border border-owner-border rounded-[10px] p-4 flex flex-col gap-3">
            <div className="flex items-end gap-3">
              <Field label={t("setup.pricing.name")} value={rule.name} onChange={(e) => updateRule(rule.id, { name: e.target.value })} />
              {value.pricingRules.length > 1 ? (
                <button type="button" onClick={() => removeRule(rule.id)} className="pb-3 text-[12.5px] font-medium text-owner-danger">
                  {t("setup.pricing.remove")}
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Field
                label={t("setup.pricing.perSlot", { duration: fmt.duration(value.slotMinutes) })}
                value={rule.pricePerSlot}
                onChange={(e) => updateRule(rule.id, { pricePerSlot: e.target.value.replace(/\D/g, "") })}
                inputMode="numeric"
                placeholder="2500"
                mono
              />
              <TimeField12 label={t("setup.pricing.from")} optional value={rule.startTime ?? ""} onChange={(v) => updateRule(rule.id, { startTime: v || null })} />
              <TimeField12 label={t("setup.pricing.to")} optional value={rule.endTime ?? ""} onChange={(v) => updateRule(rule.id, { endTime: v || null })} />
            </div>
            <RuleDays rule={rule} onChange={(dayOfWeek) => updateRule(rule.id, { dayOfWeek })} />
            {hidden[rule.id] ? (
              <p role="alert" className="text-[12.5px] font-semibold text-owner-danger">
                {fmt.validation(hidden[rule.id].message)}
              </p>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ pricingRules: [...value.pricingRules, makePricingRule("Peak hours")] })}
          className="self-start min-h-10 px-3 rounded-lg border border-owner-border text-[13px] font-semibold text-owner-accent"
        >
          {t("setup.pricing.add")}
        </button>
      </SectionCard>
    </>
  );
}

/** One line that states the pair of times, e.g. "10:00 AM – 3:00 AM (next day)"; it re-renders whenever a select changes. */
function HoursSummary({ open, close, t }: { open: string; close: string; t: TFunction }) {
  const kind = hoursKind(open, close);
  const text =
    kind === "24-hours"
      ? t("setup.hours.summaryOpen24")
      : t(kind === "next-day" ? "setup.hours.summaryNextDay" : "setup.hours.summary", { open: formatTime24As12(open), close: formatTime24As12(close) });
  return (
    <p aria-live="polite" className="text-[13.5px] font-semibold text-owner-ink" data-testid="hours-summary">
      {text}
    </p>
  );
}

/** Says what the pair of times means when the court stays open past midnight (Section 32 Part 3). */
function HoursKindNote({ open, close }: { open: string; close: string }) {
  const t = useT();
  const kind = hoursKind(open, close);
  if (kind === "same-day") return null;
  return (
    <p className="text-[13px] font-semibold text-owner-accent" data-testid="hours-kind-note">
      {kind === "24-hours" ? t("setup.hours.noteOpen24") : t("setup.hours.noteNextDay", { close: formatTime24As12(close) })}
    </p>
  );
}

/** "11 slots a day, 6:00 AM to 10:30 PM", plus a warning when the closing time leaves a gap too short for a slot. */
function SlotPreviewLine({ value }: { value: CourtSetup }) {
  const t = useT();
  const fmt = useFmt();
  if (value.sameHoursEveryDay) {
    const p = slotPreview(value.openTime, value.closeTime, GRID_MINUTES);
    return (
      <div className="flex flex-col gap-1" data-testid="slot-preview">
        <p className="text-[13.5px] font-semibold text-owner-ink">{fmt.slotPreviewText(value.openTime, value.closeTime, GRID_MINUTES)}</p>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">
          {t(value.slotMinutes <= GRID_MINUTES ? "setup.slot.minBookingOne" : "setup.slot.minBookingMany", {
            duration: fmt.duration(value.slotMinutes),
            n: Math.ceil(value.slotMinutes / GRID_MINUTES),
          })}
        </p>
        {p && p.lastEnd !== value.closeTime.slice(0, 5) ? (
          <p className="text-[12.5px] font-medium text-owner-ink-faint">
            {t("setup.slot.lastEnd", {
              last: formatTime24As12(p.lastEnd),
              close: formatTime24As12(value.closeTime),
              slot: fmt.duration(GRID_MINUTES),
            })}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <p className="text-[13.5px] font-semibold text-owner-ink" data-testid="slot-preview">
      {t("setup.slot.perDay")}{" "}
      {DAY_LABELS.map((_label, day) => {
        const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
        return `${fmt.weekday(day)} ${slotPreview(o.open, o.close, GRID_MINUTES)?.count ?? 0}`;
      }).join(" · ")}
    </p>
  );
}

/** Which days a price rule applies to: shortcuts for the common cases, and one toggle per weekday. */
function RuleDays({ rule, onChange }: { rule: PricingRuleDraft; onChange: (days: number[] | null) => void }) {
  const t = useT();
  const fmt = useFmt();
  const days = rule.dayOfWeek;
  const same = (a: number[] | null, b: number[]) => !!a && a.length === b.length && b.every((d) => a.includes(d));
  function toggle(day: number) {
    const current = days ?? [0, 1, 2, 3, 4, 5, 6];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b);
    onChange(next.length === 0 || next.length === 7 ? null : next);
  }
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{t("setup.days.label")}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip label={t("setup.days.every")} selected={days === null} onClick={() => onChange(null)} />
        <Chip label={t("setup.days.weekdays")} selected={same(days, WEEKDAY_NUMBERS)} onClick={() => onChange(WEEKDAY_NUMBERS)} />
        <Chip label={t("setup.days.weekends")} selected={same(days, WEEKEND_NUMBERS)} onClick={() => onChange(WEEKEND_NUMBERS)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {DAY_LABELS.map((label, day) => (
          <Chip key={label} label={fmt.weekday(day)} selected={days === null || days.includes(day)} onClick={() => toggle(day)} />
        ))}
      </div>
    </div>
  );
}
