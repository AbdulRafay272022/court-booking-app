"use client";

import { useId, useState, type ReactNode } from "react";
import { ApiError } from "@court-booking/api-client";
import type { CompletionInput, CompletionResult, OwnerBookingRow } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { pkr } from "@/lib/overview-helpers";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { ModalShell } from "@/components/owner/modal-shell";
import { VoiceTextarea } from "@/components/voice/voice-textarea";
import { canSaveCompletion, completionBody, planCompletion, validateReceivedNow } from "@/lib/overview-completion";

type T = ReturnType<typeof useT>;

/** Text for a failed completion call (also used by the Overview for its Haan errors). */
export function completionErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError && e.code === "COMPLETION_TOO_EARLY") return t("ovw.complete.err.tooEarly");
  if (e instanceof ApiError && (e.code as string) === "REASON_REQUIRED") return t("ovw.cmp.err.reasonRequired");
  if (e instanceof ApiError && e.status === 403) return t("ovw.complete.err.forbidden");
  return friendlyErrorMessage(e, t);
}

function InfoIcon({ warn }: { warn: boolean }) {
  return warn ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true" className="shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6m0 3.5h.01" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 mt-0.5">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export interface CompletionDialogProps {
  row: OwnerBookingRow;
  onClose: () => void;
  /** Called with the server's updated row after "Nahi" was saved. */
  onSaved: (row: OwnerBookingRow) => void;
  /** Replaces the default POST (the Overview uses it for its instant row update and rollback). Must throw on failure. */
  submit?: (input: CompletionInput) => Promise<OwnerBookingRow>;
}

/**
 * "Booking adhoora?" (Round 2, A8): how much of the REMAINING due was received now (0..due, added to what was paid, never
 * replacing it) and, only when money stays due, why. The one implementation for the Overview, History and the booking popup.
 */
export function CompletionDialog({ row, onClose, onSaved, submit }: CompletionDialogProps) {
  const t = useT();
  const fmt = useFmt();
  const titleId = useId();
  const inputId = `${titleId}-amount`;
  const [received, setReceived] = useState("0");
  const [reason, setReason] = useState(row.completion?.result === "no" ? (row.completion.reason ?? "") : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const due = Math.max(0, row.due);
  const check = validateReceivedNow(received, due);
  const plan = check.ok ? planCompletion(row, check.value) : null;
  const amountInvalid = touched && !check.ok;
  const reasonMissing = touched && plan !== null && !canSaveCompletion(plan, reason);

  async function save() {
    setTouched(true);
    if (!check.ok || !plan || !canSaveCompletion(plan, reason) || saving) return;
    setSaving(true);
    setError(null);
    const body = completionBody(row, check.value, reason);
    try {
      const updated = submit ? await submit(body) : await api.owners.markCompletion(row.booking_id, body);
      onSaved(updated);
    } catch (e) {
      setError(completionErrorText(e, t));
      setSaving(false);
    }
  }

  return (
    <ModalShell labelledBy={titleId} onClose={onClose} maxWidthClass="md:max-w-[540px]">
      <div className="p-6 md:p-8 flex flex-col gap-5" data-testid="ovw-completion-dialog">
        <div>
          <h2 id={titleId} className="font-khelo-display text-[26px] font-extrabold leading-tight text-owner-ink">
            {t("ovw.cmp.title")}
          </h2>
          <p className="mt-1 text-[14px] text-owner-ink-muted break-words">
            {[row.player_name ?? t("ovw.table.noName"), row.court_name, fmt.timeRange(row.starts_at, row.ends_at), row.short_code].join(" \u00b7 ")}
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-owner-bg px-4 py-3 text-[14px] text-owner-ink-muted" data-testid="ovw-cmp-summary">
          <div>
            <dt>{t("ovw.cmp.total")}</dt>
            <dd className="font-bold text-owner-ink tabular-nums">{pkr(row.total)}</dd>
          </div>
          <div>
            <dt>{t("ovw.cmp.paid")}</dt>
            <dd className="font-bold text-owner-ink tabular-nums">{pkr(row.total_paid)}</dd>
          </div>
          <div>
            <dt>{t("ovw.cmp.due")}</dt>
            <dd className="font-bold text-owner-ink tabular-nums">{pkr(due)}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-[14px] font-bold text-owner-ink">
            {t("ovw.cmp.amount")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              data-testid="ovw-received"
              value={received}
              onChange={(e) => setReceived(e.target.value.replace(/[^0-9,]/g, ""))}
              onFocus={(e) => e.currentTarget.select()}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={amountInvalid}
              aria-describedby={`${inputId}-hint`}
              className={`h-12 min-w-0 flex-1 basis-40 rounded-xl border-[1.5px] bg-owner-surface px-4 text-[18px] text-owner-ink tabular-nums ${amountInvalid ? "border-owner-danger" : "border-owner-border"}`}
            />
            {due > 0 ? (
              <button
                type="button"
                onClick={() => setReceived(String(due))}
                data-testid="ovw-received-full"
                className="min-h-12 px-4 rounded-xl border-[1.5px] border-owner-border bg-owner-surface text-[14px] font-bold text-owner-ink whitespace-nowrap"
              >
                {t("ovw.cmp.fill", { due: pkr(due) })}
              </button>
            ) : null}
          </div>
          <p id={`${inputId}-hint`} className={`text-[13px] ${amountInvalid ? "font-semibold text-owner-danger" : "text-owner-ink-muted"}`}>
            {amountInvalid ? t("ovw.cmp.amountErr", { due: pkr(due) }) : t("ovw.cmp.amountHint", { due: pkr(due) })}
          </p>
        </div>

        <div aria-live="polite" role="status">
          {plan ? (
            <div
              data-testid="ovw-preview"
              data-outcome={plan.outcome}
              className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-[14px] font-semibold ${
                plan.outcome === "no" ? "bg-owner-danger-soft text-owner-danger" : "bg-owner-success-soft text-owner-success-dark"
              }`}
            >
              <InfoIcon warn={plan.outcome === "no"} />
              <span>
                {plan.outcome === "no" ? t("ovw.cmp.previewDue", { due: pkr(plan.dueAfter) }) : t("ovw.cmp.previewFull")}
                <span className="block font-normal">{t("ovw.cmp.previewPaid", { paid: pkr(plan.paidAfter) })}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <VoiceTextarea
            id={`${titleId}-reason`}
            label={plan && !plan.reasonRequired ? t("ovw.cmp.reasonOpt") : t("ovw.cmp.reasonReq")}
            value={reason}
            onChange={setReason}
            required={!plan || plan.reasonRequired}
            rows={3}
            maxLength={500}
          />
          {reasonMissing && plan ? (
            <p role="alert" data-testid="ovw-reason-error" className="text-[13px] font-semibold text-owner-danger">
              {t("ovw.cmp.reasonErr", { due: pkr(plan.dueAfter) })}
            </p>
          ) : null}
        </div>

        <p role="alert" data-testid="ovw-completion-error" className={error ? "rounded-xl bg-owner-danger-soft px-4 py-3 text-[14px] font-semibold text-owner-danger" : "sr-only"}>
          {error}
        </p>

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-owner-ink px-6 text-[15px] font-bold text-owner-ink">
            {t("ovw.cmp.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            data-testid="ovw-completion-save"
            className="min-h-12 rounded-xl bg-khelo-orange px-6 text-[15px] font-bold text-khelo-ink disabled:opacity-60"
          >
            {saving ? t("ovw.cmp.saving") : plan?.outcome === "yes" ? t("ovw.cmp.saveFull") : t("ovw.cmp.save")}
          </button>
        </div>
        <p className="text-[12.5px] text-owner-ink-muted">{t("ovw.cmp.note")}</p>
      </div>
    </ModalShell>
  );
}

export interface CompletionFlow {
  /** Call when the owner picks Haan / Nahi in a row's dropdown (or the popup's own buttons). */
  pick: (row: OwnerBookingRow, result: CompletionResult) => void;
  /** Render this once next to the table: it is the "Booking adhoora?" popup while open. */
  dialog: ReactNode;
  /** The booking id whose "Haan" call is in flight. */
  busyId: string | null;
  /** Latest outcome for an aria-live region. */
  message: { kind: "ok" | "error"; text: string } | null;
}

/** Haan saves at once; Nahi opens the popup. `onDone` gets the updated row so the caller can patch or refetch. */
export function useCompletionFlow(onDone: (row: OwnerBookingRow) => void): CompletionFlow {
  const t = useT();
  const [target, setTarget] = useState<OwnerBookingRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<CompletionFlow["message"]>(null);

  function pick(row: OwnerBookingRow, result: CompletionResult) {
    setMessage(null);
    if (result === "no") {
      setTarget(row);
      return;
    }
    if (row.completion?.result === "yes") return;
    setBusyId(row.booking_id);
    api.owners
      .markCompletion(row.booking_id, { result: "yes" })
      .then((updated) => {
        setMessage({ kind: "ok", text: t("ovw.cmp.savedYes") });
        onDone(updated);
      })
      .catch((e) => setMessage({ kind: "error", text: completionErrorText(e, t) }))
      .finally(() => setBusyId(null));
  }

  const dialog = target ? (
    <CompletionDialog
      key={target.booking_id}
      row={target}
      onClose={() => setTarget(null)}
      onSaved={(updated) => {
        setTarget(null);
        setMessage({ kind: "ok", text: updated.completion?.result === "yes" ? t("ovw.cmp.savedFull") : t("ovw.cmp.savedNo") });
        onDone(updated);
      }}
    />
  ) : null;

  return { pick, dialog, busyId, message };
}
