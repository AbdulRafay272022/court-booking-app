"use client";

import { ErrorState } from "@/components/error-state";
import { useT } from "@/components/i18n/lang-provider";

/** Last-resort screen for an unexpected error inside a route (the root layout, with the language provider, is still mounted). */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-screen flex-col">
      <ErrorState message={t("errors.code.UNKNOWN_ERROR")} onRetry={reset} />
    </main>
  );
}
