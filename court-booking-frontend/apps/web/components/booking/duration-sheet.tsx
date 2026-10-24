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
import { Button, Chip, MoneyRows, type MoneyRow } from "@/components/fl";

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
  cancellation,
}: {
  courtId: string;
  courtName: string;
  courtSport?: string;
  slotMinutes: number;
  slots: Slot[];
  index: number;
  onClose: () => void;
  onContinue: (choice: { slotCount: number; minutes: number; price: number }) => void;
  /** The venue's real policy fields (VenuePublicOut); the line is hidden when they are not known. */
  cancellation?: { cancellation_allowed: boolean; cancellation_cutoff_hours: number | null } | null;
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
  const policy = cancellation ? fmt.cancellationPolicy(cancellation) : "";
  // Money rows come only from the server quote (the same code that prices the hold); nothing is computed here.
  const rows: MoneyRow[] = quote
    ? [
        { label: t("venue.sheet.totalRow"), value: `PKR ${formatPKR(quote.price)}`, strong: true, note: t("venue.sheet.total", { duration: fmt.duration(quote.duration_minutes) }) },
        ...(quote.advance_amount < quote.price
          ? [
              { label: t("venue.sheet.advanceRow"), value: `PKR ${formatPKR(quote.advance_amount)}` },
              { label: t("venue.sheet.balanceRow"), value: `PKR ${formatPKR(quote.balance_due)}` },
            ]
          : []),
      ]
    : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-fl-a-scrim font-fl-body text-fl-night sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("venue.sheet.book", { court: courtLabel(courtName, courtSport) })}
        data-testid="confirm-sheet"
        className="flex max-h-[92dvh] w-full flex-col gap-5 overflow-y-auto rounded-t-fl-sheet bg-fl-white p-6 shadow-fl-raised sm:max-w-md sm:rounded-fl-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-fl-orange-deep">{courtLabel(courtName, courtSport)}</span>
            <span className="font-fl-display text-[20px] font-extrabold">{fmt.date(slot.starts_at)}</span>
            <span className="text-[15px] font-bold tabular-nums" data-testid="sheet-time-range">
              {quote ? fmt.timeRange(quote.starts_at, quote.ends_at) : fmt.timeRange(slot.starts_at, choices.find((c) => c.slotCount === slotCount)?.endsAt ?? slot.ends_at)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("venue.common.close")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fl-ground font-bold text-fl-night focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[14px] font-extrabold">{t("venue.sheet.howLong")}</span>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <Chip key={c.slotCount} label={fmt.duration(c.minutes)} selected={c.slotCount === slotCount} onClick={() => setSlotCount(c.slotCount)} />
            ))}
          </div>
        </div>

        <div data-testid="sheet-total" aria-live="polite">
          {quoteQuery.isError ? (
            <p className="rounded-fl-input bg-fl-danger-tint px-3.5 py-3 text-[14px] font-semibold text-fl-danger">{friendlyErrorMessage(quoteQuery.error)}</p>
          ) : !quote ? (
            <p className="rounded-fl-input bg-fl-ground px-3.5 py-3 text-[14px] text-fl-muted">{t("venue.sheet.working")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <MoneyRows rows={rows} />
              <p className="text-[13px] font-medium text-fl-muted">
                {quote.advance_amount < quote.price
                  ? t("venue.sheet.advance", { advance: formatPKR(quote.advance_amount), balance: formatPKR(quote.balance_due) })
                  : t("venue.sheet.payNow")}
              </p>
            </div>
          )}
        </div>

        {policy ? (
          <p className="rounded-fl-input bg-fl-teal-tint px-3.5 py-3 text-[13px] leading-snug text-fl-teal-deep" data-testid="sheet-policy">
            <b>{t("venue.sheet.policy")}: </b>
            {policy}
          </p>
        ) : null}

        <Button
          label={t("venue.sheet.continue")}
          block
          disabled={!quote}
          onClick={() => quote && onContinue({ slotCount: quote.slot_count, minutes: quote.duration_minutes, price: quote.price })}
        />
      </div>
    </div>
  );
}
