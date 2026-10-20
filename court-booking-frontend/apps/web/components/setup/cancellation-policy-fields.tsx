"use client";

import { useLang, useT } from "@/components/i18n/lang-provider";
import { DefaultHint } from "@/components/settings/default-hint";
import { defaultState, defaultValueText } from "@/components/settings/hint-state";
import { Chip, Field, FieldLabel, SectionCard, SectionLabel } from "./ui";

/**
 * The venue's ONE cancellation policy (Section 32 Part 4: per venue, not per court). Used by the venue step of the
 * setup wizard and by Venue Settings. Players are shown this before they pay.
 */
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
  const t = useT();
  const lang = useLang();
  return (
    <SectionCard>
      <SectionLabel>{t("setup.cancel.title")}</SectionLabel>
      <div className="flex flex-col gap-2">
        <FieldLabel>{t("setup.cancel.question")}</FieldLabel>
        <div className="flex gap-2">
          <Chip label={t("setup.cancel.allowed")} selected={allowed} onClick={() => onAllowedChange(true)} />
          <Chip label={t("setup.cancel.notAllowed")} selected={!allowed} onClick={() => onAllowedChange(false)} />
        </div>
        {/* Stage 2 A.2: both are venue defaults in the backend (allowed = true, no cutoff). */}
        <DefaultHint
          id="cancellation_allowed"
          field={t("set2.cancel.allowedLabel")}
          text={defaultValueText("cancellation_allowed", lang)}
          state={defaultState(allowed, true)}
          onReset={() => onAllowedChange(true)}
        />
      </div>
      {allowed ? (
        <Field
          label={t("setup.cancel.cutoff")}
          value={cutoffHours}
          onChange={(e) => onCutoffChange(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder={t("setup.cancel.cutoffPlaceholder")}
          mono
        />
      ) : null}
      {allowed ? (
        <DefaultHint
          id="cancellation_cutoff_hours"
          field={t("set2.cancel.cutoffLabel")}
          text={defaultValueText("cancellation_cutoff_hours", lang)}
          state={defaultState(cutoffHours.trim() === "" ? null : Number(cutoffHours), null)}
          onReset={() => onCutoffChange("")}
        />
      ) : null}
    </SectionCard>
  );
}
