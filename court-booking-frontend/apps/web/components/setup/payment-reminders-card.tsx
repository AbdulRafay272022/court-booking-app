"use client";

import { useId, useState } from "react";
import {
  REMINDER_DEFAULTS,
  reminderPreviewText,
  reminderSchedule,
  validateReminderInput,
  type ReminderField,
} from "@court-booking/types";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { SectionCard, SectionLabel } from "./ui";

const DEFAULT_CANCEL_MIN = 120;

function toNum(s: string): number | null {
  return s.trim() === "" ? null : Number(s);
}

/**
 * Round 2 B1 (Stage 1, preview only): the owner's payment-approval reminders. Per-venue values need a schema change
 * (Stage 2), so the inputs only drive the LIVE PREVIEW (shared `reminderSchedule`, the same function the backend
 * scheduler mirrors) and the card says plainly that saving is coming. No fake save. Same card in Venue Settings and the
 * wizard's "Advanced" section (parity).
 */
export function PaymentRemindersCard() {
  const t = useT();
  const lang = useLang();
  const ids = useId();
  const [first, setFirst] = useState(String(REMINDER_DEFAULTS.firstAfterMin));
  const [every, setEvery] = useState(String(REMINDER_DEFAULTS.everyMin));
  const [max, setMax] = useState(String(REMINDER_DEFAULTS.maxReminders));
  const [autoCancel, setAutoCancel] = useState(false);
  const [cancelMin, setCancelMin] = useState(String(DEFAULT_CANCEL_MIN));

  const input = { firstAfterMin: toNum(first), everyMin: toNum(every), maxReminders: toNum(max), autoCancelMin: autoCancel ? toNum(cancelMin) : null };
  const { errors, warnings } = validateReminderInput(input, autoCancel, lang);
  const errorFor = (f: ReminderField) => errors.find((e) => e.field === f)?.message ?? null;
  const preview =
    errors.length === 0
      ? reminderPreviewText(
          reminderSchedule({
            firstAfterMin: input.firstAfterMin ?? 0,
            everyMin: input.everyMin ?? 0,
            maxReminders: input.maxReminders ?? 0,
            autoCancelMin: input.autoCancelMin,
          }),
          lang,
        )
      : null;

  const numberField = (key: ReminderField, label: string, value: string, set: (v: string) => void, disabled = false) => {
    const err = errorFor(key);
    const id = `${ids}-${key}`;
    return (
      <div className="flex flex-col gap-2 flex-1 basis-40 min-w-0">
        <label htmlFor={id} className="text-[13px] font-semibold text-owner-ink-muted">
          {label}
        </label>
        <input
          id={id}
          data-testid={`timer-${key}`}
          value={value}
          disabled={disabled}
          onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="numeric"
          aria-invalid={!!err}
          aria-describedby={err ? `${id}-err` : undefined}
          className={`h-12 px-3.5 rounded-[9px] bg-owner-bg border text-[15px] font-mono font-medium text-owner-ink outline-none focus:border-owner-accent focus-visible:ring-2 focus-visible:ring-owner-accent disabled:opacity-60 ${
            err ? "border-owner-danger" : "border-owner-border"
          }`}
        />
        {err ? (
          <p id={`${id}-err`} className="text-[12.5px] font-semibold text-owner-danger">
            <span aria-hidden="true">! </span>
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <SectionCard>
      <div data-testid="reminders-card" className="flex flex-col gap-4">
        <SectionLabel>{t("timer.title")}</SectionLabel>
        <p className="text-[13px] text-owner-ink-muted">{t("timer.intro")}</p>
        <div className="flex flex-wrap gap-3">
          {numberField("firstAfterMin", t("timer.first"), first, setFirst)}
          {numberField("everyMin", t("timer.every"), every, setEvery)}
          {numberField("maxReminders", t("timer.max"), max, setMax)}
        </div>

        <label className="flex items-start gap-3 min-h-11 cursor-pointer">
          <input
            type="checkbox"
            data-testid="timer-autoCancel"
            checked={autoCancel}
            onChange={(e) => setAutoCancel(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#0E6274]"
          />
          <span className="text-[14px] font-semibold text-owner-ink">{t("timer.autoCancel")}</span>
        </label>
        {autoCancel ? (
          <>
            <div className="flex flex-wrap gap-3">{numberField("autoCancelMin", t("timer.autoCancelMin"), cancelMin, setCancelMin)}</div>
            <p className="rounded-lg border border-owner-warn-soft-border bg-owner-warn-soft px-3 py-2 text-[12.5px] font-medium text-owner-warn-dark">
              <span aria-hidden="true">! </span>
              {t("timer.warning")}
            </p>
          </>
        ) : null}

        <div aria-live="polite" data-testid="timer-preview" className="rounded-xl border border-owner-border bg-owner-bg px-4 py-3 text-[13.5px] flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-owner-ink-faint">{t("timer.previewLabel")}</span>
          {preview ? (
            <span className="font-medium text-owner-ink" data-testid="timer-preview-text">{preview}</span>
          ) : (
            <span className="text-owner-ink-muted">{t("timer.fixFirst")}</span>
          )}
          {warnings.map((w) => (
            <span key={w} className="text-owner-ink-muted">
              {w}
            </span>
          ))}
        </div>
        <p className="text-[12px] text-owner-ink-faint">{t("timer.hours")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <p data-testid="timer-coming-soon" className="flex-1 basis-64 text-[12.5px] font-medium text-owner-ink-muted">
            {t("timer.comingSoon")}
          </p>
          <button
            type="button"
            onClick={() => {
              setFirst(String(REMINDER_DEFAULTS.firstAfterMin));
              setEvery(String(REMINDER_DEFAULTS.everyMin));
              setMax(String(REMINDER_DEFAULTS.maxReminders));
              setAutoCancel(false);
              setCancelMin(String(DEFAULT_CANCEL_MIN));
            }}
            className="min-h-11 px-4 rounded-lg border border-owner-border text-[13.5px] font-semibold text-owner-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
          >
            {t("timer.reset")}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
