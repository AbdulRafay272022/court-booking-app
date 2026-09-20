"use client";

import { TONES, type Tone } from "./tone";

/** The primary button on every auth form ("smart submit"): muted grey and inert until every
 * required field is actually VALID (`ready`), then the full brand color. A not-ready button
 * does nothing when clicked -- `disabled` plus a guard on the click, so it can't be
 * submitted by Enter in a field or a synthetic click either. `busy` shows progress and
 * likewise blocks a second submit. */
export function SubmitButton({
  ready,
  busy = false,
  children,
  busyLabel,
  tone = "player",
  type = "submit",
  onClick,
}: {
  ready: boolean;
  busy?: boolean;
  children: React.ReactNode;
  busyLabel?: string;
  tone?: Tone;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  const t = TONES[tone];
  const active = ready && !busy;
  return (
    <button
      type={type}
      disabled={!active}
      aria-disabled={!active}
      onClick={(e) => {
        if (!active) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
      className="h-14 rounded-[14px] text-[16.5px] font-bold transition-colors w-full"
      style={
        active
          ? { background: t.accent, color: "#fff", cursor: "pointer" }
          : ready && busy
            ? { background: t.accent, color: "#fff", opacity: 0.7, cursor: "progress" }
            : { background: t.border, color: t.faint, cursor: "not-allowed" }
      }
    >
      {busy ? (busyLabel ?? "Please wait…") : children}
    </button>
  );
}
