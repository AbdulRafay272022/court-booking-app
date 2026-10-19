"use client";

import { useId } from "react";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { formatPKR } from "@/lib/format";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { DefaultHint } from "@/components/settings/default-hint";
import { defaultState, defaultValueText } from "@/components/settings/hint-state";
import { Field, SectionCard, SectionLabel } from "./ui";
import {
  advanceDraftErrors,
  advancePreview,
  effectiveDefaultPercentage,
  exampleMinutes,
  nothingSetAdvance,
  type AdvanceTypeDraft,
} from "./advance-preview";

/** What the server says happens when nothing is set (GET /courts/{id}/advance-explain). Optional: the wizard computes it. */
export interface AdvanceNothingSet {
  amount: number;
  percentage: number | null;
}

/**
 * Section 32 Part 5 + Round 2 A11: this COURT's advance rule -- Default (the price rule's own percentage), a fixed PKR
 * amount or a percentage of the total, with an optional minimum floor. ONE component for Venue Settings and the
 * onboarding wizard (parity), with a one-line help per option, a live example from the court's real price and the
 * "if you set nothing" line. The calculation itself is the backend's (mirrored in packages/types advance-example.ts).
 */
export function AdvanceRuleFields({
  advanceType,
  advanceValue,
  advanceMinimum,
  onChange,
  unitPrice = null,
  unitMinutes = 60,
  defaultPercentage = null,
  nothingSet = null,
}: {
  advanceType: AdvanceTypeDraft;
  advanceValue: string;
  advanceMinimum: string;
  onChange: (patch: { advanceType?: AdvanceTypeDraft; advanceValue?: string; advanceMinimum?: string }) => void;
  /** Price of one priced unit (the court's minimum booking), from the typed or saved price rules. */
  unitPrice?: number | null;
  unitMinutes?: number;
  /** The price rule's advance_percentage (null = the backend default, 100). */
  defaultPercentage?: number | null;
  nothingSet?: AdvanceNothingSet | null;
}) {
  const t = useT();
  const fmt = useFmt();
  const lang = useLang();
  const groupId = useId();
  // Stage 2 A.2: with split_payments OFF the backend takes the whole price up front whatever the rule says.
  const splitOn = useFeatureFlags().isOn("split_payments");
  const draft = { advanceType, advanceValue, advanceMinimum };
  const errors = advanceDraftErrors(draft);
  const pct = effectiveDefaultPercentage(nothingSet?.percentage ?? defaultPercentage);
  const preview = advancePreview(draft, unitPrice, unitMinutes, pct);
  const minutes = exampleMinutes(unitMinutes);
  const fallbackNothing = nothingSetAdvance(unitPrice, unitMinutes, pct);
  const nothingAmount = unitPrice !== null && unitPrice > 0 ? fallbackNothing : (nothingSet?.amount ?? null);

  const options: { value: AdvanceTypeDraft; label: string; help: string; testid: string }[] = [
    { value: "", label: t("adv.option.default"), help: t("adv.help.default"), testid: "adv-opt-default" },
    { value: "fixed", label: t("adv.option.fixed"), help: t("adv.help.fixed"), testid: "adv-opt-fixed" },
    { value: "percent", label: t("adv.option.percent"), help: t("adv.help.percent"), testid: "adv-opt-percent" },
  ];

  const ruleText =
    advanceType === "fixed"
      ? t("adv.example.rule.fixed", { amount: formatPKR(Number(advanceValue || 0)) })
      : advanceType === "percent"
        ? t("adv.example.rule.percent", { pct: advanceValue || "0" })
        : t("adv.example.rule.default", { pct: String(pct) });
  const minText = advanceType !== "" && advanceMinimum.trim() ? ` ${t("adv.example.rule.min", { amount: formatPKR(Number(advanceMinimum)) })}` : "";

  return (
    <SectionCard>
      <div data-testid="advance-card" className="flex flex-col gap-4">
        <SectionLabel>{t("adv.title")}</SectionLabel>
        <fieldset className="flex flex-col gap-2 min-w-0">
          <legend id={`${groupId}-q`} className="text-[13px] font-semibold text-owner-ink-muted mb-2">
            {t("adv.question")}
          </legend>
          <div role="radiogroup" aria-labelledby={`${groupId}-q`} className="flex flex-col gap-2">
            {options.map((o) => {
              const selected = advanceType === o.value;
              return (
                <label
                  key={o.testid}
                  data-testid={o.testid}
                  className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 min-h-11 cursor-pointer focus-within:ring-2 focus-within:ring-owner-accent ${
                    selected ? "border-owner-accent bg-owner-accent-soft" : "border-owner-border bg-owner-surface"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${groupId}-mode`}
                    value={o.value || "default"}
                    checked={selected}
                    onChange={() => onChange({ advanceType: o.value })}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#0E6274]"
                  />
                  <span className="flex flex-col min-w-0">
                    <span className="text-[14px] font-semibold text-owner-ink">{o.label}</span>
                    <span className="text-[12.5px] text-owner-ink-faint">{o.help}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <DefaultHint
          id="advance"
          field={t("set2.adv.label")}
          text={t("set2.adv.defaultText", { pct: String(pct) })}
          note={splitOn ? null : t("set2.adv.fullNote")}
          state={defaultState(advanceType === "" ? null : advanceType, null)}
          onReset={() => onChange({ advanceType: "", advanceValue: "", advanceMinimum: "" })}
        />

        {advanceType !== "" ? (
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 basis-48 min-w-0" data-testid="adv-value">
              <Field
                label={advanceType === "fixed" ? t("adv.field.amount") : t("adv.field.percent")}
                value={advanceValue}
                onChange={(e) => onChange({ advanceValue: e.target.value.replace(/[^\d.]/g, "") })}
                inputMode={advanceType === "percent" ? "decimal" : "numeric"}
                placeholder={advanceType === "fixed" ? "1000" : "50"}
                error={errors.value ? t(errors.value === "percent" ? "adv.err.percent" : "adv.err.amount") : null}
                mono
              />
            </div>
            <div className="flex-1 basis-48 min-w-0" data-testid="adv-minimum">
              <Field
                label={t("adv.field.minimum")}
                value={advanceMinimum}
                onChange={(e) => onChange({ advanceMinimum: e.target.value.replace(/\D/g, "") })}
                inputMode="numeric"
                placeholder="500"
                error={errors.minimum ? t("adv.err.minimum") : null}
                mono
              />
              <p className="mt-1 text-[12px] text-owner-ink-faint">{t("adv.field.minimumHint")}</p>
              <DefaultHint
                id="advance_minimum"
                field={t("adv.field.minimum")}
                text={defaultValueText("advance_minimum", lang)}
                state={defaultState(advanceMinimum.trim() === "" ? null : Number(advanceMinimum), null)}
                onReset={() => onChange({ advanceMinimum: "" })}
              />
            </div>
          </div>
        ) : null}

        <div
          aria-live="polite"
          data-testid="adv-example"
          className="rounded-xl border border-owner-border bg-owner-bg px-4 py-3 text-[13.5px] text-owner-ink flex flex-col gap-1"
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-owner-ink-faint">{t("adv.example.label")}</span>
          {preview ? (
            <>
              <span className="font-medium">
                {t("adv.example.line", {
                  duration: fmt.duration(minutes),
                  total: formatPKR(preview.total),
                  rule: `${ruleText}${minText}`,
                  advance: formatPKR(preview.advance),
                })}
              </span>
              <span className="text-owner-ink-muted">{t("adv.example.balance", { balance: formatPKR(preview.balance) })}</span>
              {preview.capped ? <span className="text-owner-ink-muted">{t("adv.example.capped")}</span> : null}
            </>
          ) : (
            <span className="text-owner-ink-muted">{t("adv.example.noPrice")}</span>
          )}
        </div>

        <p data-testid="adv-default-line" className="text-[13px] text-owner-ink-muted">
          {nothingAmount !== null
            ? t("adv.default.line", { amount: formatPKR(nothingAmount), pct: String(pct) })
            : t("adv.default.noPrice", { pct: String(pct) })}
        </p>
        <p className="text-[12px] text-owner-ink-faint">{t("adv.multi")}</p>
      </div>
    </SectionCard>
  );
}
