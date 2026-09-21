import { Pressable, Text, View } from "react-native";
import {
  DAY_LABELS,
  SLOT_MINUTES_OPTIONS,
  WEEKDAY_NUMBERS,
  WEEKEND_NUMBERS,
  courtSetupProblem,
  formatDuration,
  formatTime24As12,
  makePricingRule,
  slotPreview,
  slotPreviewText,
  type CourtSetup,
  type PricingRuleDraft,
} from "@court-booking/types";

import { TimeField12 } from "./time-fields";
import { Chip, FieldLabel, SectionCard, SectionLabel, TextField } from "../app/(owner)/venue-setup/_components";

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
        <View className="flex-row flex-wrap gap-2">
          {SLOT_MINUTES_OPTIONS.map((m) => (
            <Chip key={m} label={`${m} min`} selected={value.slotMinutes === m} onPress={() => onChange({ slotMinutes: m })} />
          ))}
        </View>
        <SlotPreviewLine value={value} />
        {slotChangeNote ? (
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            Bookings already made keep their own times if you change this. Any new time that would overlap one of them stays unavailable.
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard>
        <View className="flex-row items-center justify-between">
          <SectionLabel>Opening hours</SectionLabel>
          <Pressable onPress={() => onChange({ sameHoursEveryDay: !value.sameHoursEveryDay })}>
            <Text className="font-plex-semibold text-owner-accent text-[13px]">
              {value.sameHoursEveryDay ? "Set different hours per day" : "Use same hours every day"}
            </Text>
          </Pressable>
        </View>
        <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">Times are Pakistan time (PKT).</Text>

        {value.sameHoursEveryDay ? (
          <View className="flex-row gap-3">
            <TimeField12 label="Opens" value={value.openTime} onChange={(v) => onChange({ openTime: v })} />
            <TimeField12 label="Closes" value={value.closeTime} onChange={(v) => onChange({ closeTime: v })} />
          </View>
        ) : (
          <View className="gap-3">
            {DAY_LABELS.map((label, day) => {
              const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
              return (
                <View key={day} className="flex-row items-center gap-3">
                  <Text className="font-plex-medium text-owner-ink text-sm w-10">{label}</Text>
                  <View className="flex-1">
                    <TimeField12 label="" value={o.open} onChange={(v) => onChange({ perDayOverrides: { ...value.perDayOverrides, [day]: { ...o, open: v } } })} />
                  </View>
                  <View className="flex-1">
                    <TimeField12 label="" value={o.close} onChange={(v) => onChange({ perDayOverrides: { ...value.perDayOverrides, [day]: { ...o, close: v } } })} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {hoursProblem ? <Text className="font-plex-semibold text-owner-danger text-[13px]">{hoursProblem}</Text> : null}
      </SectionCard>

      <SectionCard>
        <SectionLabel>Prices for this court</SectionLabel>
        <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
          The first rate is the everyday price. Add a rate for peak hours or weekends: pick the days and the times it applies
          to, and it replaces the everyday price for those slots.
        </Text>
        {value.pricingRules.map((rule) => (
          <View key={rule.id} className="border border-owner-border rounded-[10px] p-3.5 gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <TextField label="Name" value={rule.name} onChangeText={(v) => updateRule(rule.id, { name: v })} />
              </View>
              {value.pricingRules.length > 1 ? (
                <Pressable onPress={() => removeRule(rule.id)} className="mt-6">
                  <Text className="font-plex-medium text-owner-danger text-[12.5px]">Remove</Text>
                </Pressable>
              ) : null}
            </View>
            <TextField
              label="Per slot (PKR)"
              value={rule.pricePerSlot}
              onChangeText={(v) => updateRule(rule.id, { pricePerSlot: v.replace(/\D/g, "") })}
              keyboardType="number-pad"
              placeholder="2500"
              mono
            />
            <View className="flex-row gap-3">
              <TimeField12 label="From (optional)" optional value={rule.startTime ?? ""} onChange={(v) => updateRule(rule.id, { startTime: v || null })} />
              <TimeField12 label="To (optional)" optional value={rule.endTime ?? ""} onChange={(v) => updateRule(rule.id, { endTime: v || null })} />
            </View>
            <RuleDays rule={rule} onChange={(dayOfWeek) => updateRule(rule.id, { dayOfWeek })} />
          </View>
        ))}
        <Pressable
          onPress={() => onChange({ pricingRules: [...value.pricingRules, makePricingRule("Peak hours")] })}
          className="min-h-10 px-3 rounded-lg border border-owner-border items-start justify-center self-start"
        >
          <Text className="font-plex-semibold text-owner-accent text-[13px]">+ Add a peak or weekend rate</Text>
        </Pressable>
      </SectionCard>
    </>
  );
}

/** "11 slots a day, 6:00 AM to 10:30 PM", plus a warning when the closing time leaves a gap too short for a slot. */
function SlotPreviewLine({ value }: { value: CourtSetup }) {
  if (value.sameHoursEveryDay) {
    const p = slotPreview(value.openTime, value.closeTime, value.slotMinutes);
    return (
      <View className="gap-1">
        <Text className="font-plex-semibold text-owner-ink text-[13.5px]">{slotPreviewText(value.openTime, value.closeTime, value.slotMinutes)}</Text>
        {p && p.lastEnd !== value.closeTime.slice(0, 5) ? (
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            The last slot ends at {formatTime24As12(p.lastEnd)}; the time left before {formatTime24As12(value.closeTime)} is shorter than one{" "}
            {formatDuration(value.slotMinutes)} slot, so it is not offered.
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <Text className="font-plex-semibold text-owner-ink text-[13.5px]">
      Slots a day:{" "}
      {DAY_LABELS.map((label, day) => {
        const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
        return `${label} ${slotPreview(o.open, o.close, value.slotMinutes)?.count ?? 0}`;
      }).join(" · ")}
    </Text>
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
    <View className="gap-2">
      <FieldLabel>Days this price applies to</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="Every day" selected={days === null} onPress={() => onChange(null)} />
        <Chip label="Weekdays" selected={same(days, WEEKDAY_NUMBERS)} onPress={() => onChange(WEEKDAY_NUMBERS)} />
        <Chip label="Weekends" selected={same(days, WEEKEND_NUMBERS)} onPress={() => onChange(WEEKEND_NUMBERS)} />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {DAY_LABELS.map((label, day) => (
          <Chip key={label} label={label} selected={days === null || days.includes(day)} onPress={() => toggle(day)} />
        ))}
      </View>
    </View>
  );
}

/** The venue's ONE cancellation policy (Section 32 Part 4: per venue, not per court). */
export function CancellationPolicyFields({
  allowed,
  cutoffHours,
  onAllowedChange,
  onCutoffChange,
}: {
  allowed: boolean;
  /** Empty string = no cutoff (cancellable any time before the start). */
  cutoffHours: string;
  onAllowedChange: (allowed: boolean) => void;
  onCutoffChange: (hours: string) => void;
}) {
  return (
    <SectionCard>
      <SectionLabel>Cancellations</SectionLabel>
      <View className="gap-2">
        <FieldLabel>Can a player cancel a booking after they've already paid? This applies to every court at your venue.</FieldLabel>
        <View className="flex-row gap-2">
          <Chip label="Allowed" selected={allowed} onPress={() => onAllowedChange(true)} />
          <Chip label="Not allowed" selected={!allowed} onPress={() => onAllowedChange(false)} />
        </View>
      </View>
      {allowed ? (
        <TextField
          label="Require cancelling at least this many hours before (optional)"
          value={cutoffHours}
          onChangeText={(v) => onCutoffChange(v.replace(/\D/g, ""))}
          keyboardType="number-pad"
          placeholder="Leave blank for no limit"
          mono
        />
      ) : null}
    </SectionCard>
  );
}
