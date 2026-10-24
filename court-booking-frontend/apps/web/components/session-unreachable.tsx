"use client";

import { Logo } from "@/components/auth/logo";
import { useT } from "@/components/i18n/lang-provider";

/** Shown when a stored session couldn't be confirmed because the server was unreachable
 * (after retries) and there's no cached profile to run on. The user is NOT signed out and
 * is deliberately not sent to the login screen -- logging in again costs a WhatsApp send and
 * wouldn't fix a network problem. */
export function SessionUnreachable({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size={56} />
      <div className="flex flex-col gap-2 max-w-sm">
        <h1 className="text-xl font-extrabold tracking-tight">{t("common.unreachable.title")}</h1>
        <p className="text-player-ink-muted text-[15px] leading-relaxed">
          {t("common.unreachable.text")}
        </p>
      </div>
      <button
        onClick={onRetry}
        className="h-12 px-8 rounded-[14px] bg-fl-orange text-fl-night font-bold text-[15px]"
      >
        {t("common.error.retry")}
      </button>
    </main>
  );
}
