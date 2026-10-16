"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { SEEN_AFTER_MS, releaseSnapshot, seenKey, snapshotSeen, writeSeen, type SeenPage } from "@/lib/owner-seen";

/** Returns this visit's "last seen" snapshot (null = first visit) and advances the stored timestamp once the page has been
 * visible for a few seconds. Rows newer than the returned value are "naya". */
export function useSeenSince(page: SeenPage, venueId: string | undefined): number | null {
  const userId = useAuthStore((s) => s.user?.id);
  const key = seenKey(userId, venueId, page);
  const since = key ? snapshotSeen(key) : null;

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => writeSeen(key, Date.now()), SEEN_AFTER_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
      releaseSnapshot(key);
    };
  }, [key]);

  return since;
}
