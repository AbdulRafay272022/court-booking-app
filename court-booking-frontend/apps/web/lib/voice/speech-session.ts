// Continuous listening on top of the browser's free Web Speech API (A9). Chrome ends a recognition session on its own after a
// pause or about a minute; while the owner's mic toggle is on, the session is started again from `onend`, so it keeps listening
// until the owner taps the mic again. No audio leaves the browser through our code: the recogniser is the browser's own.
// Framework free and unit-tested (speech-session.test.ts) with a fake recognition object.

export interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResultLike };
}
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

export type SpeechLang = "ur-PK" | "en-IN";
export type SpeechErrorKind = "denied" | "noMic" | "network" | "failed";

export interface SpeechCallbacks {
  /** A finished phrase (raw recogniser text; the caller converts it). */
  onFinal(text: string): void;
  /** The words heard so far that are not final yet ("" clears). */
  onInterim(text: string): void;
  /** Listening on/off as the owner sees it. */
  onListening(on: boolean): void;
  /** A problem that stopped listening. */
  onError(kind: SpeechErrorKind): void;
}

/** The browser's recogniser constructor, or null (Firefox, server). */
export function speechRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL: Record<string, SpeechErrorKind> = {
  "not-allowed": "denied",
  "service-not-allowed": "denied",
  "audio-capture": "noMic",
  network: "network",
  "language-not-supported": "failed",
  "bad-grammar": "failed",
};

export class SpeechSession {
  private rec: RecognitionLike | null = null;
  private wanted = false;
  private delivered = 0;
  private interim = "";
  private lastStart = 0;
  private quickEnds = 0;
  private readonly now: () => number;
  private readonly maxQuickRestarts: number;

  constructor(
    private readonly Ctor: RecognitionCtor,
    private readonly lang: SpeechLang,
    private readonly cb: SpeechCallbacks,
    opts: { now?: () => number; maxQuickRestarts?: number } = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.maxQuickRestarts = opts.maxQuickRestarts ?? 5;
  }

  get listening(): boolean {
    return this.wanted;
  }

  /** Starts listening; false when the browser refused to start. */
  start(): boolean {
    if (this.wanted) return true;
    this.wanted = true;
    this.quickEnds = 0;
    const rec = new this.Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => this.handleResult(e);
    rec.onerror = (e) => this.handleError(e?.error ?? "");
    rec.onend = () => this.handleEnd();
    this.rec = rec;
    if (!this.begin()) return false;
    this.cb.onListening(true);
    return true;
  }

  /** Stops for good (the owner tapped the mic again). Words still being recognised may arrive as a last final phrase. */
  stop(): void {
    if (!this.wanted) return;
    this.wanted = false;
    this.cb.onListening(false);
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
  }

  /** Detach everything (component unmount). */
  dispose(): void {
    this.wanted = false;
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }

  private begin(): boolean {
    this.delivered = 0;
    this.interim = "";
    this.lastStart = this.now();
    try {
      this.rec?.start();
      return true;
    } catch {
      this.fail("failed");
      return false;
    }
  }

  private fail(kind: SpeechErrorKind) {
    const was = this.wanted;
    this.wanted = false;
    if (was) this.cb.onListening(false);
    this.cb.onInterim("");
    this.cb.onError(kind);
  }

  private handleResult(e: RecognitionEventLike) {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i];
      const text = r?.[0]?.transcript ?? "";
      if (r.isFinal) {
        if (i >= this.delivered) {
          this.delivered = i + 1;
          if (text.trim()) this.cb.onFinal(text);
        }
      } else interim += text;
    }
    this.interim = interim;
    this.cb.onInterim(interim);
  }

  private handleError(code: string) {
    const kind = FATAL[code];
    if (kind && this.wanted) this.fail(kind);
    // "no-speech" and "aborted" are normal: onend follows and restarts while the toggle is on
  }

  private handleEnd() {
    // words that were heard but never finalised before the session ended are kept, not lost
    if (this.interim.trim()) this.cb.onFinal(this.interim);
    this.interim = "";
    this.cb.onInterim("");
    if (!this.wanted) return;
    // a recogniser that ends immediately again and again (no mic, blocked) must not spin forever
    if (this.now() - this.lastStart < 1000) this.quickEnds += 1;
    else this.quickEnds = 0;
    if (this.quickEnds > this.maxQuickRestarts) {
      this.fail("failed");
      return;
    }
    this.begin();
  }
}

/** "m:ss" for the elapsed-time label. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
