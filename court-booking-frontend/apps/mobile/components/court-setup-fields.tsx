import { useState } from "react";
import { Pressable, View } from "react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Text } from "@/components/ui";
import {
  DAY_LABELS,
  GRID_MINUTES,
  SLOT_MINUTES_OPTIONS,
  WEEKDAY_NUMBERS,
  WEEKEND_NUMBERS,
  SETTINGS_DEFAULTS,
  courtSetupProblem,
  formatPkrAmount,
  hiddenRates,
  formatDuration,
  formatTime24As12,
  hoursKind,
  makePricingRule,
  slotPreview,
  slotPreviewText,
  type CourtSetup,
  type PricingRuleDraft,
} from "@court-booking/types";

import { TimeField12 } from "./time-fields";
import { DefaultHint } from "./default-hint";
import { Chip, FieldLabel, SectionCard, SectionLabel, TextField, useReadOnly } from "../app/(owner)/venue-setup/_components";
import { hiddenRateText, ruleWhenText } from "@/lib/court-rule-text";

/**
 * Everything an owner sets for ONE court -- slot length (with a live "you will get N slots" preview), opening hours
 * and prices (with weekday choices for weekend/peak rules). The wizard and Venue Settings both render this, once per
 * court, so no court ever silently takes another court's hours or prices (Section 32 Part 4).
 */
export function CourtSetupFields({
  value,
  onChange,
  slotChangeNote = false,
  layout = "form",
}: {
  value: CourtSetup;
  onChange: (patch: Partial<CourtSetup>) => void;
  /** "board" (Venue Settings, OSettings board): no slot card (the slot sits in the court details grid), and the prices
   * are a "Qeemat ke rules" list of cards that open to edit. "form" (wizard / new court): everything spelled out. */
  layout?: "form" | "board";
  /** Venue Settings only: say what changing the slot length does to bookings that already exist. */
  slotChangeNote?: boolean;
}) {
  const problem = courtSetupProblem(value);
  const hoursProblem = problem && !/price/i.test(problem) ? problem : null;
  const hidden = hiddenRates(value);
  // an EXISTING court (Venue Settings) runs on the backend default (60); a new court starts from the wizard prefill (90)
  const slotKey = slotChangeNote ? "court_slot_minutes" : "slot_minutes";
  const board = layout === "board";
  const readOnly = useReadOnly();
  const [openRule, setOpenRule] = useState<string | null>(null);

  function updateRule(id: string, patch: Partial<PricingRuleDraft>) {
    onChange({ pricingRules: value.pricingRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function removeRule(id: string) {
    const rules = value.pricingRules.filter((r) => r.id !== id);
    onChange({ pricingRules: rules.length > 0 ? rules : [makePricingRule("Aam")] });
  }

  // One rate's editable fields (name, price, times, days and the two kept defaults); both layouts use it.
  const editor = (rule: PricingRuleDraft) => (
    <>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <TextField label="Naam" value={rule.name} onChangeText={(v) => updateRule(rule.id, { name: v })} />
              </View>
              {value.pricingRules.length > 1 ? (
                <Pressable onPress={() => removeRule(rule.id)} className="mt-6">
                  <Text variant="caption" tone="danger">Hatayein</Text>
                </Pressable>
              ) : null}
            </View>
            <TextField
              label={`Har ${formatDuration(value.slotMinutes, "ru")} (PKR)`}
              value={rule.pricePerSlot}
              onChangeText={(v) => updateRule(rule.id, { pricePerSlot: v.replace(/\D/g, "") })}
              keyboardType="number-pad"
              placeholder="2500"
              mono
            />
            <View className="flex-row gap-3">
              <TimeField12 label="Se (optional)" optional value={rule.startTime ?? ""} onChange={(v) => updateRule(rule.id, { startTime: v || null })} />
              <TimeField12 label="Tak (optional)" optional value={rule.endTime ?? ""} onChange={(v) => updateRule(rule.id, { endTime: v || null })} />
            </View>
            <RuleDays rule={rule} onChange={(dayOfWeek) => updateRule(rule.id, { dayOfWeek })} />
            {/* No input for these two (they are kept on save); the owner still sees what applies and can put the default back. */}
            <DefaultHint
              settingKey="advance_percentage"
              text={`Is rate ka advance: ${rule.advancePercentage ?? SETTINGS_DEFAULTS.advance_percentage.value}% (Default: ${SETTINGS_DEFAULTS.advance_percentage.ru})`}
              value={rule.advancePercentage ?? null}
              onReset={() => updateRule(rule.id, { advancePercentage: undefined })}
              testID={`default-rule-advance-${rule.id}`}
            />
            <DefaultHint
              settingKey="floodlight_surcharge"
              text={`Floodlight surcharge: ${formatPkrAmount(rule.floodlightSurcharge ?? (SETTINGS_DEFAULTS.floodlight_surcharge.value as number))} (Default: ${SETTINGS_DEFAULTS.floodlight_surcharge.ru})`}
              value={rule.floodlightSurcharge ?? null}
              onReset={() => updateRule(rule.id, { floodlightSurcharge: undefined })}
              testID={`default-rule-floodlight-${rule.id}`}
            />
    </>
  );

  return (
    <>
      {board ? null : (
      <SectionCard>
        <SectionLabel>Kam se kam booking time</SectionLabel>
        <Text variant="caption" tone="subtle">
          Waqt 30 minute ke slots mein milta hai. Player kam se kam itna waqt (lagatar) book karega, aur 30 minute aur barha sakta hai.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SLOT_MINUTES_OPTIONS.map((m) => (
            <Chip key={m} label={`${m} min`} selected={value.slotMinutes === m} onPress={() => onChange({ slotMinutes: m })} />
          ))}
        </View>
        <DefaultHint
          settingKey={slotKey}
          value={value.slotMinutes}
          onReset={() => onChange({ slotMinutes: SETTINGS_DEFAULTS[slotKey].value as number })}
          testID="default-slot-minutes"
        />
        <SlotPreviewLine value={value} />
        {slotChangeNote ? (
          <Text variant="caption" tone="subtle">
            Ye badalne par pehle se bani bookings apne waqt par rehti hain; neeche likhi qeemat ek kam se kam booking ki hai. Jo naya waqt un se takraye, wo band rahega.
          </Text>
        ) : null}
      </SectionCard>
      )}

      <View style={board ? { backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: 12 } : { backgroundColor: palette.white, borderRadius: radius.card, padding: space[5], gap: space[5] }}>
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          {board ? <Text variant="bodyStrong" accessibilityRole="header">Khulne ke ghante</Text> : <SectionLabel>Khulne ke ghante</SectionLabel>}
          <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} onPress={() => onChange({ sameHoursEveryDay: !value.sameHoursEveryDay })}>
            <Text variant="meta" tone="link" weight="bold">
              {value.sameHoursEveryDay ? "Har din ke alag ghante" : "Har din same ghante"}
            </Text>
          </Pressable>
        </View>
        <Text variant="caption" tone="subtle">Waqt Pakistan time (PKT) hai.</Text>

        {value.sameHoursEveryDay ? (
          <View className="flex-row gap-3">
            <TimeField12 label="Khulta hai" value={value.openTime} onChange={(v) => onChange({ openTime: v })} />
            <TimeField12 label="Band hota hai" value={value.closeTime} onChange={(v) => onChange({ closeTime: v })} />
          </View>
        ) : (
          <View className="gap-3">
            {DAY_LABELS.map((label, day) => {
              const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
              return (
                <View key={day} className="flex-row items-center gap-3">
                  <View className="w-12">
                    <Text variant="body">{label}</Text>
                    {hoursKind(o.open, o.close) !== "same-day" ? (
                      <Text variant="caption" tone="link" weight="bold">
                        {hoursKind(o.open, o.close) === "24-hours" ? "24 ghante" : "Agla din"}
                      </Text>
                    ) : null}
                  </View>
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
        {value.sameHoursEveryDay ? <HoursKindNote open={value.openTime} close={value.closeTime} /> : null}
        {board ? <SlotPreviewLine value={value} /> : null}
        {hoursProblem ? <Text variant="meta" tone="danger" weight="bold">{hoursProblem}</Text> : null}
      </View>

      {board ? (
        <View testID="price-rules" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text variant="bodyStrong" accessibilityRole="header">Qeemat ke rules</Text>
            {readOnly ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Naya qeemat ka rule add karein"
                onPress={() => {
                  const rule = makePricingRule("Peak raat");
                  onChange({ pricingRules: [...value.pricingRules, rule] });
                  setOpenRule(rule.id);
                }}
                style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: palette.tealTint, justifyContent: "center" }}
              >
                <Text variant="label" color={palette.tealDeep}>+ Rule</Text>
              </Pressable>
            )}
          </View>
          {value.pricingRules.map((rule, i) => {
            const open = openRule === rule.id;
            const price = Number(rule.pricePerSlot);
            return (
              <View key={rule.id} style={{ borderWidth: 1.5, borderColor: open ? palette.teal : palette.line, borderRadius: 16, overflow: "hidden" }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${rule.name || "Rate"}, ${rule.pricePerSlot ? formatPkrAmount(price) : "qeemat baqi"}. ${open ? "Band karein" : "Badlein"}`}
                  onPress={() => setOpenRule(open ? null : rule.id)}
                  style={{ padding: 12, gap: 6 }}
                  testID={`rule-card-${i}`}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text variant="bodyBold" style={{ fontSize: 15, flexShrink: 1 }}>{rule.name || "Rate"}</Text>
                    <Text variant="bodyBold" tone={rule.pricePerSlot ? "primary" : "waiting"} style={{ fontSize: 15 }}>
                      {rule.pricePerSlot ? formatPkrAmount(price) : "Qeemat likhein"}
                    </Text>
                  </View>
                  <Text variant="meta" tone="muted">{ruleWhenText(rule, i === 0, value.pricingRules.length > 1)}</Text>
                  {hidden[rule.id] ? (
                    <View style={{ backgroundColor: palette.waitingTint, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 }}>
                      <Text variant="caption" weight="bold" tone="waiting">{hiddenRateText(hidden[rule.id])}</Text>
                    </View>
                  ) : null}
                </Pressable>
                {open ? <View style={{ padding: 12, paddingTop: 0, gap: 12 }}>{editor(rule)}</View> : null}
              </View>
            );
          })}
        </View>
      ) : (
      <SectionCard>
        <SectionLabel>Is court ki qeemat</SectionLabel>
        <Text variant="caption" tone="subtle">
          Pehla rate roz ki qeemat hai. Peak ya weekend ke liye naya rate add karein: din aur waqt chunein, aur un slots par
          wo roz ki qeemat ki jagah lagega.
        </Text>
        {value.pricingRules.map((rule) => (
          <View key={rule.id} className="border border-owner-border rounded-[10px] p-3.5 gap-3">
            {editor(rule)}
            {hidden[rule.id] ? <Text variant="caption" tone="danger" weight="bold">{hiddenRateText(hidden[rule.id])}</Text> : null}
          </View>
        ))}
        <Pressable
          onPress={() => onChange({ pricingRules: [...value.pricingRules, makePricingRule("Peak raat")] })}
          className="min-h-10 px-3 rounded-lg border border-owner-border items-start justify-center self-start"
        >
          <Text variant="meta" tone="link" weight="bold">+ Peak ya weekend rate add karein</Text>
        </Pressable>
      </SectionCard>
      )}
    </>
  );
}

/** Says what the pair of times means when the court stays open past midnight (Section 32 Part 3). */
function HoursKindNote({ open, close }: { open: string; close: string }) {
  const kind = hoursKind(open, close);
  if (kind === "same-day") return null;
  return (
    <Text variant="meta" tone="link" weight="bold">
      {kind === "24-hours"
        ? "24 ghante khula: har din apne khulne ke waqt se agli subah usi waqt tak."
        : `Agle din band: court aadhi raat ke baad agli subah ${formatTime24As12(close)} tak khula rehta hai. Wo raat khulne wale din ki ginti hoti hai, yani Jumerat 3 PM se 3 AM ka court Jumerat 3 PM se Jumma 3 AM tak chalta hai.`}
    </Text>
  );
}

/** "11 slots a day, 6:00 AM to 10:30 PM", plus a warning when the closing time leaves a gap too short for a slot. */
function SlotPreviewLine({ value }: { value: CourtSetup }) {
  if (value.sameHoursEveryDay) {
    const p = slotPreview(value.openTime, value.closeTime, GRID_MINUTES);
    return (
      <View className="gap-1">
        <Text variant="meta" weight="bold">{slotPreviewText(value.openTime, value.closeTime, GRID_MINUTES, "ru")}</Text>
        <Text variant="caption" tone="subtle">
          Kam se kam booking: {formatDuration(value.slotMinutes, "ru")} ({Math.ceil(value.slotMinutes / GRID_MINUTES)} {value.slotMinutes <= GRID_MINUTES ? "slot" : "slots lagatar"}).
        </Text>
        {p && p.lastEnd !== value.closeTime.slice(0, 5) ? (
          <Text variant="caption" tone="subtle">
            Aakhri slot {formatTime24As12(p.lastEnd)} par khatam hota hai; {formatTime24As12(value.closeTime)} se pehle bacha waqt ek{" "}
            {formatDuration(GRID_MINUTES, "ru")} slot se kam hai, is liye wo nahi milta.
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <Text variant="meta" weight="bold">
      Roz ke slots:{" "}
      {DAY_LABELS.map((label, day) => {
        const o = value.perDayOverrides[day] ?? { open: value.openTime, close: value.closeTime };
        return `${label} ${slotPreview(o.open, o.close, GRID_MINUTES)?.count ?? 0}`;
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
      <FieldLabel>Ye qeemat kin dinon par</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="Har din" selected={days === null} onPress={() => onChange(null)} />
        <Chip label="Hafte ke din" selected={same(days, WEEKDAY_NUMBERS)} onPress={() => onChange(WEEKDAY_NUMBERS)} />
        <Chip label="Weekend" selected={same(days, WEEKEND_NUMBERS)} onPress={() => onChange(WEEKEND_NUMBERS)} />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {DAY_LABELS.map((label, day) => (
          <Chip key={label} label={label} selected={days === null || days.includes(day)} onPress={() => toggle(day)} />
        ))}
      </View>
    </View>
  );
}

/** Section 32 Part 5: this COURT's advance rule -- a fixed PKR amount or a percentage of the total, with an
 * optional minimum floor. Leaving the type unset falls back to the matched price rule's own percentage
 * (the pre-Part-5 default, effectively "pay it all now" unless a price rule says otherwise). */
export function AdvanceRuleFields({
  advanceType,
  advanceValue,
  advanceMinimum,
  onChange,
}: {
  advanceType: "" | "fixed" | "percent";
  advanceValue: string;
  advanceMinimum: string;
  onChange: (patch: { advanceType?: "" | "fixed" | "percent"; advanceValue?: string; advanceMinimum?: string }) => void;
}) {
  return (
    <SectionCard>
      <SectionLabel>Advance payment</SectionLabel>
      <FieldLabel>Slot hold karne ke liye player abhi kitna de?</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="Default (qeemat se)" selected={advanceType === ""} onPress={() => onChange({ advanceType: "" })} />
        <Chip label="Fixed raqam" selected={advanceType === "fixed"} onPress={() => onChange({ advanceType: "fixed" })} />
        <Chip label="Percentage" selected={advanceType === "percent"} onPress={() => onChange({ advanceType: "percent" })} />
      </View>
      {advanceType === "fixed" ? (
        <TextField
          label="Advance raqam (PKR)"
          value={advanceValue}
          onChangeText={(v) => onChange({ advanceValue: v.replace(/\D/g, "") })}
          keyboardType="number-pad"
          placeholder="400"
          mono
        />
      ) : advanceType === "percent" ? (
        <TextField
          label="Total ka percentage (%)"
          value={advanceValue}
          onChangeText={(v) => onChange({ advanceValue: v.replace(/\D/g, "") })}
          keyboardType="number-pad"
          placeholder="20"
          mono
        />
      ) : (
        <Text variant="caption" tone="subtle">
          Har price rate ka apna advance % lagta hai (neeche rate add karte waqt). Aam tor par 100%: slot hold karne ke
          liye poori raqam.
        </Text>
      )}
      {advanceType !== "" ? (
        <TextField
          label="Kam se kam advance (PKR, optional)"
          value={advanceMinimum}
          onChangeText={(v) => onChange({ advanceMinimum: v.replace(/\D/g, "") })}
          keyboardType="number-pad"
          placeholder="Khali chhorein to koi had nahi"
          mono
        />
      ) : null}
    </SectionCard>
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
      <SectionLabel>Cancel policy</SectionLabel>
      <View className="gap-2">
        <FieldLabel>Paisa dene ke baad player booking cancel kar sakta hai? Ye venue ke har court par lagta hai.</FieldLabel>
        <View className="flex-row gap-2">
          <Chip label="Ijazat hai" selected={allowed} onPress={() => onAllowedChange(true)} />
          <Chip label="Ijazat nahi" selected={!allowed} onPress={() => onAllowedChange(false)} />
        </View>
        <DefaultHint settingKey="cancellation_allowed" value={allowed} onReset={() => onAllowedChange(true)} testID="default-cancellation" />
      </View>
      {allowed ? (
        <View className="gap-1.5">
          <TextField
            label="Itne ghante pehle tak cancel ho (optional)"
            value={cutoffHours}
            onChangeText={(v) => onCutoffChange(v.replace(/\D/g, ""))}
            keyboardType="number-pad"
            placeholder="Khali chhorein to koi had nahi"
            mono
          />
          <DefaultHint
            settingKey="cancellation_cutoff_hours"
            value={cutoffHours.trim() ? Number(cutoffHours) : null}
            onReset={() => onCutoffChange("")}
            testID="default-cancellation-cutoff"
          />
        </View>
      ) : null}
    </SectionCard>
  );
}
