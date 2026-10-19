"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import { VENUE_TIMER_DEFAULTS, type VenueTimerEffective, type VenueTimers } from "@court-booking/types";
import { api } from "@/lib/api";
import { useMyPermissions, type StaffPermission } from "@/lib/use-my-permissions";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { ErrorState } from "@/components/error-state";
import { useLang, useT } from "@/components/i18n/lang-provider";
import type { TFunction } from "@/lib/i18n";
import { DefaultHint } from "@/components/settings/default-hint";
import { defaultState } from "@/components/settings/hint-state";
import { PrimaryButton, SectionCard, SectionLabel } from "./ui";
import {
  draftFromValues,
  effectiveFromDraft,
  timerPreview,
  validateTimers,
  valuesFromDraft,
  type TimerDraft,
  type TimerNumberKey,
} from "./venue-timers";

export function minutesText(t: TFunction, n: number): string {
  return t(n === 1 ? "set2.val.minute" : "set2.val.minutes", { n });
}

/**
 * Round 2 Stage 2: hold minutes, owner reminders (on/off, first/every/max) and auto-cancel (on/off + minutes) for ONE
 * venue, with a "Default: X" hint under every field and a live preview. Controlled: Venue Settings and the wizard's
 * "Advanced" section both render exactly this component (parity), only the save path differs.
 */
export function VenueTimersFields({
  draft,
  onChange,
  defaults = VENUE_TIMER_DEFAULTS,
}: {
  draft: TimerDraft;
  onChange: (patch: Partial<TimerDraft>) => void;
  defaults?: VenueTimerEffective;
}) {
  const t = useT();
  const lang = useLang();
  const ids = useId();
  const eff = effectiveFromDraft(draft, defaults);
  const values = valuesFromDraft(draft);
  const { errors, warnings } = validateTimers(draft, lang, defaults);
  const preview = timerPreview(draft, lang, defaults);

  const numberField = (key: TimerNumberKey, label: string, hint: string) => {
    const err = errors[key];
    const id = `${ids}-${key}`;
    const shown = draft[key] ?? String(defaults[key]);
    return (
      <div className="flex flex-col gap-2 flex-1 basis-40 min-w-0">
        <label htmlFor={id} className="text-[13px] font-semibold text-owner-ink-muted">
          {label}
        </label>
        <input
          id={id}
          data-testid={`timer-${key}`}
          value={shown}
          onChange={(e) => onChange({ [key]: e.target.value.replace(/[^\d]/g, "") } as Partial<TimerDraft>)}
          inputMode="numeric"
          aria-invalid={!!err}
          aria-describedby={`${id}-hint${err ? ` ${id}-err` : ""}`}
          className={`h-12 px-3.5 rounded-[9px] bg-owner-bg border text-[15px] font-mono font-medium outline-none focus:border-owner-accent focus-visible:ring-2 focus-visible:ring-owner-accent ${
            draft[key] === null ? "text-owner-ink-muted" : "text-owner-ink"
          } ${err ? "border-owner-danger" : "border-owner-border"}`}
        />
        <div id={`${id}-hint`}>
          <DefaultHint
            id={key}
            field={label}
            text={hint}
            state={defaultState(values[key], defaults[key])}
            markSame={false}
            onReset={() => onChange({ [key]: null } as Partial<TimerDraft>)}
          />
        </div>
        {err ? (
          <p id={`${id}-err`} className="text-[12.5px] font-semibold text-owner-danger">
            <span aria-hidden="true">! </span>
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  const toggle = (key: "reminders_enabled" | "auto_cancel_enabled", label: string) => {
    const on = eff[key];
    return (
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-3 min-h-11 cursor-pointer">
          <input
            type="checkbox"
            data-testid={`timer-${key}`}
            checked={on}
            onChange={(e) => onChange({ [key]: e.target.checked } as Partial<TimerDraft>)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#0E6274] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
          />
          <span className="text-[14px] font-semibold text-owner-ink">
            {label}{" "}
            <span className="font-medium text-owner-ink-muted">({on ? t("set2.val.on") : t("set2.val.off")})</span>
          </span>
        </label>
        <DefaultHint
          id={key}
          field={label}
          text={defaults[key] ? t("set2.val.on") : t("set2.val.off")}
          state={defaultState(values[key], defaults[key])}
          markSame={false}
          onReset={() => onChange({ [key]: null } as Partial<TimerDraft>)}
        />
      </div>
    );
  };

  return (
    <div data-testid="timers-fields" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h3 className="text-[14.5px] font-bold text-owner-ink">{t("set2.hold.title")}</h3>
        <p className="text-[13px] text-owner-ink-muted">{t("set2.hold.help")}</p>
        <div className="flex flex-wrap gap-3">
          {numberField("hold_minutes", t("set2.hold.label"), minutesText(t, defaults.hold_minutes))}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-owner-border-light pt-4">
        <h3 className="text-[14.5px] font-bold text-owner-ink">{t("timer.title")}</h3>
        <p className="text-[13px] text-owner-ink-muted">{t("timer.intro")}</p>
        {toggle("reminders_enabled", t("set2.reminders.toggle"))}
        {eff.reminders_enabled ? (
          <div className="flex flex-wrap gap-3">
            {numberField("first_reminder_after_min", t("timer.first"), minutesText(t, defaults.first_reminder_after_min))}
            {numberField("repeat_every_min", t("timer.every"), minutesText(t, defaults.repeat_every_min))}
            {numberField("max_reminders", t("timer.max"), String(defaults.max_reminders))}
          </div>
        ) : (
          <p data-testid="timer-reminders-off" className="text-[12.5px] font-medium text-owner-ink-muted">
            {t("set2.reminders.offNote")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-owner-border-light pt-4">
        <h3 className="text-[14.5px] font-bold text-owner-ink">{t("set2.cancel.title")}</h3>
        {toggle("auto_cancel_enabled", t("timer.autoCancel"))}
        {eff.auto_cancel_enabled ? (
          <>
            <div className="flex flex-wrap gap-3">
              {numberField("auto_cancel_after_min", t("timer.autoCancelMin"), minutesText(t, defaults.auto_cancel_after_min))}
            </div>
            <p className="rounded-lg border border-owner-warn-soft-border bg-owner-warn-soft px-3 py-2 text-[12.5px] font-medium text-owner-warn-dark">
              <span aria-hidden="true">! </span>
              {t("timer.warning")}
            </p>
          </>
        ) : (
          <p
            data-testid="timer-autocancel-off"
            className="rounded-lg border border-owner-warn-soft-border bg-owner-warn-soft px-3 py-2 text-[12.5px] font-semibold text-owner-warn-dark"
          >
            <span aria-hidden="true">! </span>
            {t("set2.cancel.offWarning")}
          </p>
        )}
      </div>

      <div aria-live="polite" data-testid="timer-preview" className="rounded-xl border border-owner-border bg-owner-bg px-4 py-3 text-[13.5px] flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-owner-ink-faint">{t("timer.previewLabel")}</span>
        {preview ? (
          <>
            <span className="font-medium text-owner-ink" data-testid="timer-hold-preview">
              {t("set2.hold.preview", { minutes: minutesText(t, eff.hold_minutes) })}
            </span>
            <span className="font-medium text-owner-ink" data-testid="timer-preview-text">
              {preview}
            </span>
          </>
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
    </div>
  );
}

/** Translate a timers save failure (422 TIMER_OUT_OF_RANGE names the field). */
export function timerErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError && e.code === "TIMER_OUT_OF_RANGE") return t("set2.err.outOfRange");
  return friendlyErrorMessage(e, t);
}

/** The staff permission that edits venue / court settings (backend app/models/staff.py EDIT_COURT_SETTINGS). */
const EDIT_SETTINGS = "edit_court_settings" as StaffPermission;

/**
 * Venue Settings: loads this venue's timers, edits them with VenueTimersFields and saves with PUT (null = default).
 * Staff without the settings permission get a short read-only summary instead of inputs (and never an error).
 */
export function VenueTimersCard({ venueId }: { venueId: string }) {
  const t = useT();
  const lang = useLang();
  const perms = useMyPermissions();
  const canEdit = perms.can(EDIT_SETTINGS, venueId);
  const query = useQuery({
    queryKey: ["venue-timers", venueId],
    queryFn: () => api.owners.venueTimers(venueId),
    retry: false,
  });
  const denied = query.error instanceof ApiError && query.error.status === 403;
  if (perms.loading) return null;
  if (!canEdit || denied) {
    const preview = query.data ? timerPreview(draftFromValues(query.data.values), lang, query.data.defaults) : null;
    return (
      <SectionCard>
        <div data-testid="timers-card-readonly" className="flex flex-col gap-2">
          <SectionLabel>{t("set2.timers.title")}</SectionLabel>
          {query.data ? (
            <>
              <p className="text-[13.5px] font-medium text-owner-ink">
                {t("set2.hold.preview", { minutes: minutesText(t, query.data.effective.hold_minutes) })}
              </p>
              {preview ? <p className="text-[13.5px] font-medium text-owner-ink">{preview}</p> : null}
            </>
          ) : null}
          <p className="text-[12.5px] text-owner-ink-muted">{t("set2.timers.readOnly")}</p>
        </div>
      </SectionCard>
    );
  }
  return (
    <SectionCard>
      <div data-testid="timers-card" className="flex flex-col gap-4">
        <SectionLabel>{t("set2.timers.title")}</SectionLabel>
        {query.isError ? (
          <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
        ) : query.data ? (
          <TimersEditor key={venueId} venueId={venueId} data={query.data} />
        ) : (
          <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>
        )}
      </div>
    </SectionCard>
  );
}

function TimersEditor({ venueId, data }: { venueId: string; data: VenueTimers }) {
  const t = useT();
  const lang = useLang();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TimerDraft>(() => draftFromValues(data.values));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const defaults = data.defaults ?? VENUE_TIMER_DEFAULTS;
  const valid = Object.keys(validateTimers(draft, lang, defaults).errors).length === 0;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.owners.updateVenueTimers(venueId, valuesFromDraft(draft));
      setDraft(draftFromValues(res.values));
      queryClient.setQueryData(["venue-timers", venueId], res);
      setMessage({ kind: "ok", text: t("set2.timers.saved") });
    } catch (e) {
      setMessage({ kind: "error", text: timerErrorMessage(e, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <VenueTimersFields
        draft={draft}
        defaults={defaults}
        onChange={(patch) => {
          setMessage(null);
          setDraft((d) => ({ ...d, ...patch }));
        }}
      />
      <div aria-live="polite">
        {message ? (
          <p
            data-testid="timers-message"
            className={`text-[13.5px] font-semibold ${message.kind === "ok" ? "text-owner-accent" : "text-owner-danger"}`}
          >
            <span aria-hidden="true">{message.kind === "ok" ? "\u2713 " : "! "}</span>
            {message.text}
          </p>
        ) : null}
      </div>
      <PrimaryButton label={t("set2.timers.save")} onClick={save} busy={saving} ready={valid} />
    </>
  );
}
