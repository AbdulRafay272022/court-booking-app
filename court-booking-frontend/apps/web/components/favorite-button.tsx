"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { FAVORITES_KEY, useFavorites } from "@/lib/use-favorites";

function Heart({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

/**
 * Save / un-save a venue. `card` is a round button for the corner of a photo, `pill` is a labelled button for the venue page.
 * Signed out: tapping goes to login and comes back here. Owners and admins never see it (only players save venues).
 * The heart flips at once and settles when the server answers; if the call fails it flips back and says so.
 */
export function FavoriteButton({ venueId, venueName, variant = "card" }: { venueId: string; venueName: string; variant?: "card" | "pill" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const { enabled, loading, ids } = useFavorites();
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  if (status === "signedIn" && role !== "player") return null;

  const saved = pending ?? ids.has(venueId);
  const busy = pending !== null || loading || status === "hydrating";

  async function toggle(e: React.MouseEvent) {
    // the card sits next to a link: never let a tap on the heart also open the venue
    e.preventDefault();
    e.stopPropagation();
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

  const label = saved ? `Remove ${venueName} from saved venues` : `Save ${venueName}`;
  const tone = saved ? "text-player-accent" : "text-player-ink-muted";

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={label}
        data-testid="favorite-button"
        title={failed ? "Couldn't update your saved venues. Try again." : undefined}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-bold transition-colors ${
          saved ? "border-player-accent-soft-border bg-player-accent-soft text-player-accent-hover" : "border-player-border bg-player-surface text-player-ink-muted hover:border-player-accent hover:text-player-accent-hover"
        } ${busy ? "opacity-70" : ""}`}
      >
        <span className={saved ? "text-player-accent" : ""}>
          <Heart filled={saved} />
        </span>
        {failed ? "Try again" : saved ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={label}
      data-testid="favorite-button"
      title={failed ? "Couldn't update your saved venues. Try again." : undefined}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-sm transition hover:scale-110 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-player-accent ${tone} ${busy ? "opacity-70" : ""}`}
    >
      <Heart filled={saved} />
    </button>
  );
}
