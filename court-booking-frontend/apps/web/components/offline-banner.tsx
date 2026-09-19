"use client";

import { useNetworkStatus } from "@/lib/network-status";

/** Section 12: "airplane mode / wifi drop mid-session -> clear 'you're offline' state ...
 * reconnecting resumes normal operation." Rendered once at the app root so it's visible
 * on every page. */
export function OfflineBanner() {
  const online = useNetworkStatus();
  if (online) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center px-3 pt-2">
      <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl" style={{ background: "#141A1D" }}>
        <span className="w-2 h-2 rounded-full" style={{ background: "#E29B8A" }} />
        <span className="text-white text-[12.5px] font-semibold">
          You&apos;re offline — check your connection. We&apos;ll reconnect automatically.
        </span>
      </div>
    </div>
  );
}
