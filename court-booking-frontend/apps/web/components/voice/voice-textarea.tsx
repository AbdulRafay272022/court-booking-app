"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n/lang-provider";
import { appendPhrase, toRomanUrdu } from "@/lib/voice/convert";
import { formatElapsed, SpeechSession, speechRecognitionCtor } from "@/lib/voice/speech-session";
import type { SpeechErrorKind, SpeechLang } from "@/lib/voice/speech-session";

/** A labelled textarea with the free, continuous Web Speech mic (A9). Other agents import it for reject / cancel / refund reasons;
 * the props are a shared contract (docs/round2-contract.md) and must not change. */
export interface VoiceTextareaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
  maxLength?: number;
}

const noopSubscribe = () => () => {};

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function VoiceTextarea({ id, label, value, onChange, required, rows = 3, maxLength }: VoiceTextareaProps) {
  const t = useT();
  const supported = useSyncExternalStore(noopSubscribe, () => speechRecognitionCtor() !== null, () => false);
  const [lang, setLang] = useState<SpeechLang>("ur-PK");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechErrorKind | null>(null);
  const [status, setStatus] = useState<"" | "started" | "stopped">("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const sessionRef = useRef<SpeechSession | null>(null);

  // the latest value/onChange, so a phrase that arrives later appends to what is in the box now (not to an old copy)
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => () => sessionRef.current?.dispose(), []);

  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [listening]);

  function addFinal(raw: string) {
    const phrase = toRomanUrdu(raw);
    if (!phrase) return;
    const next = appendPhrase(valueRef.current, phrase, maxLength);
    valueRef.current = next;
    onChangeRef.current(next);
  }

  function toggle() {
    if (sessionRef.current?.listening) {
      sessionRef.current.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    sessionRef.current?.dispose();
    setError(null);
    const session = new SpeechSession(Ctor, lang, {
      onFinal: addFinal,
      onInterim: (text) => setInterim(text ? toRomanUrdu(text) : ""),
      onListening: (on) => {
        setListening(on);
        setStatus(on ? "started" : "stopped");
        if (on) {
          const start = Date.now();
          setStartedAt(start);
          setNow(start);
        }
      },
      onError: (kind) => setError(kind),
    });
    sessionRef.current = session;
    session.start();
  }

  const elapsed = formatElapsed(startedAt !== null ? (now - startedAt) / 1000 : 0);
  const hintId = `${id}-voice-hint`;
  const errorText = error ? t(`voice.${error}` as "voice.denied") : null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="voice-textarea">
      <label htmlFor={id} className="text-[14px] font-bold text-khelo-ink">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-required={required || undefined}
        rows={rows}
        maxLength={maxLength}
        aria-describedby={hintId}
        className="w-full rounded-xl border-[1.5px] border-khelo-border bg-khelo-surface px-4 py-3 text-base text-khelo-ink"
      />

      {listening && interim ? (
        <p data-testid="voice-interim" aria-label={t("voice.interim")} className="rounded-lg bg-khelo-page px-3 py-2 text-[14px] italic text-khelo-muted break-words">
          {interim}
        </p>
      ) : null}

      {supported ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-pressed={listening}
            aria-label={listening ? t("voice.stopAria") : t("voice.micAria")}
            data-testid="voice-mic"
            className={`min-h-11 px-4 inline-flex items-center gap-2 rounded-xl border-[1.5px] text-[14px] font-bold whitespace-nowrap ${
              listening ? "border-owner-danger bg-owner-danger-soft text-owner-danger" : "border-khelo-ink bg-khelo-surface text-khelo-ink"
            }`}
          >
            {listening ? <StopIcon /> : <MicIcon />}
            {listening ? t("voice.stop") : t("voice.mic")}
          </button>
          <div role="group" aria-label={t("voice.lang")} className="inline-flex overflow-hidden rounded-xl border-[1.5px] border-khelo-border">
            {(["ur-PK", "en-IN"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                disabled={listening}
                onClick={() => setLang(l)}
                data-testid={l === "ur-PK" ? "voice-lang-ur" : "voice-lang-en"}
                className={`min-h-11 px-3.5 text-[13px] font-bold whitespace-nowrap disabled:opacity-60 ${
                  lang === l ? "bg-khelo-ink text-white" : "bg-khelo-surface text-khelo-ink"
                }`}
              >
                {l === "ur-PK" ? t("voice.langUr") : t("voice.langEn")}
              </button>
            ))}
          </div>
          {listening ? (
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-khelo-ink" data-testid="voice-listening">
              <span aria-hidden="true" data-testid="voice-dot" className="relative inline-flex h-3 w-3">
                <span className="absolute inset-0 rounded-full bg-owner-danger motion-safe:animate-ping opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-owner-danger" />
              </span>
              <span className="tabular-nums" data-testid="voice-timer" aria-label={t("voice.timerAria", { time: elapsed })}>
                {elapsed}
              </span>
              <span>{t("voice.listening")}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <p id={hintId} className="text-[12.5px] text-khelo-muted" data-testid={supported ? "voice-hint" : "voice-unsupported"}>
        {supported ? t("voice.hint") : t("voice.unsupported")}
      </p>

      <p className="sr-only" role="status" aria-live="polite">
        {status === "started" ? t("voice.started") : status === "stopped" ? t("voice.stopped") : ""}
      </p>
      <div role="alert" aria-live="assertive">
        {errorText ? (
          <p data-testid="voice-error" className="flex items-start gap-2 rounded-xl bg-owner-danger-soft px-3 py-2 text-[13px] font-semibold text-owner-danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6m0 3.5h.01" />
            </svg>
            <span>{errorText}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
