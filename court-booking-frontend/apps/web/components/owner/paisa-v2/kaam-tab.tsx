"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { moneyStatusKey, taskKey, type PaisaDueItem, type PaisaKey, type PaisaTaskGroup, type PaisaTaskKey } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { useAuthStore } from "@/lib/auth-store";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { parseQueueFilter } from "@/lib/queue-filter";
import { useSearchParams } from "next/navigation";
import { BookingDetail } from "@/components/owner/booking-detail";
import { DueDoneDialog, NoShowReverseDialog, type ReverseTarget } from "@/components/owner/money-dialogs";
import { RefundsTab } from "@/components/owner/paisa/refunds-tab";
import { BankTab } from "@/components/owner/paisa/bank-tab";
import { pkrText } from "@/lib/paisa-v2";
import { usePaisaT } from "@/lib/use-paisa-v2";
import { refreshPaisa } from "./booking-sheet";
import { ErrorText, GroupLabel, PrimaryButton } from "./ui";

function dueStatusKey(d: PaisaDueItem): PaisaKey {
  if (d.owner_decision === "collect") return "due.collect";
  return `due.${d.status}` as PaisaKey;
}

/** Kaam (contract 5.6 / 6.1): every money task in one list, in the contract's group order. */
export function KaamTab({ venueId, focus, onOpenBooking }: { venueId?: string; focus: PaisaTaskKey | null; onOpenBooking: (id: string) => void }) {
  const t = useT();
  const pt = usePaisaT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const perms = useMyPermissions();
  const isOwner = useAuthStore((s) => s.user?.role) !== "staff";
  const filter = parseQueueFilter(useSearchParams());
  const q = useQuery({
    queryKey: ["paisa", "tasks", venueId, filter.date ?? null, filter.courtIds.join(",")],
    queryFn: () => api.paisa.tasks(venueId, { date: filter.date, courtIds: filter.courtIds }),
    enabled: !!venueId,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reverse, setReverse] = useState<ReverseTarget | null>(null);
  const [doneFor, setDoneFor] = useState<PaisaDueItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (!focus || !q.data) return;
    document.getElementById(`kaam-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, q.data]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refreshPaisa(qc);
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function openReverse(bookingId: string, label: string, replyId: string | null) {
    setError(null);
    try {
      const d = await api.paisa.booking(bookingId, venueId);
      setReverse({ bookingId, label, total: d.final_if_noshow_undone, paid: d.calc.received, replyId: replyId ?? undefined });
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    }
  }

  if (q.isError) return <ErrorText text={friendlyErrorMessage(q.error, t)} />;
  if (!q.data) return <p className="py-6 text-center text-owner-ink-faint">{pt("paisa.loading")}</p>;
  const groups = q.data.groups;

  const card = "flex flex-col gap-2 rounded-xl border border-owner-border bg-owner-surface p-4";
  const render = (g: PaisaTaskGroup) => {
    switch (g.key) {
      case "short_decide":
      case "due_collect":
        return g.items.map((d) => (
          <div key={d.id} className={card} data-testid={`kaam-${g.key}-item`}>
            <button type="button" onClick={() => onOpenBooking(d.booking_id)} className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-left">
              <span className="font-bold">{`${d.player_name ?? pt("paisa.detail.player")} · ${d.code}${d.starts_at ? ` · ${fmt.dateRelative(d.starts_at)}` : ""}`}</span>
              <span className="text-[16px] font-extrabold tabular-nums">{pkrText(d.due_pkr)}</span>
            </button>
            <span className="text-[13px] text-owner-ink-muted">{pt(dueStatusKey(d))}</span>
            {d.player_reason ? <span className="text-[13.5px]">{pt("paisa.detail.playerSays", { reason: d.player_reason })}</span> : null}
            <div className="flex flex-wrap gap-2">
              {g.key === "short_decide" && isOwner ? (
                <>
                  <PrimaryButton label={pt("paisa.act.collect")} tone="ghost" busy={busy === `c${d.id}`} onClick={() => void run(`c${d.id}`, () => api.phase3.decideShort(d.id, "collect"))} />
                  <PrimaryButton label={pt("paisa.act.waive")} tone="ghost" busy={busy === `w${d.id}`} onClick={() => void run(`w${d.id}`, () => api.phase3.decideShort(d.id, "waive"))} />
                </>
              ) : null}
              {g.key === "due_collect" && perms.can("record_payments") ? <PrimaryButton label={pt("paisa.players.take")} onClick={() => setDoneFor(d)} /> : null}
            </div>
          </div>
        ));
      case "noshow_reply":
        return g.items.map((n) => (
          <div key={n.booking_id} className={card} data-testid="kaam-noshow-item">
            <button type="button" onClick={() => onOpenBooking(n.booking_id)} className="cursor-pointer text-left font-bold">
              {[n.player_name, n.court_name, n.starts_at ? fmt.when(n.starts_at) : null].filter(Boolean).join(" · ")}
            </button>
            {n.highlight ? <span className="text-[13px] font-bold text-owner-danger">{pt("paisa.kaam.gps")}</span> : null}
            <span className="text-[13.5px]">{`${pt("paisa.kaam.playerCame")}${n.player_note ? `: "${n.player_note}"` : ""}`}</span>
            {isOwner && n.reply_id ? (
              <div className="flex flex-wrap gap-2">
                <PrimaryButton label={pt("paisa.act.playerRight")} onClick={() => void openReverse(n.booking_id, `${n.player_name ?? ""} · ${n.court_name ?? ""}`, n.reply_id)} />
                <PrimaryButton label={pt("paisa.act.keepNoshow")} tone="ghost" busy={busy === `k${n.reply_id}`} onClick={() => void run(`k${n.reply_id}`, () => api.phase3.decideNoShow(n.reply_id as string, "keep"))} />
              </div>
            ) : null}
          </div>
        ));
      case "refund_due":
        return <RefundsTab v2={{}} />;
      case "refund_not_got":
        return g.count ? <RefundsTab v2={{ notGotOnly: true }} /> : null;
      case "bank_check":
        return (
          <>
            {g.items.map((m) => (
              <div key={m.entry_id} className={`${card} border-l-4 border-l-owner-danger`} data-testid="kaam-bank-item">
                <span className="text-[14px] font-semibold">
                  {pt("paisa.kaam.bankLine", { code: m.code, player: m.player_name ?? pt("paisa.detail.player"), amount: pkrText(m.amount_pkr), by: m.approved_by_name ?? "?" })}
                </span>
                {isOwner ? (
                  <div className="flex flex-wrap gap-2">
                    <PrimaryButton label={pt("paisa.act.staffPays")} tone="ghost" busy={busy === `s${m.entry_id}`} onClick={() => void run(`s${m.entry_id}`, () => api.owners.bankMissingDecide(m.entry_id, "staff"))} />
                    <PrimaryButton label={pt("paisa.act.playerPays")} tone="ghost" busy={busy === `p${m.entry_id}`} onClick={() => void run(`p${m.entry_id}`, () => api.owners.bankMissingDecide(m.entry_id, "player"))} />
                  </div>
                ) : null}
              </div>
            ))}
            <BankTab bare />
          </>
        );
      case "screenshots":
        return (
          <div className={`${card} flex-row flex-wrap items-center justify-between`}>
            <span className="text-[14px] font-semibold">{pt("paisa.kaam.screenshotsLine", { n: g.count })}</span>
            <Link href="/dashboard/owner/approvals" className="inline-flex min-h-11 items-center rounded-xl border border-owner-border px-4 text-[14px] font-bold">
              {pt("paisa.act.openApprovals")}
            </Link>
          </div>
        );
      case "attendance":
        return g.items.map((r) => (
          <button key={r.booking_id} type="button" onClick={() => setDetailId(r.booking_id)} className={`${card} cursor-pointer text-left`} data-testid="kaam-attendance-item">
            <span className="font-bold">{r.player}</span>
            <span className="text-[13px] text-owner-ink-muted">{`${fmt.when(r.starts_at)} · ${r.court} · ${r.short_code} · ${pt(moneyStatusKey(r.money_status))}`}</span>
          </button>
        ));
    }
  };

  const total = groups.reduce((s, g) => s + (g.key === "screenshots" ? 0 : g.count), 0);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="paisa-kaam">
      <ErrorText text={error} />
      {total === 0 && !groups.some((g) => g.key === "screenshots" && g.count) ? (
        <p className="rounded-xl border border-owner-border bg-owner-surface py-8 text-center text-owner-ink-faint">{pt("paisa.empty.kaam")}</p>
      ) : null}
      {groups.map((g) => (
        <section key={g.key} id={`kaam-${g.key}`} className={`flex scroll-mt-6 flex-col gap-2 ${focus === g.key ? "rounded-2xl ring-2 ring-owner-accent p-2" : ""}`} data-testid={`kaam-group-${g.key}`}>
          <GroupLabel
            label={pt(taskKey(g.key))}
            count={g.count}
            right={
              g.key === "refund_due" && g.count ? (
                <span className="text-[12.5px] font-semibold text-owner-ink-muted">{pt("paisa.kaam.refundHeader", { amount: pkrText(g.total), days: g.oldest_days })}</span>
              ) : null
            }
          />
          {g.count === 0 && g.key !== "bank_check" ? <p className="px-1 text-[13px] text-owner-ink-faint">{pt("paisa.empty.group")}</p> : render(g)}
        </section>
      ))}

      {reverse ? (
        <NoShowReverseDialog
          target={reverse}
          onClose={() => setReverse(null)}
          onDone={() => {
            setReverse(null);
            void refreshPaisa(qc);
          }}
        />
      ) : null}
      {doneFor ? (
        <DueDoneDialog
          claimId={doneFor.id}
          due={doneFor.due_pkr}
          label={`${doneFor.player_name ?? ""} · ${doneFor.code}`}
          onClose={() => setDoneFor(null)}
          onDone={() => {
            setDoneFor(null);
            void refreshPaisa(qc);
          }}
        />
      ) : null}
      {detailId ? <BookingDetail bookingId={detailId} onClose={() => setDetailId(null)} onChanged={() => void refreshPaisa(qc)} /> : null}
    </div>
  );
}
