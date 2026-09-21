"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { durationChoices, formatDuration, type Slot } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";

/**
 * "How long do you want to play?" (Section 32 Part 4). Opens when a player taps an open slot: they pick a length in
 * multiples of the court's slot length (only lengths whose every slot is free and back to back are offered), and
 * see the TOTAL price for that length before anything is held. The price comes from the server's quote endpoint --
 * the same code that prices the hold -- so it already accounts for peak-price boundaries across the whole booking.
 */
export function DurationSheet({
  courtId,
  courtName,
  slotMinutes,
  slots,
  index,
  onClose,
  onContinue,
}: {
  courtId: string;
  courtName: string;
  slotMinutes: number;
  slots: Slot[];
  index: number;
  onClose: () => void;
  onContinue: (choice: { slotCount: number; minutes: number; price: number }) => void;
}) {
  const slot = slots[index];
  const choices = durationChoices(slots, index, slotMinutes);
  const [slotCount, setSlotCount] = useState(1);
  const quoteQuery = useQuery({
    queryKey: ["booking-quote", courtId, slot.starts_at, slotCount],
    queryFn: () => api.availability.quote(courtId, slot.starts_at, slotCount),
  });
  const quote = quoteQuery.data;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Book ${courtName}`}
        className="w-full sm:max-w-md bg-player-surface rounded-t-3xl sm:rounded-3xl p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-widest text-player-accent-hover">{courtName.toUpperCase()}</span>
            <span className="text-[17px] font-bold">{formatDate(slot.starts_at)}</span>
            <span className="font-mono text-[14.5px] font-semibold" data-testid="sheet-time-range">
              {quote ? formatTimeRange(quote.starts_at, quote.ends_at) : formatTimeRange(slot.starts_at, slot.ends_at)}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-xl bg-player-surface-2 font-bold">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[14px] font-bold">How long do you want to play?</span>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => {
              const selected = c.slotCount === slotCount;
              return (
                <button
                  key={c.slotCount}
                  onClick={() => setSlotCount(c.slotCount)}
                  aria-pressed={selected}
                  className="h-11 px-4 rounded-xl text-[13.5px] font-bold"
                  style={{
                    background: selected ? "#141A1D" : "#FFFFFF",
                    color: selected ? "#FFFFFF" : "#141A1D",
                    border: selected ? "1px solid #141A1D" : "1px solid #E0D9D4",
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-player-accent-soft border border-player-accent-soft-border p-4 flex flex-col gap-1.5" data-testid="sheet-total">
          {quoteQuery.isError ? (
            <p className="text-player-danger text-[13.5px] font-semibold">{friendlyErrorMessage(quoteQuery.error)}</p>
          ) : !quote ? (
            <p className="text-player-ink-faint text-[13.5px]">Working out the price…</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-player-ink-faint">Total for {formatDuration(quote.duration_minutes)}</span>
                <span className="font-mono text-[22px] font-bold">PKR {formatPKR(quote.price)}</span>
              </div>
              {quote.advance_amount < quote.price ? (
                <p className="text-[12.5px] font-medium text-player-ink-faint">
                  Pay PKR {formatPKR(quote.advance_amount)} now to hold it; PKR {formatPKR(quote.balance_due)} at the venue.
                </p>
              ) : (
                <p className="text-[12.5px] font-medium text-player-ink-faint">You pay this now to hold the court.</p>
              )}
            </>
          )}
        </div>

        <button
          onClick={() => quote && onContinue({ slotCount: quote.slot_count, minutes: quote.duration_minutes, price: quote.price })}
          disabled={!quote}
          className="h-12 rounded-xl bg-player-accent text-white font-bold text-[15px] disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
