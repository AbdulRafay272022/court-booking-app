"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import { approvalsHeaderCounts, type ApprovalQueueItem, type ApprovalState, type ApproveAcceptMode } from "@court-booking/types";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useOwnerCourtSports } from "@/lib/court-sports";
import { courtLabel } from "@/components/court-label";
import { BookingDetail } from "@/components/owner/booking-detail";
import { ModalShell } from "@/components/owner/modal-shell";
import { FilterBanner, NayaChip } from "@/components/owner/queue-extras";
import { historyLinkForBooking } from "@/components/owner/history/filters";
import { ScreenshotThumb } from "@/components/media/screenshot-thumb";
import { VoiceTextarea } from "@/components/voice/voice-textarea";
import { parseQueueFilter } from "@/lib/queue-filter";
import { isNaya } from "@/lib/owner-seen";
import { useSeenSince } from "@/lib/use-owner-seen";
import {
  PAGE_SIZE,
  amountChip,
  approveArgs,
  defaultApproveAmount,
  hasMore,
  isClosedState,
  mergePages,
  overpaymentChoice,
  parseAmount,
  rejectReasonText,
  stateFrom409,
  visibleIds,
} from "./queue-helpers";

// The English value is what is sent to the backend (and shown to the player); only the label on the button is translated.
const REJECT_REASONS: { value: string; label: MessageKey }[] = [
  { value: "Amount doesn't match", label: "odash.approvals.reason.amount" },
  { value: "Screenshot unreadable", label: "odash.approvals.reason.unreadable" },
  { value: "Looks like a duplicate", label: "odash.approvals.reason.duplicate" },
  { value: "Other", label: "odash.approvals.reason.other" },
];

type Dialog = { kind: "approve" | "reject"; item: ApprovalQueueItem } | null;
type Live = { kind: "ok" | "error"; text: string } | null;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent";

/**
 * Approvals (Round 2, A1 + A5): every payment waiting for review as a list, newest first. Acting on a card removes only that card
 * (optimistically, restored on error); polling every 15 s updates cards in place and never reorders the list while a dialog is open.
 * A card whose booking the player cancelled (or that expired) turns grey with "Theek hai" instead of Approve / Reject.
 */
export default function OwnerApprovalsPage() {
  const t = useT();
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  // The Overview's Pending card links here with ?date= and ?courts= (same names on every page); "Sab dikhao" clears them.
  const filter = parseQueueFilter(useSearchParams());
  const since = useSeenSince("approvals", activeVenueId);

  const query = useInfiniteQuery({
    queryKey: ["owner-approvals-queue", activeVenueId, filter.date ?? null, filter.courtIds.join(",")],
    queryFn: ({ pageParam }) => api.owners.approvalsQueue({ venueId: activeVenueId, date: filter.date, courtIds: filter.courtIds, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (hasMore(all.reduce((n, p) => n + p.items.length, 0), last.total) ? last.page + 1 : undefined),
    enabled: !!activeVenueId,
    refetchInterval: (q) => pollInterval(q, 15_000),
  });

  const serverItems = mergePages(query.data?.pages);
  const byId = new Map(serverItems.map((i) => [i.payment_id, i]));
  const serverIds = serverItems.map((i) => i.payment_id);
  const total = query.data?.pages[0]?.total ?? 0;

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, ApprovalState>>({});
  const [snapshot, setSnapshot] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [live, setLive] = useState<Live>(null);
  // A staff member without the approve permission gets 403 NOT_STAFF_PERMITTED (the client cannot know the permissions in
  // advance: no endpoint returns them to staff). After the first refusal the action buttons are replaced by a clear note.
  const [noPermission, setNoPermission] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const shown = visibleIds(serverIds, snapshot, hidden);
  // The badge number (left) = payments waiting for approval (awaiting) + grey cards that only need "Theek hai" (closed).
  const { left, awaiting, closed } = approvalsHeaderCounts(total, serverItems, hidden, overrides);

  function openDialog(next: Dialog) {
    setSnapshot(shown);
    setDialog(next);
  }
  function closeDialog() {
    setDialog(null);
    setSnapshot(null);
  }

  function hide(id: string, on: boolean) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** After a card leaves, keyboard focus goes to the next card (or the previous one, or the heading). */
  function moveFocusFrom(id: string) {
    const i = shown.indexOf(id);
    const target = shown[i + 1] ?? shown[i - 1];
    requestAnimationFrame(() => {
      const el = target ? document.querySelector<HTMLElement>(`[data-card-id="${target}"]`) : null;
      (el ?? headingRef.current)?.focus();
    });
  }

  function refreshRelated() {
    void queryClient.invalidateQueries({ queryKey: ["owner-approvals-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-today"] });
  }

  async function act(item: ApprovalQueueItem, run: () => Promise<unknown>, okText: string, after?: (res: unknown) => void) {
    const id = item.payment_id;
    const who = item.player_name ?? t("appr.player");
    moveFocusFrom(id);
    hide(id, true);
    try {
      const res = await run();
      setLive({ kind: "ok", text: okText });
      after?.(res);
      refreshRelated();
    } catch (e) {
      hide(id, false);
      if (e instanceof ApiError && e.code === "BOOKING_NO_LONGER_PENDING") {
        // The player cancelled (or the hold expired) in the meantime: the card turns grey in place, no error text.
        setOverrides((o) => ({ ...o, [id]: stateFrom409(e.details) }));
        setLive({ kind: "ok", text: t("appr.live.nowClosed", { who }) });
        refreshRelated();
      } else if (e instanceof ApiError && e.code === "NOT_STAFF_PERMITTED") {
        setNoPermission(true);
        setLive({ kind: "error", text: t("appr.live.noPermission") });
      } else {
        setLive({ kind: "error", text: t("appr.live.failed", { who, error: friendlyErrorMessage(e, t) }) });
      }
    }
  }

  function approve(item: ApprovalQueueItem, amount: number | null, mode: ApproveAcceptMode) {
    closeDialog();
    const { amountPkr, acceptMode } = approveArgs(item, amount, mode);
    const who = item.player_name ?? t("appr.player");
    void act(item, () => api.payments.approve(item.payment_id, amountPkr, acceptMode), t("appr.live.approved", { who }), () => {
      if (acceptMode === "advance_only") void queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
    });
  }

  function reject(item: ApprovalQueueItem, reason: string) {
    closeDialog();
    const who = item.player_name ?? t("appr.player");
    void act(item, () => api.payments.reject(item.payment_id, reason), t("appr.live.rejected", { who }));
  }

  function acknowledge(item: ApprovalQueueItem, moneyReceived: boolean) {
    const who = item.player_name ?? t("appr.player");
    void act(item, () => api.owners.acknowledgeCancelled(item.payment_id, moneyReceived), moneyReceived ? t("appr.live.ackRefund", { who }) : t("appr.live.ack", { who }), () => {
      if (moneyReceived) void queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
    });
  }

  const loading = venuesLoading || query.isLoading;
  const countText = awaiting === 0 ? t("appr.count.none") : awaiting === 1 ? t("appr.count.one") : t("appr.count.many", { n: awaiting });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-8">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="font-khelo-display text-[30px] font-extrabold leading-tight text-owner-ink outline-none md:text-[36px]">
          {t("appr.title")}
        </h1>
        <p data-testid="appr-count" className="text-[15px] font-semibold text-owner-ink-muted">
          {loading ? "\u00a0" : countText}
          {!loading && closed > 0 ? (
            <span data-testid="appr-count-closed" className="font-medium">
              {" "}
              {t("appr.count.closed", { m: closed })}
            </span>
          ) : null}
        </p>
      </div>

      {filter.active && !loading ? <FilterBanner kind="approvals" count={left} /> : null}

      <p
        role="status"
        aria-live="polite"
        data-testid="appr-live"
        className={live ? `rounded-xl px-4 py-3 text-[14px] font-semibold ${live.kind === "error" ? "bg-owner-danger-soft text-owner-danger" : "bg-owner-success-soft text-owner-success-dark"}` : "sr-only"}
      >
        {live ? (
          <>
            <span aria-hidden="true">{live.kind === "error" ? "! " : "\u2713 "}</span>
            {live.text}
          </>
        ) : null}
      </p>

      {loading ? (
        <p role="status" className="p-10 text-center text-owner-ink-faint">
          {t("appr.loading")}
        </p>
      ) : query.isError && serverItems.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-owner-border bg-owner-surface p-10 text-center text-owner-ink-faint">{t("appr.empty")}</div>
      ) : (
        <ul aria-label={t("appr.list")} className="flex flex-col gap-4" style={{ overflowAnchor: "auto" }}>
          {shown.map((id) => {
            const item = byId.get(id)!;
            const state = overrides[id] ?? item.state;
            return (
              <li key={id}>
                {isClosedState(state) ? (
                  <ClosedCard item={item} state={state} locked={noPermission} onAck={(money) => acknowledge(item, money)} />
                ) : (
                  <AwaitingCard
                    item={item}
                    naya={isNaya(item.submitted_at, since)}
                    locked={noPermission}
                    onDetails={() => setDetailId(item.booking_id)}
                    onApprove={() => openDialog({ kind: "approve", item })}
                    onReject={() => openDialog({ kind: "reject", item })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && query.hasNextPage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="appr-more"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className={`min-h-11 rounded-xl border-2 border-owner-ink px-5 text-[14.5px] font-bold text-owner-ink disabled:opacity-60 ${focusRing}`}
          >
            {query.isFetchingNextPage ? t("appr.moreLoading") : t("appr.more")}
          </button>
          <span className="text-[13.5px] text-owner-ink-muted">{t("appr.shown", { shown: shown.length, total: left })}</span>
        </div>
      ) : null}

      {dialog?.kind === "approve" ? <ApproveDialog item={dialog.item} onCancel={closeDialog} onConfirm={(amount, mode) => approve(dialog.item, amount, mode)} /> : null}
      {dialog?.kind === "reject" ? <RejectDialog item={dialog.item} onCancel={closeDialog} onConfirm={(reason) => reject(dialog.item, reason)} /> : null}

      <BookingDetail
        bookingId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["owner-approvals-queue"] });
          void queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
        }}
      />
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-owner-accent font-semibold text-white">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function useCardText(item: ApprovalQueueItem) {
  const t = useT();
  const fmt = useFmt();
  const sports = useOwnerCourtSports();
  const who = item.player_name ?? t("appr.player");
  const court = courtLabel(item.court_name, item.court_sport ?? sports.byName(item.court_name));
  const when = `${fmt.dateRelative(item.starts_at)}, ${fmt.timeRange(item.starts_at, item.ends_at)}`;
  return { who, court, when, sent: fmt.relative(item.submitted_at) };
}

function AmountChips({ item }: { item: ApprovalQueueItem }) {
  const t = useT();
  const chip = amountChip(item);
  const tone =
    chip.kind === "match"
      ? "border-owner-success-soft-border bg-owner-success-soft text-owner-success-dark"
      : chip.kind === "mismatch"
        ? "border-owner-danger-soft-border bg-owner-danger-soft text-owner-danger"
        : "border-owner-border bg-owner-bg text-owner-ink-muted";
  const icon = chip.kind === "match" ? "\u2713" : chip.kind === "mismatch" ? "!" : "?";
  const text =
    chip.kind === "match"
      ? t("appr.amt.match", { amount: formatPKR(chip.amount) })
      : chip.kind === "mismatch"
        ? t("appr.amt.mismatch", { read: formatPKR(chip.read), expected: formatPKR(chip.expected) })
        : t("appr.amt.unread", { expected: formatPKR(chip.expected) });
  return (
    <div className="flex flex-wrap gap-2">
      <span data-testid="amount-chip" data-kind={chip.kind} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-bold ${tone}`}>
        <span aria-hidden="true" className="font-extrabold">
          {icon}
        </span>
        {text}
      </span>
      {item.overpayment ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-owner-warn-soft-border bg-owner-warn-soft px-3 py-1 text-[13px] font-bold text-owner-warn-dark">
          <span aria-hidden="true">+</span>
          {t("appr.amt.over", { excess: formatPKR(item.overpayment.excess) })}
        </span>
      ) : null}
    </div>
  );
}

function Shot({ item, who }: { item: ApprovalQueueItem; who: string }) {
  const t = useT();
  if (!item.has_screenshot && !item.proof_url) {
    return <p className="text-[13.5px] text-owner-ink-muted">{t("appr.noShot")}</p>;
  }
  return <ScreenshotThumb paymentId={item.payment_id} alt={t("appr.shotAlt", { who })} initialSrc={item.proof_url} />;
}

function NoPermissionNote() {
  const t = useT();
  return (
    <p data-testid="appr-no-permission" className="flex gap-2 rounded-xl border border-owner-border bg-owner-bg px-4 py-3 text-[14px] font-semibold text-owner-ink">
      <span aria-hidden="true" className="font-extrabold">
        !
      </span>
      {t("appr.noPermission")}
    </p>
  );
}

function AwaitingCard({
  item,
  naya,
  locked,
  onDetails,
  onApprove,
  onReject,
}: {
  item: ApprovalQueueItem;
  naya: boolean;
  locked: boolean;
  onDetails: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const t = useT();
  const nameId = useId();
  const { who, court, when, sent } = useCardText(item);
  const checks = item.checks ? [item.checks.name, item.checks.amount, item.checks.time, item.checks.bank, item.checks.duplicate].filter(Boolean) : [];
  return (
    <article
      data-card-id={item.payment_id}
      data-state="awaiting"
      tabIndex={-1}
      aria-labelledby={nameId}
      className={`flex flex-col gap-4 rounded-2xl border border-owner-border bg-owner-surface p-4 shadow-sm outline-none md:p-5 ${focusRing}`}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-start gap-3">
            <Avatar name={who} />
            <div className="min-w-0 flex-1">
              <h2 id={nameId} className="break-words text-[16.5px] font-bold text-owner-ink">
                {who}
              </h2>
              {item.player_phone ? <p className="font-mono text-[12.5px] text-owner-ink-muted">{item.player_phone}</p> : null}
            </div>
            {naya ? <NayaChip /> : null}
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[14px] text-owner-ink-muted">{court}</p>
            <p data-testid="card-when" className="text-[15.5px] font-bold text-owner-ink">
              {when}
            </p>
            <p className="text-[12.5px] text-owner-ink-faint">{t("appr.sent", { when: sent })}</p>
          </div>
          <AmountChips item={item} />
        </div>
        <div className="min-w-0">
          <Shot item={item} who={who} />
        </div>
      </div>

      {checks.length ? (
        <details className="rounded-xl border border-owner-border-light px-3">
          <summary className={`flex min-h-11 cursor-pointer items-center text-[13.5px] font-bold text-owner-ink ${focusRing}`}>{t("appr.checks")}</summary>
          <ul className="flex flex-col gap-2 pb-3">
            {checks.map((c, i) => (
              <CheckRow key={i} check={c} />
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="row-details"
          aria-label={t("appr.detailsAria", { who })}
          onClick={onDetails}
          className={`min-h-11 rounded-lg border border-owner-border bg-owner-surface px-4 text-[13.5px] font-semibold text-owner-ink ${focusRing}`}
        >
          {t("appr.details")}
        </button>
        <Link
          href={historyLinkForBooking(item.booking_id, item.starts_at)}
          data-testid="row-history"
          className={`inline-flex min-h-11 items-center rounded-lg px-2 text-[13.5px] font-semibold text-owner-accent underline underline-offset-2 ${focusRing}`}
        >
          {t("appr.history")}
        </Link>
      </div>

      {locked ? (
        <NoPermissionNote />
      ) : (
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            data-testid="approve"
            aria-label={t("appr.approveAria", { who })}
            onClick={onApprove}
            className={`min-h-12 flex-1 basis-40 rounded-xl bg-owner-success px-4 text-[15px] font-bold text-white ${focusRing}`}
          >
            {t("appr.approve")}
          </button>
          <button
            type="button"
            data-testid="reject"
            aria-label={t("appr.rejectAria", { who })}
            onClick={onReject}
            className={`min-h-12 flex-1 basis-32 rounded-xl border border-owner-danger-soft-border md:flex-none px-4 text-[15px] font-bold text-owner-danger ${focusRing}`}
          >
            {t("appr.reject")}
          </button>
        </div>
      )}
    </article>
  );
}

function ClosedCard({ item, state, locked, onAck }: { item: ApprovalQueueItem; state: ApprovalState; locked: boolean; onAck: (moneyReceived: boolean) => void }) {
  const t = useT();
  const fmt = useFmt();
  const nameId = useId();
  const { who, court, when } = useCardText(item);
  const label = t(`appr.state.${state}` as MessageKey);
  const btn = `min-h-12 rounded-xl px-4 text-[14.5px] font-bold ${focusRing}`;
  return (
    <article
      data-card-id={item.payment_id}
      data-state={state}
      tabIndex={-1}
      aria-labelledby={nameId}
      className={`flex flex-col gap-3 rounded-2xl border border-dashed border-owner-ink-fainter bg-owner-bg p-4 outline-none md:p-5 ${focusRing}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={nameId} className="break-words text-[16px] font-bold text-owner-ink-muted">
            {who}
          </h2>
          <p className="text-[14px] text-owner-ink-muted">{court}</p>
          <p className="text-[14.5px] font-semibold text-owner-ink-muted line-through decoration-1">{when}</p>
        </div>
        <span data-testid="closed-chip" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-owner-border bg-owner-surface px-3 py-1 text-[13px] font-bold text-owner-ink">
          {state === "expired" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9 9l6 6M15 9l-6 6" />
            </svg>
          )}
          {label}
        </span>
      </div>
      <p className="text-[14px] text-owner-ink">{t("appr.closed.text")}</p>
      {item.cancelled_at ? <p className="text-[13px] text-owner-ink-muted">{t("appr.closed.when", { when: fmt.when(item.cancelled_at) })}</p> : null}
      {locked ? (
        <>
          {item.has_screenshot ? <Shot item={item} who={who} /> : null}
          <NoPermissionNote />
        </>
      ) : item.has_screenshot ? (
        <>
          <Shot item={item} who={who} />
          <p className="text-[14px] font-bold text-owner-ink">{t("appr.closed.ask")}</p>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" data-testid="ack-no" onClick={() => onAck(false)} className={`${btn} flex-1 basis-48 border-2 border-owner-ink bg-owner-surface text-owner-ink`}>
              {t("appr.ack.no")}
            </button>
            <button type="button" data-testid="ack-yes" onClick={() => onAck(true)} className={`${btn} flex-1 basis-48 bg-khelo-orange text-khelo-ink`}>
              {t("appr.ack.yes")}
            </button>
          </div>
        </>
      ) : (
        <div>
          <button type="button" data-testid="ack-ok" onClick={() => onAck(false)} className={`${btn} min-w-32 bg-owner-accent text-white`}>
            {t("appr.ack.ok")}
          </button>
        </div>
      )}
    </article>
  );
}

/** Section 32 Part 7: tick / warning / cross for the plain-language checks; the dot never carries meaning alone (the text does). */
const CHECK_COLORS: Record<string, string> = {
  match: "#1F7A52",
  mismatch: "#A8432C",
  warning: "#B8860B",
  not_available: "#8399A1",
  not_configured: "#8399A1",
};
const CHECK_ICONS: Record<string, string> = { match: "\u2713", mismatch: "\u2715", warning: "!" };

function CheckRow({ check }: { check: { verdict: string; text: string } }) {
  const color = CHECK_COLORS[check.verdict] ?? "#8399A1";
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-center text-[13px] font-extrabold" style={{ color }}>
        {CHECK_ICONS[check.verdict] ?? "\u2013"}
      </span>
      <span className="flex-1 text-[13px] leading-[18px] text-owner-ink">{check.text}</span>
    </li>
  );
}

function DialogSummary({ item }: { item: ApprovalQueueItem }) {
  const { who, court, when } = useCardText(item);
  return (
    <div className="rounded-xl bg-owner-bg px-4 py-3 text-[14px]">
      <p className="font-bold text-owner-ink">{who}</p>
      <p className="text-owner-ink-muted">
        {court} {"\u00b7"} {when}
      </p>
    </div>
  );
}

function ApproveDialog({ item, onCancel, onConfirm }: { item: ApprovalQueueItem; onCancel: () => void; onConfirm: (amount: number | null, mode: ApproveAcceptMode) => void }) {
  const t = useT();
  const fmt = useFmt();
  const titleId = useId();
  const [text, setText] = useState(String(defaultApproveAmount(item)));
  const [mode, setMode] = useState<ApproveAcceptMode>("advance_only");
  const [touched, setTouched] = useState(false);
  const amount = parseAmount(text);
  const needsAmount = !!item.checks || !!item.overpayment;
  const invalid = needsAmount && amount === null;
  const choice = overpaymentChoice(item, amount);
  const summary = item.checks && amount !== null ? fmt.approvalSummary(item.checks, amount) : null;

  const summaryText = summary
    ? summary.status === "paid_in_full"
      ? t("odash.approvals.sum.paid_in_full")
      : t(summary.status === "overpaid" ? "odash.approvals.sum.overpaid" : "odash.approvals.sum.underpaid", {
          amount: `PKR ${formatPKR(Math.abs((amount ?? 0) - (item.checks?.expected_amount ?? 0)))}`,
        })
    : "";

  return (
    <ModalShell labelledBy={titleId} onClose={onCancel} maxWidthClass="md:max-w-[560px]">
      <form
        className="flex flex-col gap-4 p-5 md:p-7"
        data-testid="approve-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (invalid) return;
          onConfirm(amount, mode);
        }}
      >
        <h2 id={titleId} className="font-khelo-display text-[24px] font-extrabold text-owner-ink">
          {t("appr.dlg.approveTitle")}
        </h2>
        <DialogSummary item={item} />
        {needsAmount ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${titleId}-amt`} className="text-[14px] font-bold text-owner-ink">
              {t("appr.dlg.amount")}
            </label>
            <input
              id={`${titleId}-amt`}
              inputMode="numeric"
              autoComplete="off"
              value={text}
              aria-invalid={touched && invalid}
              aria-describedby={`${titleId}-amt-help`}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              className="min-h-11 rounded-xl border border-owner-border px-3.5 font-mono text-[15px] text-owner-ink"
            />
            <p id={`${titleId}-amt-help`} className="text-[12.5px] text-owner-ink-muted">
              {t("appr.dlg.amountHelp")}
            </p>
            {touched && invalid ? (
              <p role="alert" className="text-[13px] font-semibold text-owner-danger">
                {t("appr.dlg.amountErr")}
              </p>
            ) : null}
            {summary ? (
              <div className="flex flex-col gap-1">
                <p className={`text-[14px] font-bold ${summary.status === "paid_in_full" ? "text-owner-success-dark" : summary.status === "overpaid" ? "text-owner-warn-dark" : "text-owner-danger"}`}>
                  {summaryText}
                </p>
                <p className="font-mono text-[12.5px] text-owner-ink-muted">
                  {t("odash.approvals.totals", { total: formatPKR(summary.totalAfter + summary.balanceAfter), paid: formatPKR(summary.totalAfter), balance: formatPKR(summary.balanceAfter) })}
                </p>
                {summary.excess > 0 && !choice ? <p className="text-[12.5px] text-owner-warn-dark">{t("odash.approvals.excess", { amount: formatPKR(summary.excess) })}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {choice ? (
          <div className="flex flex-col gap-3" data-testid="overpay">
            <p role="note" className="flex gap-2 rounded-xl border border-owner-warn-soft-border bg-owner-warn-soft px-4 py-3 text-[14px] font-semibold text-owner-warn-dark">
              <span aria-hidden="true" className="font-extrabold">
                !
              </span>
              {t("appr.over.banner", { paid: formatPKR(choice.paid), expected: formatPKR(choice.expected), excess: formatPKR(choice.excess) })}
            </p>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[14px] font-bold text-owner-ink">{t("appr.over.question")}</legend>
              {(["advance_only", "full"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border-2 px-3.5 py-2.5 ${mode === m ? "border-owner-accent bg-owner-accent-soft" : "border-owner-border"}`}
                >
                  <input type="radio" name={`${titleId}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 h-4 w-4 shrink-0 accent-owner-accent" />
                  <span className="flex flex-col">
                    <span className="text-[14.5px] font-bold text-owner-ink">
                      {m === "advance_only"
                        ? t("appr.over.advance", { expected: formatPKR(choice.expected), excess: formatPKR(choice.excess) })
                        : t("appr.over.full", { paid: formatPKR(choice.paid) })}
                    </span>
                    <span className="text-[12.5px] text-owner-ink-muted">{m === "advance_only" ? t("appr.over.advanceHint") : t("appr.over.fullHint")}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button type="button" onClick={onCancel} className={`min-h-12 flex-1 basis-28 rounded-xl border border-owner-border px-4 font-semibold text-owner-ink ${focusRing}`}>
            {t("appr.dlg.back")}
          </button>
          <button type="submit" data-testid="approve-confirm" className={`min-h-12 flex-1 basis-40 rounded-xl bg-owner-success px-4 font-bold text-white ${focusRing}`}>
            {t("appr.dlg.confirmApprove")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function RejectDialog({ item, onCancel, onConfirm }: { item: ApprovalQueueItem; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const t = useT();
  const titleId = useId();
  const [preset, setPreset] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const noteRequired = preset === "Other";
  return (
    <ModalShell labelledBy={titleId} onClose={onCancel} maxWidthClass="md:max-w-[560px]">
      <form
        className="flex flex-col gap-4 p-5 md:p-7"
        data-testid="reject-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const reason = rejectReasonText(preset, note);
          if (!reason) {
            setError(true);
            return;
          }
          onConfirm(reason);
        }}
      >
        <h2 id={titleId} className="font-khelo-display text-[24px] font-extrabold text-owner-ink">
          {t("appr.dlg.rejectTitle")}
        </h2>
        <DialogSummary item={item} />
        <fieldset>
          <legend className="mb-2 text-[14px] font-bold text-owner-ink">{t("appr.dlg.rejectWhy")}</legend>
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={preset === r.value}
                onClick={() => {
                  setPreset(r.value);
                  setError(false);
                }}
                className={`min-h-11 rounded-lg border px-3.5 text-[13.5px] font-semibold ${focusRing} ${
                  preset === r.value ? "border-owner-danger bg-owner-danger text-white" : "border-owner-border bg-owner-bg text-owner-ink"
                }`}
              >
                {preset === r.value ? <span aria-hidden="true">{"\u2713 "}</span> : null}
                {t(r.label)}
              </button>
            ))}
          </div>
        </fieldset>
        <VoiceTextarea
          id={`${titleId}-note`}
          label={noteRequired ? t("appr.dlg.noteRequired") : t("appr.dlg.note")}
          value={note}
          onChange={(v) => {
            setNote(v);
            setError(false);
          }}
          required={noteRequired}
          rows={3}
          maxLength={300}
        />
        {error ? (
          <p role="alert" className="text-[13px] font-semibold text-owner-danger">
            {t("appr.dlg.reasonErr")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2.5 pt-1">
          <button type="button" onClick={onCancel} className={`min-h-12 flex-1 basis-28 rounded-xl border border-owner-border px-4 font-semibold text-owner-ink ${focusRing}`}>
            {t("appr.dlg.back")}
          </button>
          <button type="submit" data-testid="reject-confirm" className={`min-h-12 flex-1 basis-40 rounded-xl bg-owner-danger px-4 font-bold text-white ${focusRing}`}>
            {t("appr.dlg.confirmReject")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
