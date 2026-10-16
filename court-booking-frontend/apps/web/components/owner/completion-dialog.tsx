"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@court-booking/api-client";
import type { CompletionResult, OwnerBookingRow } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { ModalShell } from "@/components/owner/modal-shell";

/** Minimal shape of the browser speech recognition API (Chrome); not in the TS DOM lib. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Integer 0..total or null. Pure so it can be tested. */
export function parseReceived(value: string, total: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= 0 && n <= total ? n : null;
}

/** Warning icon (colour is never the only signal). */
function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6m0 3.5h.01" />
    </svg>
  );
}

export interface CompletionDialogProps {
  row: OwnerBookingRow;
  onClose: () => void;
  /** Called with the server's updated row after "Nahi" was saved. */
  onSaved: (row: OwnerBookingRow) => void;
}

/** "Booking adhoora?" popup: how much was actually received (0..total) and why. Shared by the detail popup and the tables. */
export function CompletionDialog({ row, onClose, onSaved }: CompletionDialogProps) {
  const t = useT();
  const fmt = useFmt();
  const titleId = useId();
  const [received, setReceived] = useState(String(row.completion?.result === "no" ? row.completion.received_pkr : row.total_paid));
  const [reason, setReason] = useState(row.completion?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const amount = parseReceived(received, row.total);
  const due = amount === null ? null : row.total - amount;

  // --- voice to text (web only, hidden where unsupported) ---
  const [supported] = useState(() => speechCtor() !== null);
  const [micLang, setMicLang] = useState<"ur-PK" | "en-PK">("ur-PK");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recRef.current?.stop(), []);

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    setMicError(false);
    const rec = new Ctor();
    rec.lang = micLang;
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text) setReason((prev) => (prev ? `${prev.trimEnd()} ${text.trim()}` : text.trim()));
    };
    rec.onerror = () => {
      setMicError(true);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setMicError(true);
    }
  }

  async function save() {
    setTouched(true);
    if (amount === null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.owners.markCompletion(row.booking_id, { result: "no", received_pkr: amount, reason: reason.trim() || undefined });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "COMPLETION_TOO_EARLY" ? t("detail.err.tooEarly") : friendlyErrorMessage(e, t));
      setSaving(false);
    }
  }

  const amountInvalid = touched && amount === null;
  const inputId = `${titleId}-amount`;
  const reasonId = `${titleId}-reason`;

  return (
    <ModalShell labelledBy={titleId} onClose={onClose} maxWidthClass="md:max-w-[520px]">
      <div className="p-6 md:p-8 flex flex-col gap-5">
        <div>
          <h2 id={titleId} className="font-khelo-display text-[26px] font-extrabold leading-tight text-owner-ink">
            {t("detail.cmp.title")}
          </h2>
          <p className="mt-1 text-[14px] text-owner-ink-muted">
            {[row.player_name ?? t("detail.walkinPlayer"), row.court_name, fmt.timeRange(row.starts_at, row.ends_at), row.short_code].join(" · ")}
          </p>
        </div>

        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-2xl bg-owner-bg px-4 py-3 text-[14px] text-owner-ink-muted">
          <span>
            {t("detail.cmp.total")} <b className="text-owner-ink">{formatPKR(row.total)}</b>
          </span>
          <span>
            {t("detail.cmp.paid")} <b className="text-owner-ink">{formatPKR(row.total_paid)}</b>
          </span>
          <span>
            {t("detail.cmp.due")} <b className="text-owner-ink">{formatPKR(row.due)}</b>
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-[14px] font-bold text-owner-ink">
            {t("detail.cmp.amount")}
          </label>
          <input
            id={inputId}
            value={received}
            onChange={(e) => setReceived(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={amountInvalid}
            aria-describedby={`${inputId}-hint`}
            className={`h-12 rounded-xl border bg-owner-surface px-4 text-[18px] text-owner-ink ${amountInvalid ? "border-owner-danger" : "border-owner-border"}`}
          />
          <p id={`${inputId}-hint`} className={`text-[13px] ${amountInvalid ? "font-semibold text-owner-danger" : "text-owner-ink-muted"}`}>
            {amountInvalid ? t("detail.cmp.amountErr", { total: formatPKR(row.total) }) : t("detail.cmp.amountHint", { total: formatPKR(row.total) })}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-[14px] font-bold text-owner-ink">
            {t("detail.cmp.reason")}
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={t("detail.cmp.reasonPh")}
            className="rounded-xl border border-owner-border bg-owner-surface px-4 py-3 text-[15px] text-owner-ink"
          />
          {supported ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleMic}
                aria-pressed={listening}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-owner-ink px-4 text-[14px] font-bold text-owner-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0014 0M12 18v3" />
                </svg>
                {listening ? t("detail.cmp.micStop") : t("detail.cmp.mic")}
              </button>
              <div role="group" aria-label={t("detail.cmp.micLang")} className="inline-flex overflow-hidden rounded-xl border border-owner-border">
                {(["ur-PK", "en-PK"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={micLang === l}
                    onClick={() => setMicLang(l)}
                    className={`min-h-11 px-3 text-[13px] font-semibold ${micLang === l ? "bg-owner-accent text-white" : "bg-owner-surface text-owner-ink-muted"}`}
                  >
                    {l === "ur-PK" ? t("detail.cmp.micUr") : t("detail.cmp.micEn")}
                  </button>
                ))}
              </div>
              <span className="text-[12.5px] text-owner-ink-muted" role="status">
                {listening ? t("detail.cmp.listening") : micError ? t("detail.cmp.micError") : t("detail.cmp.micHint")}
              </span>
            </div>
          ) : (
            <p className="text-[12.5px] text-owner-ink-muted">{t("detail.cmp.noMic")}</p>
          )}
        </div>

        {due !== null ? (
          <div
            className={`flex items-start gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold ${due > 0 ? "bg-owner-danger-soft text-owner-danger" : "bg-owner-success-soft text-owner-success-dark"}`}
          >
            {due > 0 ? <WarnIcon /> : null}
            <span>{due > 0 ? t("detail.cmp.warn", { due: formatPKR(due) }) : t("detail.cmp.warnFull")}</span>
          </div>
        ) : null}

        <p role="alert" className={error ? "rounded-xl bg-owner-danger-soft px-4 py-3 text-[14px] font-semibold text-owner-danger" : "sr-only"}>
          {error}
        </p>

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-owner-ink px-6 text-[15px] font-bold text-owner-ink">
            {t("detail.cmp.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="min-h-12 rounded-xl bg-khelo-orange px-6 text-[15px] font-bold text-khelo-ink disabled:opacity-60"
          >
            {saving ? t("detail.cmp.saving") : t("detail.cmp.save")}
          </button>
        </div>
        <p className="text-[12.5px] text-owner-ink-muted">{t("detail.cmp.note")}</p>
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
        setMessage({ kind: "ok", text: t("detail.cmp.savedYes") });
        onDone(updated);
      })
      .catch((e) => {
        setMessage({ kind: "error", text: e instanceof ApiError && e.code === "COMPLETION_TOO_EARLY" ? t("detail.err.tooEarly") : friendlyErrorMessage(e, t) });
      })
      .finally(() => setBusyId(null));
  }

  const dialog = target ? (
    <CompletionDialog
      row={target}
      onClose={() => setTarget(null)}
      onSaved={(updated) => {
        setTarget(null);
        setMessage({ kind: "ok", text: t("detail.cmp.savedNo") });
        onDone(updated);
      }}
    />
  ) : null;

  return { pick, dialog, busyId, message };
}
