"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { OwnerBookingRow } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { pkr, validateReceived } from "@/lib/overview-helpers";
import { Modal } from "./overlay";

// The Web Speech API is not in TypeScript's DOM lib; only the parts used here.
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEventLike {
  results: { length: number; [index: number]: SpeechResultLike };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function speechCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export interface CompletionDialogProps {
  row: OwnerBookingRow | null;
  onClose: () => void;
  /** Resolves to an error message to show, or null when saved. */
  onSave: (receivedPkr: number, reason: string) => Promise<string | null>;
}

/** "Booking adhoora?": how much was actually received and why (spec 2.5, design "Nahi kitna mila + wajah"). */
export function CompletionDialog({ row, onClose, onSave }: CompletionDialogProps) {
  if (!row) return null;
  // Keyed by booking so the form always starts from this row's own numbers.
  return <CompletionForm key={row.booking_id} row={row} onClose={onClose} onSave={onSave} />;
}

function CompletionForm({ row, onClose, onSave }: CompletionDialogProps & { row: OwnerBookingRow }) {
  const t = useT();
  const fmt = useFmt();
  const [received, setReceived] = useState(row.total_paid.toLocaleString("en-US"));
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState(row.completion?.result === "no" ? (row.completion.reason ?? "") : "");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState(false);
  const [speechLang, setSpeechLang] = useState<"ur-PK" | "en-PK">("ur-PK");
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const baseRef = useRef("");
  const receivedId = useId();
  const helpId = useId();
  const reasonId = useId();
  const micHelpId = useId();

  const micSupported = useSyncExternalStore(noopSubscribe, () => speechCtor() !== null, () => false);
  const check = validateReceived(received, row.total);
  const showError = touched && !check.ok;

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    setMicError(false);
    const rec = new Ctor();
    rec.lang = speechLang;
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = reason;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
      const base = baseRef.current;
      setReason(`${base}${base && !/\s$/.test(base) ? " " : ""}${text}`.slice(0, 500));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setMicError(true);
      setListening(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setMicError(true);
    }
  }

  async function submit() {
    setTouched(true);
    if (!check.ok || saving) return;
    recognitionRef.current?.stop();
    setSaving(true);
    setServerError(null);
    const error = await onSave(check.value, reason.trim());
    setSaving(false);
    if (error) setServerError(error);
  }

  const dueAfter = check.ok ? row.total - check.value : row.total - row.total_paid;
  const subtitle = [
    row.player_name ?? t("ovw.table.noName"),
    row.court_name,
    fmt.timeRange(row.starts_at, row.ends_at),
    row.short_code,
  ].join(" · ");

  return (
    <Modal open onClose={onClose} title={t("ovw.dialog.title")} subtitle={subtitle} testId="ovw-completion-dialog">
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-khelo-page px-4 py-3 text-sm text-khelo-muted">
        <span>
          {t("ovw.dialog.total")} <b className="text-khelo-ink tabular-nums">{row.total.toLocaleString("en-US")}</b>
        </span>
        <span className="text-center">
          {t("ovw.dialog.advance")} <b className="text-khelo-ink tabular-nums">{row.advance.toLocaleString("en-US")}</b>
        </span>
        <span className="text-right">
          {t("ovw.dialog.due")} <b className="text-khelo-ink tabular-nums">{row.due.toLocaleString("en-US")}</b>
        </span>
      </div>

      <label htmlFor={receivedId} className="block mt-5 text-sm font-bold text-khelo-ink">
        {t("ovw.dialog.received")}
      </label>
      <input
        id={receivedId}
        data-testid="ovw-received"
        data-autofocus
        inputMode="numeric"
        autoComplete="off"
        value={received}
        onChange={(e) => setReceived(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={showError}
        aria-describedby={helpId}
        className={`mt-1.5 h-12 w-full rounded-xl border-[1.5px] bg-khelo-surface px-4 text-lg text-khelo-ink ${
          showError ? "border-khelo-danger" : "border-khelo-border"
        }`}
      />
      <p id={helpId} className={`mt-1.5 text-[13px] ${showError ? "text-owner-danger font-semibold" : "text-khelo-muted"}`}>
        {showError && !check.ok
          ? check.error === "required"
            ? t("ovw.dialog.err.required")
            : t("ovw.dialog.err.range", { total: row.total.toLocaleString("en-US") })
          : t("ovw.dialog.receivedHelp", { total: row.total.toLocaleString("en-US") })}
      </p>

      <label htmlFor={reasonId} className="block mt-5 text-sm font-bold text-khelo-ink">
        {t("ovw.dialog.reason")}
      </label>
      <textarea
        id={reasonId}
        data-testid="ovw-reason"
        rows={4}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-1.5 w-full rounded-xl border-[1.5px] border-khelo-border bg-khelo-surface px-4 py-3 text-base text-khelo-ink"
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {micSupported ? (
          <>
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={listening}
              data-testid="ovw-mic"
              aria-describedby={micHelpId}
              className={`min-h-11 px-4 inline-flex items-center gap-2 rounded-xl border-[1.5px] font-bold text-sm whitespace-nowrap ${
                listening ? "border-khelo-orange bg-khelo-warm text-khelo-ink" : "border-khelo-ink bg-khelo-surface text-khelo-ink"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0014 0M12 18v3" />
              </svg>
              {listening ? t("ovw.dialog.micStop") : t("ovw.dialog.mic")}
            </button>
            <div role="group" aria-label={t("ovw.dialog.micLang")} className="inline-flex rounded-xl border-[1.5px] border-khelo-border overflow-hidden">
              {(["ur-PK", "en-PK"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={speechLang === l}
                  disabled={listening}
                  onClick={() => setSpeechLang(l)}
                  className={`min-h-11 px-3.5 text-sm font-bold whitespace-nowrap disabled:opacity-60 ${
                    speechLang === l ? "bg-khelo-ink text-white" : "bg-khelo-surface text-khelo-ink"
                  }`}
                >
                  {l === "ur-PK" ? t("ovw.dialog.micUrdu") : t("ovw.dialog.micEnglish")}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <p id={micHelpId} className="flex-1 min-w-[12rem] text-[13px] text-khelo-muted">
          {t("ovw.dialog.micHelp")}
        </p>
      </div>
      {micError ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-owner-danger">
          {t("ovw.dialog.micError")}
        </p>
      ) : null}

      <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-owner-danger-soft px-4 py-3 text-sm font-semibold text-owner-danger" data-testid="ovw-preview">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6m0 3.5h.01" />
        </svg>
        <span>{t("ovw.dialog.preview", { due: pkr(dueAfter) })}</span>
      </div>

      <div aria-live="assertive" role="status" className="min-h-0">
        {serverError ? (
          <p data-testid="ovw-completion-error" className="mt-3 rounded-xl bg-owner-danger-soft px-4 py-3 text-sm font-semibold text-owner-danger">
            {serverError}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-12 px-6 rounded-xl border-[1.5px] border-khelo-ink bg-khelo-surface font-bold text-khelo-ink"
        >
          {t("ovw.dialog.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          data-testid="ovw-completion-save"
          className="min-h-12 px-6 rounded-xl bg-khelo-orange font-bold text-khelo-ink disabled:opacity-60"
        >
          {saving ? t("ovw.dialog.saving") : t("ovw.dialog.save")}
        </button>
      </div>
      <p className="mt-4 text-[13px] text-khelo-muted">{t("ovw.dialog.footnote")}</p>
    </Modal>
  );
}
