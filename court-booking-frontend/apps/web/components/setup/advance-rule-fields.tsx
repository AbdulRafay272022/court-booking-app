"use client";

import { Chip, Field, FieldLabel, SectionCard, SectionLabel } from "./ui";

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
      <FieldLabel>How much does a player pay now to hold a slot on this court?</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip label="Default (from pricing)" selected={advanceType === ""} onClick={() => onChange({ advanceType: "" })} />
        <Chip label="Fixed amount" selected={advanceType === "fixed"} onClick={() => onChange({ advanceType: "fixed" })} />
        <Chip label="Percentage" selected={advanceType === "percent"} onClick={() => onChange({ advanceType: "percent" })} />
      </div>
      {advanceType === "fixed" ? (
        <Field
          label="Advance amount (PKR)"
          value={advanceValue}
          onChange={(e) => onChange({ advanceValue: e.target.value.replace(/\D/g, "") })}
          inputMode="numeric"
          placeholder="400"
          mono
        />
      ) : advanceType === "percent" ? (
        <Field
          label="Percentage of the total (%)"
          value={advanceValue}
          onChange={(e) => onChange({ advanceValue: e.target.value.replace(/\D/g, "") })}
          inputMode="numeric"
          placeholder="20"
          mono
        />
      ) : (
        <p className="text-owner-ink-faint text-[12.5px]">
          Uses each price rule&apos;s own advance percentage (set when you add a price rate below). Most courts
          default to 100% -- pay in full to hold the slot.
        </p>
      )}
      {advanceType !== "" ? (
        <Field
          label="Minimum advance (PKR, optional)"
          value={advanceMinimum}
          onChange={(e) => onChange({ advanceMinimum: e.target.value.replace(/\D/g, "") })}
          inputMode="numeric"
          placeholder="Leave blank for no floor"
          mono
        />
      ) : null}
    </SectionCard>
  );
}
