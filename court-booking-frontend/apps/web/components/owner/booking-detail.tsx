"use client";

import Link from "next/link";
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
import { StatusChip, isConfirmedBooked } from "@/components/owner/booking-table/status-chip";
import { useCompletionFlow } from "@/components/owner/completion-dialog";
import { historyLinkForBooking } from "@/components/owner/history/filters";
import { ModalShell } from "@/components/owner/modal-shell";

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
          <DetailContent detail={detail} row={row} flow={flow} onOpenOther={onOpenOther} />
        )}

        <div className="mt-8 border-t border-owner-border-light pt-5">
          <p className="text-[14px] text-owner-ink-muted">{t("detail.privacy")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {row ? (
              <Link
                href={historyLinkForBooking(row.booking_id, row.starts_at)}
                className="inline-flex min-h-12 items-center rounded-xl border-2 border-owner-ink px-5 text-[15px] font-bold text-owner-ink"
              >
                {t("detail.history")}
              </Link>
            ) : null}
            <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-khelo-orange px-6 text-[15px] font-bold text-khelo-ink">
              {t("detail.close")}
            </button>
          </div>
        </div>
      </div>
      {flow.dialog}
    </ModalShell>
  );
}

function DetailContent({
  detail,
  row,
  flow,
  onOpenOther,
}: {
  detail: OwnerBookingDetail;
  row: OwnerBookingRow;
  flow: ReturnType<typeof useCompletionFlow>;
  onOpenOther: (id: string) => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const dueClass = row.due > 0 ? "text-owner-danger" : "text-owner-success-dark";

  return (
    <div className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="d-slot">
          <span id="d-slot">
            <SectionTitle>{t("detail.sec.slot")}</SectionTitle>
          </span>
          <dl className="mt-2">
            <Row label={t("detail.player")}>{row.player_name?.trim() || t("detail.walkinPlayer")}</Row>
            <Row label={t("detail.phone")}>
              {row.player_phone ? <span className="tabular-nums">{row.player_phone}</span> : <span className="font-semibold text-owner-ink-muted">{t("detail.phoneHidden")}</span>}
            </Row>
            <Row label={t("detail.court")}>{row.court_name}</Row>
            <Row label={t("detail.slot")}>{fmt.whenRange(row.starts_at, row.ends_at)}</Row>
            <Row label={t("detail.duration")}>
              {fmt.duration(row.duration_minutes)} ({row.slot_count === 1 ? t("detail.slots.one") : t("detail.slots.many", { n: row.slot_count })})
            </Row>
            <Row label={t("detail.bookedAt")}>{fmt.when(detail.booked_at)}</Row>
            <Row label={t("detail.source")}>{fmt.bookingSource(row.source) ?? "-"}</Row>
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

        {isConfirmedBooked(row) ? (
          <section aria-labelledby="d-complete">
            <span id="d-complete">
              <SectionTitle>{t("detail.sec.completeAsk")}</SectionTitle>
            </span>
            <div className="mt-3 flex flex-wrap items-center gap-3">
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
              {!row.slot_ended ? <span className="text-[13px] text-owner-ink-muted">{t("hist.completed.early")}</span> : null}
            </div>
            <p role="status" aria-live="polite" className={flow.message ? `mt-2 text-[13.5px] font-semibold ${flow.message.kind === "ok" ? "text-owner-success-dark" : "text-owner-danger"}` : "sr-only"}>
              {flow.message?.text}
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
              <Link
                href={historyLinkForBooking(row.booking_id, row.starts_at)}
                className="inline-flex min-h-11 items-center rounded-xl bg-owner-border-light px-4 text-[14px] font-bold text-owner-ink"
              >
                {t("hist.row.original")}
              </Link>
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
                    ? "bg-khelo-orange"
                    : ev.kind === "slot_started" || ev.kind === "slot_ended"
                      ? "bg-owner-ink-fainter"
                      : ["cancelled", "rejected", "no_show", "expired"].includes(ev.kind)
                        ? "bg-owner-danger"
                        : "bg-khelo-teal";
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

/** The payment screenshot: nothing is fetched until it is asked for, the signed URL lives only in this component while the viewer is open. */
function ScreenshotBox({ detail }: { detail: OwnerBookingDetail }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const hasShot = !!detail.payment_id;

  async function open() {
    if (!detail.payment_id) return;
    setState("loading");
    try {
      const res = await api.payments.proofUrl(detail.payment_id);
      setUrl(res.url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

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
      {hasShot ? (
        <button
          type="button"
          onClick={open}
          disabled={state === "loading"}
          className="mt-3 flex min-h-[10rem] w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-owner-border bg-owner-bg px-4 text-center text-[15px] text-owner-ink-muted md:min-h-[13rem]"
        >
          <ShotIcon />
          <span>{state === "loading" ? t("detail.shot.loading") : t("detail.shot.open")}</span>
        </button>
      ) : (
        <div className="mt-3 flex min-h-[10rem] w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-owner-border bg-owner-bg px-4 text-center text-[15px] text-owner-ink-muted md:min-h-[13rem]">
          <ShotIcon />
          <span>{t("detail.shot.none")}</span>
        </div>
      )}
      <p role="alert" className={state === "error" ? "mt-2 text-[13.5px] font-semibold text-owner-danger" : "sr-only"}>
        {state === "error" ? t("detail.shot.error") : ""}
      </p>
      {ocrText ? <p className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-[13.5px] font-bold ${ocrTone}`}>{ocrText}</p> : null}
      {url ? <Lightbox url={url} onClose={() => setUrl(null)} /> : null}
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

const ZOOMS = [1, 1.5, 2, 3];

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useT();
  const [zoom, setZoom] = useState(0);
  const [failed, setFailed] = useState(false);
  const btn = "flex h-11 min-w-11 items-center justify-center rounded-xl bg-owner-surface px-3 text-[18px] font-bold text-owner-ink";
  return (
    <ModalShell label={t("detail.shot.viewer")} onClose={onClose} fullscreen>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-2 p-3">
          <button type="button" className={btn} aria-label={t("detail.shot.zoomOut")} disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            -
          </button>
          <button type="button" className={btn} aria-label={t("detail.shot.zoomIn")} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
            +
          </button>
          <button type="button" className={`${btn} text-[14px]`} onClick={onClose}>
            {t("detail.shot.closeViewer")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3" tabIndex={0} aria-label={t("detail.shot.scroll")}>
          {failed ? (
            <p role="alert" className="mx-auto max-w-sm rounded-xl bg-owner-surface p-4 text-center text-[14px] font-semibold text-owner-danger">
              {t("detail.shot.error")}
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable static asset
            <img
              src={url}
              alt={t("detail.shot.alt")}
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              style={{ width: `${ZOOMS[zoom] * 100}%`, maxWidth: zoom === 0 ? "100%" : "none" }}
              className="mx-auto h-auto max-h-none select-none rounded-lg bg-white"
            />
          )}
        </div>
      </div>
    </ModalShell>
  );
}
