"use client";

import { Logo } from "@/components/auth/logo";

/** Shown when a stored session couldn't be confirmed because the server was unreachable
 * (after retries) and there's no cached profile to run on. The user is NOT signed out and
 * is deliberately not sent to the login screen -- logging in again costs a WhatsApp send and
 * wouldn't fix a network problem. */
export function SessionUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size={56} />
      <div className="flex flex-col gap-2 max-w-sm">
        <h1 className="text-xl font-extrabold tracking-tight">Can&apos;t reach Maidan right now</h1>
        <p className="text-player-ink-muted text-[15px] leading-relaxed">
          You&apos;re still signed in. Check your connection and we&apos;ll pick up where you left off.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="h-12 px-8 rounded-[14px] bg-player-accent text-white font-bold text-[15px]"
      >
        Try again
      </button>
    </main>
  );
}
