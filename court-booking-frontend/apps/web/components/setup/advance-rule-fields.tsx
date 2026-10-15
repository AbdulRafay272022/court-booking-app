"use client";

import { useT } from "@/components/i18n/lang-provider";
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
  const t = useT();
  return (
    <SectionCard>
      <SectionLabel>{t("setup.advance.title")}</SectionLabel>
      <FieldLabel>{t("setup.advance.question")}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip label={t("setup.advance.default")} selected={advanceType === ""} onClick={() => onChange({ advanceType: "" })} />
        <Chip label={t("setup.advance.fixed")} selected={advanceType === "fixed"} onClick={() => onChange({ advanceType: "fixed" })} />
        <Chip label={t("setup.advance.percent")} selected={advanceType === "percent"} onClick={() => onChange({ advanceType: "percent" })} />
      </div>
      {advanceType === "fixed" ? (
        <Field
          label={t("setup.advance.amount")}
          value={advanceValue}
          onChange={(e) => onChange({ advanceValue: e.target.value.replace(/\D/g, "") })}
          inputMode="numeric"
          placeholder="400"
          mono
        />
      ) : advanceType === "percent" ? (
        <Field
          label={t("setup.advance.percentOfTotal")}
          value={advanceValue}
          onChange={(e) => onChange({ advanceValue: e.target.value.replace(/\D/g, "") })}
          inputMode="numeric"
          placeholder="20"
          mono
        />
      ) : (
        <p className="text-owner-ink-faint text-[12.5px]">
          {t("setup.advance.defaultNote")}
        </p>
      )}
      {advanceType !== "" ? (
        <Field
          label={t("setup.advance.min")}
          value={advanceMinimum}
          onChange={(e) => onChange({ advanceMinimum: e.target.value.replace(/\D/g, "") })}
          inputMode="numeric"
          placeholder={t("setup.advance.minPlaceholder")}
          mono
        />
      ) : null}
    </SectionCard>
  );
}
