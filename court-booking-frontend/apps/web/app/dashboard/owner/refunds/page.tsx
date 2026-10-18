"use client";

import { useOwnerCourtSports } from "@/lib/court-sports";

import { courtLabel } from "@/components/court-label";

import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import { isPlausibleRefundReference, refundAmountError, refundBreakdown, type RefundBreakdown } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey, TFunction } from "@/lib/i18n";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import type { OwnerRefund } from "@court-booking/types";
import { BookingDetail } from "@/components/owner/booking-detail";
import { FilterBanner, NayaChip, RowLinks } from "@/components/owner/queue-extras";
import { ScreenshotThumb } from "@/components/media/screenshot-thumb";
import { parseQueueFilter } from "@/lib/queue-filter";
import { isNaya } from "@/lib/owner-seen";
import { useSeenSince } from "@/lib/use-owner-seen";

/** A refund row may carry the payment it came from (newer backends); without it there is no screenshot to show. */
type RefundRow = OwnerRefund & { payment_id?: string | null };

const TEAL = "#0E6274";
const DANGER = "#A8432C";

/** "Hissa wapas" / "Wapas dena hai" chip: icon + text, never colour alone. */
function StatusChip({ b }: { b: RefundBreakdown }) {
  const t = useT();
  if (b.status === "partial") {
    return (
      <span data-testid="refund-status" className="inline-flex items-center gap-1 rounded-full border border-owner-warn-soft-border bg-owner-warn-soft px-2 py-0.5 text-[11.5px] font-semibold text-owner-warn-dark whitespace-nowrap">
        <span aria-hidden="true">&#9680;</span>
        {t("rfd.status.partial")}
      </span>
    );
  }
  if (b.status === "done" || b.status === "none") {
    return (
      <span data-testid="refund-status" className="inline-flex items-center gap-1 rounded-full border border-owner-border px-2 py-0.5 text-[11.5px] font-semibold text-owner-ink-muted whitespace-nowrap">
        <span aria-hidden="true">&#10003;</span>
        {t("rfd.status.done")}
      </span>
    );
  }
  return (
    <span data-testid="refund-status" className="inline-flex items-center gap-1 rounded-full border border-owner-border px-2 py-0.5 text-[11.5px] font-semibold text-owner-ink whitespace-nowrap">
      <span aria-hidden="true">&#9675;</span>
      {t("rfd.status.owed")}
    </span>
  );
}

function reasonText(t: TFunction, refund: OwnerRefund): string | null {
  const key = refund.reason_label_key || refund.reason;
  if (!key) return null;
  const k = `rfd.reason.${key}` as MessageKey;
  const translated = t(k);
  return translated === k ? t("rfd.reason.generic", { reason: key.replace(/_/g, " ") }) : translated;
}

/** Section 32 Part 10 + Round 2 A10: the owner's "Refunds to pay" screen. A refund here was always sent
 * OUTSIDE the app (JazzCash/bank) -- there is no payment gateway. This screen only records
 * that it happened, with a reference the owner can point to later if a player disputes it. */
export default function OwnerRefundsPage() {
  const t = useT();
  const fmt = useFmt();
  const sports = useOwnerCourtSports();
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const filter = parseQueueFilter(useSearchParams());
  const since = useSeenSince("refunds", activeVenueId);

  const query = useQuery({
    queryKey: ["owner-refunds", activeVenueId, filter.date ?? null, filter.courtIds.join(",")],
    queryFn: () => api.owners.refunds(activeVenueId, { date: filter.date, courtIds: filter.courtIds }),
    enabled: !!activeVenueId,
  });

  const list = (query.data ?? []) as RefundRow[];
  const open = list.find((r) => r.id === openId) ?? null;

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6 min-w-0">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.refunds.title")}</h1>
        <p className="text-owner-ink-faint text-sm">
          {list.length === 0 ? t("odash.refunds.none") : list.length === 1 ? t("odash.refunds.owed.one") : t("odash.refunds.owed.many", { n: list.length })}
        </p>
      </div>

      {filter.active && !query.isLoading && !venuesLoading ? <FilterBanner kind="refunds" count={list.length} /> : null}

      {venuesLoading || query.isLoading ? (
        <p className="p-10 text-center text-owner-ink-faint">{t("odash.refunds.loading")}</p>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
      ) : list.length === 0 ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 text-center text-owner-ink-faint">
          {t("odash.refunds.empty")}
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("odash.refunds.title")}>
          {list.map((refund) => {
            const b = refundBreakdown(refund);
            const who = refund.player_name ?? refund.player_phone ?? t("odash.refunds.player");
            const why = reasonText(t, refund);
            return (
              <li
                key={refund.id}
                data-testid="refund-row"
                className="bg-owner-surface border rounded-xl p-4 flex flex-wrap items-start justify-between gap-4"
                style={{ borderColor: refund.is_overdue ? "#DDBAB1" : undefined }}
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1 basis-56">
                  <p className="font-bold flex flex-wrap items-center gap-2">
                    <span className="truncate">{who}</span>
                    {isNaya(refund.created_at, since) ? <NayaChip /> : null}
                    <StatusChip b={b} />
                  </p>
                  <p className="text-owner-ink-muted text-[13px]">
                    {courtLabel(refund.court_name, refund.court_sport ?? sports.byName(refund.court_name, refund.venue_name))} · {fmt.when(refund.starts_at)}
                  </p>
                  {why ? <p className="text-owner-ink-faint text-[12.5px]">{why}</p> : null}
                  {refund.is_overdue ? (
                    <p className="text-[12px] font-semibold" style={{ color: DANGER }}>
                      <span aria-hidden="true">! </span>
                      {t("odash.refunds.overdue", { when: fmt.when(refund.created_at) })}
                    </p>
                  ) : null}
                  {refund.payment_id ? (
                    <div className="mt-1">
                      <ScreenshotThumb paymentId={refund.payment_id} alt={t("rfd.row.proofAlt", { who })} />
                    </div>
                  ) : null}
                  <RowLinks
                    bookingId={refund.booking_id}
                    startsAt={refund.starts_at}
                    filterDate={filter.date}
                    who={who}
                    onDetails={() => setDetailId(refund.booking_id)}
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 flex-wrap">
                  <span className="font-mono font-bold text-[15px]" data-testid="refund-remaining">
                    {t("rfd.row.remaining", { amount: formatPKR(b.remaining) })}
                    {b.alreadyRefunded > 0 ? (
                      <span className="block text-[11px] font-semibold text-owner-ink-faint">{t("rfd.row.of", { total: formatPKR(b.refundDue) })}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenId(refund.id)}
                    className="px-4 min-h-11 rounded-lg text-white font-semibold text-[13.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
                    style={{ background: TEAL }}
                  >
                    {t("odash.refunds.mark")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {detailId ? (
        <BookingDetail
          bookingId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
            void queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
          }}
        />
      ) : null}

      {open ? (
        <MarkRefundedDialog
          refund={open}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
            void queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
          }}
          onDone={async () => {
            setOpenId(null);
            await queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
          }}
        />
      ) : null}
    </div>
  );
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^pkr/i, "");
  if (cleaned === "") return NaN;
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : NaN;
}

function MarkRefundedDialog({
  refund,
  onClose,
  onSaved,
  onDone,
}: {
  refund: OwnerRefund;
  onClose: () => void;
  onSaved?: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const sports = useOwnerCourtSports();
  const b = refundBreakdown(refund);
  const [maxOwed, setMaxOwed] = useState(b.remaining);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(b.remaining > 0 ? String(b.remaining) : "");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({ amount: false, reference: false });
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; ref: string; left: number } | null>(null);
  const submitting = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const titleId = `${ids}-title`;
  const amountHintId = `${ids}-amount-hint`;
  const amountErrId = `${ids}-amount-err`;
  const refErrId = `${ids}-ref-err`;
  const refHintId = `${ids}-ref-hint`;

  const who = refund.player_name ?? refund.player_phone ?? t("odash.refunds.player");
  const court = courtLabel(refund.court_name, refund.court_sport ?? sports.byName(refund.court_name, refund.venue_name));

  const typed = parseAmount(amount);
  const amountProblem = refundAmountError(typed, maxOwed);
  const amountMessage =
    amountProblem === "exceeds"
      ? t("rfd.err.exceeds", { typed: formatPKR(typed), max: formatPKR(maxOwed) })
      : amountProblem === "not_positive"
        ? t("rfd.err.notPositive")
        : amountProblem === "empty"
          ? t("rfd.err.empty")
          : null;
  const referenceOk = isPlausibleRefundReference(reference);
  // the "more than owed" message is shown at once (it is the confusing case); the others after a touch
  const showAmountError = amountMessage !== null && (touched.amount || amountProblem === "exceeds");
  const showRefError = !referenceOk && touched.reference;
  const canSubmit = amountProblem === null && referenceOk && !busy; // aria hint only: a click still validates and explains

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting.current) onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  async function submit() {
    setTouched({ amount: true, reference: true });
    if (submitting.current || amountProblem !== null || !referenceOk) return;
    submitting.current = true;
    setBusy(true);
    setServerError(null);
    const ref = reference.trim();
    try {
      await api.owners.markRefundPaid(refund.id, ref, typed, screenshot ?? undefined, screenshot?.name, screenshot?.type || undefined);
      setDone({ amount: typed, ref, left: Math.max(0, Math.round((maxOwed - typed) * 100) / 100) });
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === "REFUND_EXCEEDS_OWED_AMOUNT") {
        const remaining = Number(e.details?.remaining);
        const typedBack = Number(e.details?.typed ?? typed);
        if (Number.isFinite(remaining)) setMaxOwed(Math.max(0, remaining));
        setServerError(
          t("rfd.err.exceeds", {
            typed: formatPKR(Number.isFinite(typedBack) ? typedBack : typed),
            max: formatPKR(Number.isFinite(remaining) ? Math.max(0, remaining) : maxOwed),
          }),
        );
      } else {
        setServerError(friendlyErrorMessage(e, t));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const row = (label: string, value: string, strong = false, testid?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-owner-border last:border-b-0">
      <dt className={strong ? "font-semibold text-owner-ink" : "text-owner-ink-muted"}>{label}</dt>
      <dd data-testid={testid} className={`font-mono text-right ${strong ? "font-bold text-[15px]" : ""}`}>{value}</dd>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="refund-dialog"
        className="bg-owner-surface rounded-t-2xl sm:rounded-xl p-5 sm:p-6 w-full sm:max-w-md flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id={titleId} className="text-lg font-bold">
            {done ? t("rfd.success.title") : b.remaining <= 0 && maxOwed <= 0 ? t("rfd.none.title") : t("rfd.dialog.title")}
          </h2>
          <p className="text-owner-ink-faint text-[13px]">{t("rfd.dialog.sub", { who, court, when: fmt.when(refund.starts_at) })}</p>
        </div>

        <section aria-label={t("rfd.breakdown.title")} className="rounded-xl border border-owner-border bg-owner-bg/40 px-4 py-2" data-testid="refund-breakdown">
          <dl className="text-[13.5px]">
            {row(t("rfd.breakdown.playerSent"), b.playerSent === null ? t("rfd.breakdown.unknown") : `PKR ${formatPKR(b.playerSent)}`, false, "bd-player-sent")}
            {row(t("rfd.breakdown.refundDue"), `PKR ${formatPKR(b.refundDue)}`, false, "bd-refund-due")}
            {row(t("rfd.breakdown.already"), `PKR ${formatPKR(b.alreadyRefunded)}`, false, "bd-already")}
            {row(t("rfd.breakdown.remaining"), `PKR ${formatPKR(done ? done.left : maxOwed)}`, true, "bd-remaining")}
          </dl>
        </section>

        <div aria-live="polite" className="contents">
          {done ? (
            <div data-testid="refund-success" className="rounded-lg border border-owner-success-soft-border bg-owner-success-soft p-3 text-[13.5px] text-owner-ink">
              <p className="font-semibold">
                <span aria-hidden="true">&#10003; </span>
                {t("rfd.success.line", { amount: formatPKR(done.amount), ref: done.ref })}
              </p>
              <p>{done.left > 0 ? t("rfd.success.remaining", { amount: formatPKR(done.left) }) : t("rfd.success.allDone")}</p>
            </div>
          ) : null}
        </div>

        {done ? (
          <button
            type="button"
            onClick={onDone}
            className="h-12 rounded-xl text-white font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
            style={{ background: TEAL }}
          >
            {t("rfd.success.ok")}
          </button>
        ) : maxOwed <= 0 ? (
          <>
            <p data-testid="refund-none" className="text-[13.5px] text-owner-ink">
              {b.refundDue > 0 ? t("rfd.none.done", { amount: formatPKR(b.refundDue) }) : t("rfd.none.zero")}
            </p>
            {serverError ? <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{serverError}</p> : null}
            <button
              type="button"
              onClick={onClose}
              className="h-12 rounded-xl border border-owner-border font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
            >
              {t("rfd.dialog.close")}
            </button>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-amount`} className="text-[13px] font-semibold text-owner-ink-muted">
                {t("rfd.amount.label")}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={firstFieldRef}
                  id={`${ids}-amount`}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setServerError(null);
                  }}
                  onBlur={() => setTouched((s) => ({ ...s, amount: true }))}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={showAmountError}
                  aria-describedby={`${amountHintId}${showAmountError ? ` ${amountErrId}` : ""}`}
                  className="h-11 min-w-0 flex-1 basis-32 px-3.5 rounded-lg border outline-none text-sm font-mono focus-visible:ring-2 focus-visible:ring-[#0E6274]"
                  style={{ borderColor: showAmountError ? DANGER : undefined }}
                  data-testid="refund-amount"
                />
                <button
                  type="button"
                  data-testid="refund-full-chip"
                  onClick={() => {
                    setAmount(String(maxOwed));
                    setServerError(null);
                  }}
                  className="min-h-11 px-3 rounded-full border border-owner-border text-[13px] font-semibold whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
                  aria-pressed={typed === maxOwed}
                >
                  {t("rfd.amount.full", { amount: formatPKR(maxOwed) })}
                </button>
              </div>
              <p id={amountHintId} className="text-[12px] text-owner-ink-faint">{t("rfd.amount.hint", { max: formatPKR(maxOwed) })}</p>
              {showAmountError ? (
                <p id={amountErrId} role="alert" data-testid="refund-amount-error" className="text-[13px] font-semibold" style={{ color: DANGER }}>
                  <span aria-hidden="true">! </span>
                  {amountMessage}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-ref`} className="text-[13px] font-semibold text-owner-ink-muted">
                {t("rfd.reference.label")}
              </label>
              <input
                id={`${ids}-ref`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, reference: true }))}
                placeholder={t("rfd.reference.ph")}
                required
                aria-required="true"
                aria-invalid={showRefError}
                aria-describedby={`${refHintId}${showRefError ? ` ${refErrId}` : ""}`}
                maxLength={80}
                className="h-11 px-3.5 rounded-lg border outline-none text-sm focus-visible:ring-2 focus-visible:ring-[#0E6274]"
                style={{ borderColor: showRefError ? DANGER : undefined }}
                data-testid="refund-reference"
              />
              <p id={refHintId} className="text-[12px] text-owner-ink-faint">{t("rfd.reference.hint")}</p>
              {showRefError ? (
                <p id={refErrId} role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>
                  <span aria-hidden="true">! </span>
                  {t("rfd.err.reference")}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-shot`} className="text-[13px] font-semibold text-owner-ink-muted">
                {t("rfd.screenshot.label")}
              </label>
              <input
                id={`${ids}-shot`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                className="text-sm min-h-11"
              />
            </div>

            {serverError ? (
              <p role="alert" data-testid="refund-server-error" className="text-[13px] font-semibold" style={{ color: DANGER }}>
                <span aria-hidden="true">! </span>
                {serverError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2.5 mt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 basis-32 h-12 rounded-xl border border-owner-border font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
              >
                {t("rfd.cancel")}
              </button>
              <button
                type="submit"
                disabled={busy}
                aria-disabled={!canSubmit}
                data-testid="refund-submit"
                className="flex-1 basis-32 h-12 rounded-xl text-white font-semibold disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
                style={{ background: TEAL }}
              >
                {busy ? t("rfd.saving") : t("rfd.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
