"use client";

import { courtLabel } from "@/components/court-label";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { durationChoices, minSlotsFor, type Slot } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";

/**
 * "How long do you want to play?" (Section 32 Part 4 / 4c). Opens when a player taps an open 30-minute slot: they pick a
 * length of at least the court's minimum booking time, in steps of 30 minutes (only lengths whose every slot is free and back
 * to back are offered, so the selection is always contiguous), and
 * see the TOTAL price for that length before anything is held. The price comes from the server's quote endpoint --
 * the same code that prices the hold -- so it already accounts for peak-price boundaries across the whole booking.
 */
export function DurationSheet({
  courtId,
  courtName,
  courtSport,
  slotMinutes,
  slots,
  index,
  onClose,
  onContinue,
}: {
  courtId: string;
  courtName: string;
  courtSport?: string;
  slotMinutes: number;
  slots: Slot[];
  index: number;
  onClose: () => void;
  onContinue: (choice: { slotCount: number; minutes: number; price: number }) => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const slot = slots[index];
  // `slotMinutes` is the court's MINIMUM booking time (the grid itself is always 30 minutes)
  const choices = durationChoices(slots, index, minSlotsFor(slotMinutes));
  const [slotCount, setSlotCount] = useState(choices[0]?.slotCount ?? minSlotsFor(slotMinutes));
  const quoteQuery = useQuery({
    queryKey: ["booking-quote", courtId, slot.starts_at, slotCount],
    queryFn: () => api.availability.quote(courtId, slot.starts_at, slotCount),
  });
  const quote = quoteQuery.data;

  return (
    <div className="khelo fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-khelo-ink/50 font-[family-name:var(--font-khelo-body-x)] text-khelo-ink" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("venue.sheet.book", { court: courtLabel(courtName, courtSport) })}
        className="w-full sm:max-w-md bg-khelo-surface rounded-t-3xl sm:rounded-3xl p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-extrabold tracking-widest text-khelo-orange-label">{courtLabel(courtName, courtSport).toUpperCase()}</span>
            <span className="font-khelo-display text-[19px] font-extrabold">{fmt.date(slot.starts_at)}</span>
            <span className="font-mono text-[14.5px] font-semibold" data-testid="sheet-time-range">
              {quote ? fmt.timeRange(quote.starts_at, quote.ends_at) : fmt.timeRange(slot.starts_at, choices.find((c) => c.slotCount === slotCount)?.endsAt ?? slot.ends_at)}
            </span>
          </div>
          <button onClick={onClose} aria-label={t("venue.common.close")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-khelo-page font-bold text-khelo-ink">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[14px] font-bold">{t("venue.sheet.howLong")}</span>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => {
              const selected = c.slotCount === slotCount;
              return (
                <button
                  key={c.slotCount}
                  onClick={() => setSlotCount(c.slotCount)}
                  aria-pressed={selected}
                  className={`khelo-btn h-11 rounded-full border-[1.5px] px-4 text-[13.5px] font-bold text-khelo-ink ${
                    selected ? "border-khelo-orange bg-khelo-orange" : "border-khelo-border bg-khelo-surface"
                  }`}
                >
                  {fmt.duration(c.minutes)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-khelo-warm-2 border border-khelo-warm p-4 flex flex-col gap-1.5" data-testid="sheet-total">
          {quoteQuery.isError ? (
            <p className="text-khelo-orange-label text-[13.5px] font-semibold">{friendlyErrorMessage(quoteQuery.error)}</p>
          ) : !quote ? (
            <p className="text-khelo-muted text-[13.5px]">{t("venue.sheet.working")}</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-khelo-muted">{t("venue.sheet.total", { duration: fmt.duration(quote.duration_minutes) })}</span>
                <span className="font-mono text-[22px] font-bold">PKR {formatPKR(quote.price)}</span>
              </div>
              {quote.advance_amount < quote.price ? (
                <p className="text-[12.5px] font-medium text-khelo-muted">
                  {t("venue.sheet.advance", { advance: formatPKR(quote.advance_amount), balance: formatPKR(quote.balance_due) })}
                </p>
              ) : (
                <p className="text-[12.5px] font-medium text-khelo-muted">{t("venue.sheet.payNow")}</p>
              )}
            </>
          )}
        </div>

        <button
          onClick={() => quote && onContinue({ slotCount: quote.slot_count, minutes: quote.duration_minutes, price: quote.price })}
          disabled={!quote}
          className="khelo-btn min-h-12 rounded-[14px] bg-khelo-orange text-[15px] font-extrabold text-khelo-ink disabled:opacity-50"
        >
          {t("venue.sheet.continue")}
        </button>
      </div>
    </div>
  );
}
