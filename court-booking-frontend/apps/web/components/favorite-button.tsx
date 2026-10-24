"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { FAVORITES_KEY, useFavorites } from "@/lib/use-favorites";
import { useT } from "@/components/i18n/lang-provider";
import { Heart } from "@/components/fl";

/**
 * Save / un-save state for one venue, shared by the venue-page pill and the Floodlight VenueCard heart.
 * `visible` is false for signed-in owners and admins (only players save venues). Signed out, `toggle` goes to login and comes back.
 * The heart flips at once and settles when the server answers; if the call fails it flips back and `failed` is true for a moment.
 */
export function useFavoriteToggle(venueId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const { enabled, loading, ids } = useFavorites();
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  const visible = !(status === "signedIn" && role !== "player");
  const saved = pending ?? ids.has(venueId);
  const busy = pending !== null || loading || status === "hydrating";

  async function toggle(e?: { preventDefault(): void; stopPropagation(): void }) {
    // the card sits next to a link: never let a tap on the heart also open the venue
    e?.preventDefault();
    e?.stopPropagation();
    if (status === "signedOut") {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (!enabled || busy) return;
    const next = !saved;
    setFailed(false);
    setPending(next);
    try {
      if (next) await api.favorites.add(venueId);
      else await api.favorites.remove(venueId);
      await queryClient.invalidateQueries({ queryKey: FAVORITES_KEY });
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 3500);
    } finally {
      setPending(null);
    }
  }

  return { visible, saved, busy, failed, toggle };
}

/** Labelled save button for the venue page (the cards use the heart inside the Floodlight VenueCard). */
export function FavoriteButton({ venueId, venueName }: { venueId: string; venueName: string }) {
  const t = useT();
  const { visible, saved, busy, failed, toggle } = useFavoriteToggle(venueId);
  if (!visible) return null;
  const label = saved ? t("play.fav.removeAria", { name: venueName }) : t("play.fav.saveAria", { name: venueName });
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={label}
      data-testid="favorite-button"
      title={failed ? t("play.fav.failed") : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[13.5px] font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night ${
        saved ? "border-fl-orange bg-fl-orange-tint text-fl-night" : "border-fl-line-strong bg-fl-white text-fl-night hover:border-fl-night"
      } ${busy ? "opacity-70" : ""}`}
    >
      <Heart size={18} fill={saved ? "currentColor" : "none"} className={saved ? "text-fl-orange-deep" : ""} aria-hidden />
      {failed ? t("play.tryAgain") : saved ? t("play.fav.saved") : t("play.fav.save")}
    </button>
  );
}
