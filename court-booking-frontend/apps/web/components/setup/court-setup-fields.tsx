"use client";

import {
  DAY_LABELS,
  SLOT_MINUTES_OPTIONS,
  WEEKDAY_NUMBERS,
  WEEKEND_NUMBERS,
  courtSetupProblem,
  formatDuration,
  formatTime24As12,
  hoursKind,
  makePricingRule,
  slotPreview,
  slotPreviewText,
  type CourtSetup,
  type PricingRuleDraft,
} from "@court-booking/types";
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
  const problem = courtSetupProblem(value);
  const hoursProblem = problem && !/price/i.test(problem) ? problem : null;

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
        <SectionLabel>Slot length</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {SLOT_MINUTES_OPTIONS.map((m) => (
            <Chip key={m} label={`${m} min`} selected={value.slotMinutes === m} onClick={() => onChange({ slotMinutes: m })} />
          ))}
        </div>
        <SlotPreviewLine value={value} />
        {slotChangeNote ? (
          <p className="text-[12.5px] font-medium text-owner-ink-faint">
            Bookings already made keep their own times if you change this. Any new time that would overlap one of them stays unavailable.
          </p>
        ) : null}
      </SectionCard>

      <SectionCard>
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Opening hours</SectionLabel>
          <button
            type="button"
            onClick={() => onChange({ sameHoursEveryDay: !value.sameHoursEveryDay })}
            className="text-[13px] font-semibold text-owner-accent"
          >
            {value.sameHoursEveryDay ? "Set different hours per day" : "Use same hours every day"}
          </button>
        </div>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">Times are Pakistan time (PKT).</p>

        {value.sameHoursEveryDay ? (
          <div className="flex flex-wrap gap-3">
            <TimeField12 label="Opens" value={value.openTime} onChange={(v) => onChange({ openTime: v })} />
            <TimeField12 label="Closes" value={value.closeTime} onChange={(v) => onChange({ closeTime: v })} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {DAY_LABELS.map((label, day) => {
              const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
              return (
                <div key={day} className="flex flex-wrap items-end gap-3">
                  <span className="text-sm font-medium w-full sm:w-10 sm:pb-3">
                    {label}
                    {hoursKind(o.open, o.close) !== "same-day" ? (
                      <span className="ml-2 text-[11.5px] font-semibold text-owner-accent">
                        {hoursKind(o.open, o.close) === "24-hours" ? "Open 24 hours" : "Closes next day"}
                      </span>
                    ) : null}
                  </span>
                  <TimeField12
                    label=""
                    ariaLabel={`${label} opens`}
                    value={o.open}
                    onChange={(v) => onChange({ perDayOverrides: { ...value.perDayOverrides, [day]: { ...o, open: v } } })}
                  />
                  <TimeField12
                    label=""
                    ariaLabel={`${label} closes`}
                    value={o.close}
                    onChange={(v) => onChange({ perDayOverrides: { ...value.perDayOverrides, [day]: { ...o, close: v } } })}
                  />
                </div>
              );
            })}
          </div>
        )}
        {value.sameHoursEveryDay ? <HoursKindNote open={value.openTime} close={value.closeTime} /> : null}
        {hoursProblem ? (
          <p role="alert" className="text-[13px] font-semibold text-owner-danger">
            {hoursProblem}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard>
        <SectionLabel>Prices for this court</SectionLabel>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">
          The first rate is the everyday price. Add a rate for peak hours or weekends: pick the days and the times it
          applies to, and it replaces the everyday price for those slots.
        </p>
        {value.pricingRules.map((rule) => (
          <div key={rule.id} className="border border-owner-border rounded-[10px] p-4 flex flex-col gap-3">
            <div className="flex items-end gap-3">
              <Field label="Name" value={rule.name} onChange={(e) => updateRule(rule.id, { name: e.target.value })} />
              {value.pricingRules.length > 1 ? (
                <button type="button" onClick={() => removeRule(rule.id)} className="pb-3 text-[12.5px] font-medium text-owner-danger">
                  Remove
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Field
                label="Per slot (PKR)"
                value={rule.pricePerSlot}
                onChange={(e) => updateRule(rule.id, { pricePerSlot: e.target.value.replace(/\D/g, "") })}
                inputMode="numeric"
                placeholder="2500"
                mono
              />
              <TimeField12 label="From (optional)" optional value={rule.startTime ?? ""} onChange={(v) => updateRule(rule.id, { startTime: v || null })} />
              <TimeField12 label="To (optional)" optional value={rule.endTime ?? ""} onChange={(v) => updateRule(rule.id, { endTime: v || null })} />
            </div>
            <RuleDays rule={rule} onChange={(dayOfWeek) => updateRule(rule.id, { dayOfWeek })} />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ pricingRules: [...value.pricingRules, makePricingRule("Peak hours")] })}
          className="self-start min-h-10 px-3 rounded-lg border border-owner-border text-[13px] font-semibold text-owner-accent"
        >
          + Add a peak or weekend rate
        </button>
      </SectionCard>
    </>
  );
}

/** Says what the pair of times means when the court stays open past midnight (Section 32 Part 3). */
function HoursKindNote({ open, close }: { open: string; close: string }) {
  const kind = hoursKind(open, close);
  if (kind === "same-day") return null;
  return (
    <p className="text-[13px] font-semibold text-owner-accent" data-testid="hours-kind-note">
      {kind === "24-hours"
        ? "Open 24 hours: each day runs from its opening time to the same time the next morning."
        : `Closes next day: the court stays open past midnight until ${formatTime24As12(close)} the next morning. That night belongs to the day it opens, so a Thursday 3 PM to 3 AM court covers Thursday 3 PM through Friday 3 AM.`}
    </p>
  );
}

/** "11 slots a day, 6:00 AM to 10:30 PM", plus a warning when the closing time leaves a gap too short for a slot. */
function SlotPreviewLine({ value }: { value: CourtSetup }) {
  if (value.sameHoursEveryDay) {
    const p = slotPreview(value.openTime, value.closeTime, value.slotMinutes);
    return (
      <div className="flex flex-col gap-1" data-testid="slot-preview">
        <p className="text-[13.5px] font-semibold text-owner-ink">{slotPreviewText(value.openTime, value.closeTime, value.slotMinutes)}</p>
        {p && p.lastEnd !== value.closeTime.slice(0, 5) ? (
          <p className="text-[12.5px] font-medium text-owner-ink-faint">
            The last slot ends at {formatTime24As12(p.lastEnd)}; the time left before {formatTime24As12(value.closeTime)} is shorter than one{" "}
            {formatDuration(value.slotMinutes)} slot, so it is not offered.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <p className="text-[13.5px] font-semibold text-owner-ink" data-testid="slot-preview">
      Slots a day:{" "}
      {DAY_LABELS.map((label, day) => {
        const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
        return `${label} ${slotPreview(o.open, o.close, value.slotMinutes)?.count ?? 0}`;
      }).join(" · ")}
    </p>
  );
}

/** Which days a price rule applies to: shortcuts for the common cases, and one toggle per weekday. */
function RuleDays({ rule, onChange }: { rule: PricingRuleDraft; onChange: (days: number[] | null) => void }) {
  const days = rule.dayOfWeek;
  const same = (a: number[] | null, b: number[]) => !!a && a.length === b.length && b.every((d) => a.includes(d));
  function toggle(day: number) {
    const current = days ?? [0, 1, 2, 3, 4, 5, 6];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b);
    onChange(next.length === 0 || next.length === 7 ? null : next);
  }
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Days this price applies to</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip label="Every day" selected={days === null} onClick={() => onChange(null)} />
        <Chip label="Weekdays" selected={same(days, WEEKDAY_NUMBERS)} onClick={() => onChange(WEEKDAY_NUMBERS)} />
        <Chip label="Weekends" selected={same(days, WEEKEND_NUMBERS)} onClick={() => onChange(WEEKEND_NUMBERS)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {DAY_LABELS.map((label, day) => (
          <Chip key={label} label={label} selected={days === null || days.includes(day)} onClick={() => toggle(day)} />
        ))}
      </div>
    </div>
  );
}
