"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";

/** Section 32 Part 6: the owner sees their venue's reviews and can post one public reply each. */
export default function OwnerReviewsPage() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const venueId = activeVenue?.id;
  const query = useQuery({
    queryKey: ["owner-reviews", venueId],
    queryFn: () => api.reviews.listForVenue(venueId!),
    enabled: !!venueId,
  });
  const reviews = query.data ?? [];

  return (
    <div className="p-8 max-w-2xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Reviews</h1>
      {venuesLoading || query.isLoading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : reviews.length === 0 ? (
        <p className="text-owner-ink-faint">No reviews yet. They'll appear here after players rate a completed game.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((r) => (
            <OwnerReviewCard key={r.id} review={r} venueId={venueId!} />
          ))}
        </div>
      )}
    </div>
  );
}

function OwnerReviewCard({ review, venueId }: { review: Review; venueId: string }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(review.owner_reply ?? "");
  const [editing, setEditing] = useState(!review.owner_reply);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!reply.trim()) { setError("Write a reply first."); return; }
    setBusy(true); setError(null);
    try {
      await api.reviews.reply(review.id, reply.trim());
      await queryClient.invalidateQueries({ queryKey: ["owner-reviews", venueId] });
      setEditing(false);
    } catch (e) { setError(friendlyErrorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-owner-accent text-[15px]">
          {"★".repeat(review.rating)}<span className="text-owner-border">{"★".repeat(5 - review.rating)}</span>
          <span className="ml-2 font-semibold text-owner-ink text-[13.5px]">{review.player_first_name ?? "Player"}</span>
        </span>
        <span className="text-[12.5px] text-owner-ink-faint">{formatShortDate(review.created_at)}</span>
      </div>
      {review.comment ? <p className="text-[14px] text-owner-ink-muted">{review.comment}</p> : null}

      {review.owner_reply && !editing ? (
        <div className="pl-3 border-l-2 border-owner-border">
          <p className="text-[12px] font-bold text-owner-ink-faint">Your reply</p>
          <p className="text-[14px] text-owner-ink-muted">{review.owner_reply}</p>
          <button onClick={() => setEditing(true)} className="text-[12.5px] font-semibold text-owner-accent mt-1">Edit reply</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply publicly to this review"
            className="rounded-lg border border-owner-border p-2.5 text-[13.5px] outline-none"
            rows={2}
          />
          {error ? <p role="alert" className="text-[12.5px] font-semibold text-owner-danger">{error}</p> : null}
          <button onClick={save} disabled={busy} className="self-start px-4 h-9 rounded-lg font-semibold text-white bg-owner-accent disabled:opacity-50 text-[13px]">
            {busy ? "Saving…" : "Post reply"}
          </button>
        </div>
      )}
    </div>
  );
}
