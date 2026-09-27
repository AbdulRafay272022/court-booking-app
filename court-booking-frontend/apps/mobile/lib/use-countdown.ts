import { useEffect, useState } from "react";

/** A one-second countdown (QA #5): call `start(n)` with seconds; `seconds` ticks to 0. */
export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  return { seconds, start: setSeconds };
}

/** Reads a lockout's retry_after_seconds from an ApiError's details (0 if absent). */
export function retryAfterSeconds(details: Record<string, unknown> | undefined): number {
  const v = details?.retry_after_seconds;
  return typeof v === "number" && v > 0 ? Math.ceil(v) : 0;
}
