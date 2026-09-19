"use client";

/** Distinct failure state for a screen's primary data fetch — Section 12: never leave a
 * failed network call as an infinite spinner or a silently-blank screen. Shared between
 * both design systems via `tone` rather than duplicated per app-section. */
export function ErrorState({
  message,
  onRetry,
  tone = "player",
}: {
  message: string;
  onRetry: () => void;
  tone?: "player" | "owner";
}) {
  const inkClass = tone === "owner" ? "text-owner-ink" : "text-player-ink";
  const faintClass = tone === "owner" ? "text-owner-ink-faint" : "text-player-ink-faint";
  const accentClass = tone === "owner" ? "bg-owner-accent" : "bg-player-accent";

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9C5C0A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01" />
      </svg>
      <p className={`font-bold text-base ${inkClass}`}>Something went wrong</p>
      <p className={`font-medium text-sm max-w-xs ${faintClass}`}>{message}</p>
      <button
        onClick={onRetry}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg mt-1 font-semibold text-[13.5px] text-white ${accentClass}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 10-2.6 6.36M21 12V6m0 6h-6" />
        </svg>
        Try again
      </button>
    </div>
  );
}
