import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_ADVANCE_PERCENTAGE, advanceDefaultHintText, isFeatureOn, type AdvanceExplain } from "@court-booking/types";

import { api } from "@/lib/api";
import { DefaultHint } from "./default-hint";

import { Chip, FieldLabel, SectionCard, SectionLabel, TextField } from "../app/(owner)/venue-setup/_components";
import {
  advanceDefaultLine,
  advanceDraftProblem,
  advanceExampleLine,
  type AdvanceDraft,
  type AdvancePrice,
  type AdvanceTypeDraft,
} from "./advance-settings-logic";

export * from "./advance-settings-logic";

/**
 * Owner Round 2 (A11): ONE advance-payment editor for a court, used by BOTH the onboarding wizard
 * (`app/(owner)/venue-setup/courts.tsx`) and Venue Settings (`app/(owner)/venue-settings.tsx`) with the same defaults
 * (`ADVANCE_DRAFT_DEFAULTS`). The math is the shared `advanceExample` / `advanceFor` (packages/types, mirrors the
 * backend's `compute_advance`); this file only builds the Roman Urdu sentences around it. Calculation and saving are
 * unchanged: the fields still map 1:1 to the court's `advance_type` / `advance_value` / `advance_minimum`.
 */

const HELP: Record<AdvanceTypeDraft, string> = {
  "": "Default: har price rate ka apna advance % lagta hai. Aam tor par 100%, yani player slot pakka karne ke liye poori raqam abhi deta hai.",
  fixed: "Fixed amount: har booking par ek tay raqam (PKR) abhi, baqi venue par. Lambi booking par ye raqam usi hisaab se barhti hai.",
  percent: "Percentage: booking ke total ka itna % abhi, baqi venue par.",
};

/** Stage 2: is the split_payments flag on? Off = every new booking is paid in full up front (backend kill switch), so the
 * advance Default says "abhi poori raqam". A failed / missing answer counts as ON (fail-open, like the backend). */
export function useSplitPaymentsOn(): boolean {
  const q = useQuery({ queryKey: ["public-flags"], queryFn: () => api.featureFlags.publicFlags(), retry: false, staleTime: 5 * 60_000 });
  return isFeatureOn(q.data?.flags, "split_payments");
}

export function AdvanceSettings({
  value,
  onChange,
  price,
  explain,
  defaultPercentage = DEFAULT_ADVANCE_PERCENTAGE,
}: {
  value: AdvanceDraft;
  onChange: (patch: Partial<AdvanceDraft>) => void;
  price: AdvancePrice;
  /** The backend's explanation for a court that already exists (Venue Settings); null/undefined in the wizard. */
  explain?: AdvanceExplain | null;
  /** The pricing rule's own advance % used by "Default" (the wizard always creates rules with 100). */
  defaultPercentage?: number;
}) {
  const pct = explain?.default_rule.percentage ?? defaultPercentage;
  const example = advanceExampleLine(value, price, pct);
  const problem = advanceDraftProblem(value);
  const digits = (v: string) => v.replace(/\D/g, "");
  const splitOn = useSplitPaymentsOn();
  return (
    <SectionCard>
      <SectionLabel>Advance payment</SectionLabel>
      <FieldLabel>Slot pakka karne ke liye player abhi kitna dega?</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="Default (from pricing)" selected={value.advanceType === ""} onPress={() => onChange({ advanceType: "" })} />
        <Chip label="Fixed amount" selected={value.advanceType === "fixed"} onPress={() => onChange({ advanceType: "fixed" })} />
        <Chip label="Percentage" selected={value.advanceType === "percent"} onPress={() => onChange({ advanceType: "percent" })} />
      </View>
      <DefaultHint
        settingKey="advance"
        text={advanceDefaultHintText(splitOn, "ru")}
        isDefault={value.advanceType === ""}
        onReset={() => onChange({ advanceType: "", advanceValue: "" })}
        testID="default-advance"
      />
      <Text testID="advance-help" className="font-plex-medium text-owner-ink-faint text-[12.5px]">
        {HELP[value.advanceType]}
      </Text>
      {value.advanceType === "fixed" ? (
        <TextField
          label="Advance ki raqam (PKR)"
          value={value.advanceValue}
          onChangeText={(v) => onChange({ advanceValue: digits(v) })}
          keyboardType="number-pad"
          placeholder="500"
          mono
          error={value.advanceValue ? problem : null}
        />
      ) : value.advanceType === "percent" ? (
        <TextField
          label="Total ka percentage (%)"
          value={value.advanceValue}
          onChangeText={(v) => onChange({ advanceValue: digits(v) })}
          keyboardType="number-pad"
          placeholder="50"
          mono
          error={value.advanceValue ? problem : null}
        />
      ) : null}
      {/* The minimum floors the advance in EVERY mode (backend compute_advance), so it is offered in every mode. */}
      <View className="gap-1">
        <TextField
          label="Kam az kam advance (PKR, optional)"
          value={value.advanceMinimum}
          onChangeText={(v) => onChange({ advanceMinimum: digits(v) })}
          keyboardType="number-pad"
          placeholder="Khali chorein to koi had nahi"
          mono
        />
        <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
          Advance is se kam kabhi nahi hoga (lekin booking ke total se zyada bhi nahi).
        </Text>
        <DefaultHint
          settingKey="advance_minimum"
          value={value.advanceMinimum.trim() ? Number(value.advanceMinimum) : null}
          onReset={() => onChange({ advanceMinimum: "" })}
          testID="default-advance-minimum"
        />
      </View>
      {example ? (
        <View className="rounded-[10px] px-3 py-2.5" style={{ backgroundColor: "#EEF6F7" }}>
          <Text testID="advance-example" className="font-plex-semibold text-owner-ink text-[13.5px]">
            {example}
          </Text>
        </View>
      ) : null}
      <Text testID="advance-default" className="font-plex-medium text-owner-ink-muted text-[12.5px]">
        {advanceDefaultLine(price, pct, explain)}
      </Text>
    </SectionCard>
  );
}
