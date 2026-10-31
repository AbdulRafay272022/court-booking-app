"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OwnerBookingDetail, OwnerBookingRow } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { CompletionChips } from "@/components/owner/booking-table/completion-chips";
import { NoShowButton, StatusChip, StatusPendingChip, isConfirmedBooked, isStatusPending } from "@/components/owner/booking-table/status-chip";
import { useCompletionFlow, useNoShowFlow, type NoShowFlow } from "@/components/owner/completion-dialog";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { historyLinkForBooking } from "@/components/owner/history/filters";
import { ModalShell } from "@/components/owner/modal-shell";
import { ScreenshotThumb } from "@/components/media/screenshot-thumb";

/** The ONE booking detail popup used by Overview, History, Approvals and Refunds (centered dialog from 768px, bottom sheet below). */
export interface BookingDetailProps {
  /** Null = closed. */
  bookingId: string | null;
  onClose: () => void;
  /** Called after a successful change made inside the popup (completion) so the caller can refetch. */
  onChanged?: () => void;
}

export function BookingDetail({ bookingId, onClose, onChanged }: BookingDetailProps) {
  // "Original booking dekhein" can move to another booking inside the popup; it resets when the caller opens a different one.
  const [nav, setNav] = useState<{ base: string; id: string } | null>(null);
  if (!bookingId) return null;
  const id = nav && nav.base === bookingId ? nav.id : bookingId;
  return <DetailDialog key={id} bookingId={id} onClose={onClose} onChanged={onChanged} onOpenOther={(other) => setNav({ base: bookingId, id: other })} />;
}

/**
 * Round 2 (A2): every link inside the popup that leaves it closes the popup FIRST, then navigates, so the page behind never
 * re-opens it and focus/scroll lock are released before the route changes. A modified click (new tab) is left to the browser.
 */
function CloseThenGo({ href, onClose, className, testId, children }: { href: string; onClose: () => void; className: string; testId?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      data-testid={testId}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onClose();
        router.push(href);
      }}
    >
      {children}
    </Link>
  );
}

const shortCodeOf = (id: string) => `KH-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-owner-ink-muted">{children}</h3>;
}

function Row({ label, children, strong = true }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-owner-border-light py-3 last:border-b-0">
      <dt className="text-[15px] text-owner-ink-muted">{label}</dt>
      <dd className={`text-right text-[15px] text-owner-ink ${strong ? "font-bold" : ""}`}>{children}</dd>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </svg>
  );
}

function pkr(n: number) {
  return `PKR ${formatPKR(n)}`;
}

function DetailDialog({
  bookingId,
  onClose,
  onChanged,
  onOpenOther,
}: BookingDetailProps & { bookingId: string; onOpenOther: (id: string) => void }) {
  const t = useT();
  const titleId = useId();
  const query = useQuery({
    queryKey: ["owner-booking-detail", bookingId],
    queryFn: () => api.owners.bookingDetail(bookingId),
    // Always show the freshest payment/completion numbers.
    staleTime: 0,
    gcTime: 0,
  });
  const detail = query.data;
  const flow = useCompletionFlow(() => {
    void query.refetch();
    onChanged?.();
  });
  const noShow = useNoShowFlow(() => {
    void query.refetch();
    onChanged?.();
  });
  // Stage 2 (B.b): hide what a staff member may not do (the 403 messages stay as the fallback)
  const perms = useMyPermissions();
  // "Nahi aaye": the backend allows check_in OR record_payments (stage2-contract section 5).
  const allowed = { complete: perms.can("record_payments"), noShow: perms.can("check_in") || perms.can("record_payments") };

  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  async function copyId() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(bookingId);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = bookingId;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? "ok" : "fail");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2500);
  }

  const row = detail?.row;
  const code = row?.short_code ?? shortCodeOf(bookingId);

  return (
    <ModalShell labelledBy={titleId} onClose={onClose}>
      <div className="p-6 md:p-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex flex-col">
              <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-owner-ink-muted">{t("detail.title")}</span>
              <span className="font-khelo-display text-[34px] font-extrabold leading-tight tracking-tight text-owner-ink md:text-[44px]">{code}</span>
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyId}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-owner-border bg-owner-surface px-4 text-[14px] font-bold text-owner-ink"
              >
                <CopyIcon />
                {t("detail.copy")}
              </button>
              <span role="status" aria-live="polite" className={`text-[13px] font-semibold ${copied === "fail" ? "text-owner-danger" : "text-owner-success-dark"}`}>
                {copied === "ok" ? t("detail.copied") : copied === "fail" ? t("detail.copyFail") : ""}
              </span>
            </div>
            {row ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusChip statusKey={row.status_key} />
                <CompletionChips row={row} />
                {isStatusPending(row) ? <StatusPendingChip /> : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("detail.closeAria")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-owner-border text-owner-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {query.isLoading ? (
          <div role="status" aria-label={t("detail.loading")} className="mt-8 grid animate-pulse gap-8 md:grid-cols-2">
            {[0, 1].map((c) => (
              <div key={c} className="flex flex-col gap-4">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="h-5 rounded bg-owner-border-light" />
                ))}
              </div>
            ))}
          </div>
        ) : query.isError || !detail || !row ? (
          <div role="alert" className="mt-8 flex flex-col items-start gap-3 rounded-2xl bg-owner-danger-soft p-5">
            <p className="text-[15px] font-semibold text-owner-danger">{friendlyErrorMessage(query.error, t)}</p>
            <button type="button" onClick={() => query.refetch()} className="min-h-11 rounded-xl bg-owner-accent px-5 text-[14px] font-bold text-white">
              {t("common.error.retry")}
            </button>
          </div>
        ) : (
          <DetailContent detail={detail} row={row} flow={flow} noShow={noShow} allowed={allowed} onOpenOther={onOpenOther} onClose={onClose} />
        )}

        <div className="mt-8 border-t border-owner-border-light pt-5">
          <p className="text-[14px] text-owner-ink-muted">{t("detail.privacy")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {row ? (
              <CloseThenGo
                href={historyLinkForBooking(row.booking_id, row.starts_at)}
                onClose={onClose}
                testId="detail-history"
                className="inline-flex min-h-12 items-center rounded-xl border-2 border-owner-ink px-5 text-[15px] font-bold text-owner-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent"
              >
                {t("detail.history")}
              </CloseThenGo>
            ) : null}
            <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-fl-teal px-6 text-[15px] font-bold text-fl-white">
              {t("detail.close")}
            </button>
          </div>
        </div>
      </div>
      {flow.dialog}
      {noShow.dialog}
    </ModalShell>
  );
}

function DetailContent({
  detail,
  row,
  flow,
  noShow,
  allowed,
  onOpenOther,
  onClose,
}: {
  detail: OwnerBookingDetail;
  row: OwnerBookingRow;
  flow: ReturnType<typeof useCompletionFlow>;
  noShow: NoShowFlow;
  allowed: { complete: boolean; noShow: boolean };
  onOpenOther: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const dueClass = row.due > 0 ? "text-owner-danger" : "text-owner-success-dark";
  const pending = isStatusPending(row);
  const showNoShow = allowed.noShow && pending;

  return (
    <div className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="d-slot">
          <span id="d-slot">
            <SectionTitle>{t("detail.sec.slot")}</SectionTitle>
          </span>
          <dl className="mt-2">
            <Row label={t("detail.player")}>
              <span className="inline-flex items-center gap-2">
                {row.player_avatar_url ? (
                  // audit 2026-10-28 item 6: the player's photo beside the name
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.player_avatar_url} alt="" aria-hidden="true" className="h-7 w-7 rounded-full object-cover" data-testid="detail-player-photo" />
                ) : null}
                {row.player_name?.trim() || t("detail.walkinPlayer")}
              </span>
            </Row>
            <Row label={t("detail.phone")}>
              {row.player_phone ? <span className="tabular-nums">{row.player_phone}</span> : <span className="font-semibold text-owner-ink-muted">{t("detail.phoneHidden")}</span>}
            </Row>
            <Row label={t("detail.court")}>{row.court_name}</Row>
            <Row label={t("detail.slot")}>{fmt.whenRange(row.starts_at, row.ends_at)}</Row>
            <Row label={t("detail.duration")}>
              {fmt.duration(row.duration_minutes)} ({row.slot_count === 1 ? t("detail.slots.one") : t("detail.slots.many", { n: row.slot_count })})
            </Row>
            <Row label={t("detail.bookedAt")}>{fmt.when(detail.booked_at)}</Row>
            <Row label={t("detail.source")}>{fmt.bookingSource(row.source, detail.channel_detail) ?? "-"}</Row>
            {detail.hold_expires_at && row.status_key === "held" ? <Row label={t("detail.holdExpires")}>{fmt.when(detail.hold_expires_at)}</Row> : null}
          </dl>
        </section>

        <section aria-labelledby="d-money">
          <span id="d-money">
            <SectionTitle>{t("detail.sec.money")}</SectionTitle>
          </span>
          <dl className="mt-2">
            <Row label={t("detail.total")}>{pkr(row.total)}</Row>
            <Row label={t("detail.advance")}>{pkr(detail.advance_required)}</Row>
            <Row label={t("detail.paid")}>{pkr(row.total_paid)}</Row>
            <Row label={t("detail.due")}>
              <span className={dueClass}>{pkr(row.due)}</span>
            </Row>
          </dl>
        </section>

        {isConfirmedBooked(row) && (allowed.complete || showNoShow) ? (
          <section aria-labelledby="d-complete">
            <span id="d-complete">
              <SectionTitle>{t("detail.sec.completeAsk")}</SectionTitle>
            </span>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {allowed.complete ? (
              <div role="group" aria-labelledby="d-complete" className="inline-flex overflow-hidden rounded-xl border border-owner-border">
                {(["yes", "no"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={row.completion?.result === r}
                    disabled={!row.slot_ended || flow.busyId === row.booking_id}
                    onClick={() => (r === "no" || row.completion?.result !== "yes") && flow.pick(row, r)}
                    className={`min-h-11 min-w-24 px-5 text-[15px] font-bold disabled:opacity-60 ${
                      row.completion?.result === r ? (r === "yes" ? "bg-owner-success-dark text-white" : "bg-owner-danger text-white") : "bg-owner-surface text-owner-ink"
                    }`}
                  >
                    {r === "yes" ? t("hist.completed.yes") : t("hist.completed.no")}
                  </button>
                ))}
              </div>
              ) : null}
              {showNoShow ? <NoShowButton name={row.player_name?.trim() || row.short_code} onClick={() => noShow.ask(row)} /> : null}
              {!row.slot_ended ? <span className="text-[13px] text-owner-ink-muted">{t("hist.completed.early")}</span> : null}
            </div>
            {row.status_key === "no_show" && allowed.complete ? <p className="mt-2 text-[13px] text-owner-ink-muted">{t("nsw.fixHint2")}</p> : null}
            <p role="status" aria-live="polite" className={flow.message ? `mt-2 text-[13.5px] font-semibold ${flow.message.kind === "ok" ? "text-owner-success-dark" : "text-owner-danger"}` : "sr-only"}>
              {flow.message?.text}
            </p>
            <p role="status" aria-live="polite" data-testid="detail-noshow-live" className={noShow.message ? "mt-2 text-[13.5px] font-semibold text-owner-success-dark" : "sr-only"}>
              {noShow.message?.text}
            </p>
          </section>
        ) : null}

        {detail.approval && (detail.approval.verdict || detail.approval.by_name) ? (
          <section>
            <SectionTitle>{t("detail.sec.approval")}</SectionTitle>
            <dl className="mt-2">
              <Row label={t("detail.approval.verdict")}>
                {detail.approval.verdict === "rejected" ? t("detail.approval.rejected") : t("detail.approval.approved")}
                {detail.approval.auto ? ` (${t("detail.approval.auto")})` : ""}
              </Row>
              {detail.approval.by_name ? <Row label={t("detail.by")}>{detail.approval.by_name}</Row> : null}
              {detail.approval.at ? <Row label={t("detail.when")}>{fmt.when(detail.approval.at)}</Row> : null}
              {detail.approval.reason ? <Row label={t("detail.reason")} strong={false}>{detail.approval.reason}</Row> : null}
            </dl>
          </section>
        ) : null}

        {detail.cancellation ? (
          <section>
            <SectionTitle>{t("detail.sec.cancel")}</SectionTitle>
            <dl className="mt-2">
              <Row label={t("detail.by")}>{t(`detail.cancel.by.${detail.cancellation.by}` as MessageKey)}</Row>
              {detail.cancellation.at ? <Row label={t("detail.when")}>{fmt.when(detail.cancellation.at)}</Row> : null}
              {detail.cancellation.reason ? <Row label={t("detail.reason")} strong={false}>{detail.cancellation.reason}</Row> : null}
            </dl>
          </section>
        ) : null}

        {detail.refund ? (
          <section>
            <SectionTitle>{t("detail.sec.refund")}</SectionTitle>
            <dl className="mt-2">
              <Row label={t("detail.refund.amount")}>{pkr(detail.refund.amount)}</Row>
              <Row label={t("detail.refund.status")}>{detail.refund.status === "paid" ? t("detail.refund.paid") : t("detail.refund.owed")}</Row>
              {detail.refund.paid_at ? <Row label={t("detail.refund.paidAt")}>{fmt.when(detail.refund.paid_at)}</Row> : null}
              {detail.refund.reference ? <Row label={t("detail.refund.ref")}>{detail.refund.reference}</Row> : null}
            </dl>
          </section>
        ) : null}

        {detail.completion ? (
          <section>
            <SectionTitle>{t("detail.sec.completion")}</SectionTitle>
            <dl className="mt-2">
              <Row label={t("detail.completion.result")}>{detail.completion.result === "yes" ? t("hist.chip.complete") : t("hist.chip.short")}</Row>
              <Row label={t("detail.completion.received")}>{pkr(detail.completion.received_pkr)}</Row>
              {detail.completion.marked_by_name ? <Row label={t("detail.by")}>{detail.completion.marked_by_name}</Row> : null}
              <Row label={t("detail.when")}>{fmt.when(detail.completion.marked_at)}</Row>
              {detail.completion.reason ? <Row label={t("detail.reason")} strong={false}>{detail.completion.reason}</Row> : null}
            </dl>
          </section>
        ) : null}

        {row.kind !== "booked" && row.original_booking_id ? (
          <div>
            {row.original_booking_id !== row.booking_id ? (
              <button
                type="button"
                onClick={() => onOpenOther(row.original_booking_id as string)}
                className="inline-flex min-h-11 items-center rounded-xl bg-owner-border-light px-4 text-[14px] font-bold text-owner-ink"
              >
                {t("hist.row.original")}
              </button>
            ) : (
              <CloseThenGo
                href={historyLinkForBooking(row.booking_id, row.starts_at)}
                onClose={onClose}
                testId="detail-original"
                className="inline-flex min-h-11 items-center rounded-xl bg-owner-border-light px-4 text-[14px] font-bold text-owner-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent"
              >
                {t("hist.row.original")}
              </CloseThenGo>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <ScreenshotBox detail={detail} />
        <section aria-labelledby="d-timeline">
          <span id="d-timeline">
            <SectionTitle>{t("detail.sec.timeline")}</SectionTitle>
          </span>
          {detail.timeline.length === 0 ? (
            <p className="mt-3 text-[14px] text-owner-ink-muted">{t("detail.timeline.empty")}</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-4">
              {detail.timeline.map((ev, i) => {
                const key = `detail.tl.${ev.kind}` as MessageKey;
                const translated = t(key);
                const label = translated === key ? t("detail.tl.other") : translated;
                const time = ev.kind === "slot_started" ? fmt.timeRange(row.starts_at, row.ends_at) : fmt.time(ev.at);
                const subParts = [ev.actor_name, ev.amount != null ? pkr(ev.amount) : null, ev.note].filter(Boolean);
                const dot =
                  ev.kind === "completion_marked"
                    ? "bg-fl-amber"
                    : ev.kind === "slot_started" || ev.kind === "slot_ended"
                      ? "bg-owner-ink-fainter"
                      : ["cancelled", "rejected", "no_show", "expired"].includes(ev.kind)
                        ? "bg-owner-danger"
                        : "bg-fl-teal";
                return (
                  <li key={`${ev.kind}-${ev.at}-${i}`} className="flex gap-3">
                    <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0">
                      <p className="text-[15px] text-owner-ink">
                        <b>{time}</b> {"·"} {label}
                      </p>
                      {subParts.length ? <p className="text-[13.5px] text-owner-ink-muted">{subParts.join(" · ")}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

/** The payment screenshot: the shared thumbnail (opens the zoomable Lightbox) plus the OCR amount chip. */
function ScreenshotBox({ detail }: { detail: OwnerBookingDetail }) {
  const t = useT();
  const ocr = detail.ocr_verdict;
  const ocrText =
    ocr === "match"
      ? detail.ocr_amount != null
        ? t("detail.ocr.match", { amount: pkr(detail.ocr_amount) })
        : t("detail.ocr.matchNoAmount")
      : ocr === "mismatch"
        ? detail.ocr_amount != null
          ? t("detail.ocr.mismatch", { amount: pkr(detail.ocr_amount) })
          : t("detail.ocr.mismatchNoAmount")
        : ocr === "unreadable"
          ? t("detail.ocr.unreadable")
          : null;
  const ocrTone = ocr === "match" ? "bg-owner-success-soft text-owner-success-dark" : "bg-owner-warn-soft text-owner-warn-dark";

  return (
    <section aria-labelledby="d-shot">
      <span id="d-shot">
        <SectionTitle>{t("detail.sec.shot")}</SectionTitle>
      </span>
      {detail.payment_id ? (
        <div className="mt-3">
          <ScreenshotThumb paymentId={detail.payment_id} alt={t("detail.shot.alt")} />
        </div>
      ) : (
        <div className="mt-3 flex min-h-[6rem] w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-owner-border bg-owner-bg px-4 text-center text-[15px] text-owner-ink-muted">
          <ShotIcon />
          <span>{t("detail.shot.none")}</span>
        </div>
      )}
      {ocrText ? (
        <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-bold ${ocrTone}`}>
          <span aria-hidden="true">{ocr === "match" ? "\u2713" : "!"}</span>
          {ocrText}
        </p>
      ) : null}
    </section>
  );
}

function ShotIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
