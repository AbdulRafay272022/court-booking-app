"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import { deductionKey, moneyStatusKey, moneyStatusTone, type CancelPreview, type PaisaBookingDetail, type PaisaHistoryItem, type PaisaKey } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { useAuthStore } from "@/lib/auth-store";
import { Pill, Sheet } from "@/components/fl";
import { NoShowReverseDialog } from "@/components/owner/money-dialogs";
import { RecordPaymentSheet } from "@/components/owner/record-payment-sheet";
import { paisaV2Href, parseRupees, pkrText, signedPkr } from "@/lib/paisa-v2";
import { usePaisaNote, usePaisaT, type PaisaTFn } from "@/lib/use-paisa-v2";
import { Choice, ErrorText, MoneyLine, PrimaryButton, TextField } from "./ui";

/** Every Paisa query starts with "paisa"; one invalidation refreshes the page after any money change. */
export async function refreshPaisa(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["paisa"] }),
    qc.invalidateQueries({ queryKey: ["owner-refunds"] }),
    qc.invalidateQueries({ queryKey: ["owner-badges"] }),
    qc.invalidateQueries({ queryKey: ["bank-check"] }),
    qc.invalidateQueries({ queryKey: ["owner-dues"] }),
  ]);
}

type Sub =
  | { kind: "record" }
  | { kind: "adjust"; adj: "waived" | "price_reduced"; max: number }
  | { kind: "reverse"; item: PaisaHistoryItem }
  | { kind: "credit" }
  | { kind: "cancel" }
  | { kind: "noshow" }
  | null;

function historyLabel(pt: PaisaTFn, h: PaisaHistoryItem): string {
  if (h.type === "adjustment") return pt(deductionKey(h.kind));
  return pt(`paisa.h.${h.bucket === "correction" || h.kind === "correction" ? "correction" : h.kind}` as PaisaKey);
}

/** The booking's money in one sheet (contract 5.3 / 6.1): calculation, dispute, history and the actions the server allows. */
export function PaisaBookingSheet({ bookingId, venueId, onClose }: { bookingId: string; venueId?: string; onClose: () => void }) {
  const t = useT();
  const pt = usePaisaT();
  const pnote = usePaisaNote();
  const fmt = useFmt();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isOwner = role !== "staff";
  const q = useQuery({ queryKey: ["paisa", "booking", bookingId, venueId], queryFn: () => api.paisa.booking(bookingId, venueId) });
  const [sub, setSub] = useState<Sub>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = q.data;

  async function after() {
    setSub(null);
    await refreshPaisa(qc);
  }

  async function decide(decision: "collect" | "waive") {
    if (!d?.dispute) return;
    setBusy(true);
    setError(null);
    try {
      await api.phase3.decideShort(d.dispute.claim_id, decision);
      await after();
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  const b = d?.booking;
  const has = (a: string) => !!d?.actions.includes(a as never);
  const reversible = d ? d.history.filter((h) => h.reversible) : [];

  return (
    <>
      <Sheet open onClose={onClose} title={b ? b.player : pt("paisa.loading")} subtitle={b ? `${fmt.when(b.starts_at)} · ${b.court} · ${b.short_code}` : undefined} data-testid="paisa-booking-sheet">
        {q.isError ? <ErrorText text={friendlyErrorMessage(q.error, t)} /> : null}
        {!d || !b ? null : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={pt(moneyStatusKey(b.money_status))} tone={moneyStatusTone(b.money_status)} size="sm" data-testid="paisa-sheet-status" />
              {b.phone ? <span className="text-[13px] text-owner-ink-muted tabular-nums">{b.phone}</span> : null}
            </div>

            <section aria-label={pt("paisa.detail.calc")} className="rounded-xl bg-owner-bg p-2" data-testid="paisa-sheet-calc">
              <MoneyLine label={pt("paisa.st.bookingAmount")} value={pkrText(d.calc.booking_amount)} />
              {d.calc.deductions.map((x) => (
                <MoneyLine key={x.id} label={`− ${pt(deductionKey(x.kind))}`} sub={pnote(x.reason) ?? undefined} value={signedPkr(-x.amount)} />
              ))}
              <MoneyLine label={`= ${pt("paisa.st.final")}`} value={pkrText(d.calc.final)} strong />
              <MoneyLine label={pt("paisa.st.received")} value={pkrText(d.calc.received)} />
              {d.calc.refunds ? <MoneyLine label={pt("paisa.in.refunds")} value={signedPkr(-d.calc.refunds)} /> : null}
              {d.calc.credit_in ? <MoneyLine label={pt("paisa.h.credit_in")} value={pkrText(d.calc.credit_in)} /> : null}
              {d.calc.credit_out ? <MoneyLine label={pt("paisa.h.credit_out")} value={signedPkr(-d.calc.credit_out)} /> : null}
              {d.calc.waivers.map((w) => (
                <MoneyLine key={w.id} label={`+ ${pt("paisa.st.waived")}`} sub={pnote(w.reason) ?? undefined} value={pkrText(w.amount)} />
              ))}
              {d.calc.due > 0 ? (
                <MoneyLine label={pt("paisa.detail.result.due")} value={pkrText(d.calc.due)} strong tone="warn" testId="paisa-sheet-result" />
              ) : d.calc.due_at_slot > 0 ? (
                <MoneyLine label={pt("paisa.detail.result.dueAtSlot")} value={pkrText(d.calc.due_at_slot)} strong tone="warn" testId="paisa-sheet-result" />
              ) : d.calc.refund_due > 0 ? (
                <MoneyLine label={pt("paisa.detail.result.refund")} value={pkrText(d.calc.refund_due)} strong tone="danger" testId="paisa-sheet-result" />
              ) : (
                <MoneyLine label={pt("paisa.detail.result.settled")} value={pkrText(0)} strong tone="open" testId="paisa-sheet-result" />
              )}
            </section>

            {d.dispute?.player_reason ? (
              <p className="rounded-xl border border-owner-border px-3 py-2 text-[14px]">{pt("paisa.detail.playerSays", { reason: d.dispute.player_reason })}</p>
            ) : null}
            {d.pending_screenshots.map((p) => (
              <Link key={p.payment_id} href="/dashboard/owner/approvals" className="rounded-xl border border-owner-warn-soft-border bg-owner-warn-soft px-3 py-2 text-[14px] font-semibold text-owner-ink">
                {pt("paisa.detail.pendingShot", { amount: pkrText(p.amount) })}
              </Link>
            ))}
            {d.credit_available > 0 ? <p className="text-[13.5px] text-owner-ink-muted">{pt("paisa.detail.credit", { amount: pkrText(d.credit_available) })}</p> : null}

            <ErrorText text={error} />
            <div className="flex flex-wrap gap-2" data-testid="paisa-sheet-actions">
              {has("record_payment") ? <PrimaryButton label={pt("paisa.act.record")} onClick={() => setSub({ kind: "record" })} testId="paisa-act-record" /> : null}
              {has("collect") ? <PrimaryButton label={pt("paisa.act.collect")} tone="ghost" busy={busy} onClick={() => void decide("collect")} /> : null}
              {has("collect") && has("waive") ? (
                <PrimaryButton label={pt("paisa.act.waive")} tone="ghost" busy={busy} onClick={() => void decide("waive")} />
              ) : has("waive") ? (
                <PrimaryButton label={pt("paisa.act.waive")} tone="ghost" onClick={() => setSub({ kind: "adjust", adj: "waived", max: d.calc.due })} testId="paisa-act-waive" />
              ) : null}
              {has("refund") ? (
                <Link href={paisaV2Href("kaam", "refund_due")} onClick={onClose} className="inline-flex min-h-11 items-center rounded-xl border border-owner-border px-4 text-[14px] font-bold text-owner-ink">
                  {pt("paisa.act.refund")}
                </Link>
              ) : null}
              {has("use_credit") ? <PrimaryButton label={pt("paisa.act.useCredit")} tone="ghost" onClick={() => setSub({ kind: "credit" })} /> : null}
              {has("reverse_noshow") ? <PrimaryButton label={pt("paisa.act.reverseNoshow")} tone="ghost" onClick={() => setSub({ kind: "noshow" })} /> : null}
              {has("reduce_price") || reversible.length || has("cancel") ? (
                <PrimaryButton label={`${pt("paisa.detail.more")} ⋯`} tone="ghost" onClick={() => setMore((v) => !v)} testId="paisa-act-more" />
              ) : null}
            </div>
            {more ? (
              <div className="flex flex-col gap-1 rounded-xl border border-owner-border p-1" role="menu" data-testid="paisa-more-menu">
                {has("reduce_price") ? (
                  <MenuItem label={pt("paisa.act.reduce")} onClick={() => setSub({ kind: "adjust", adj: "price_reduced", max: d.calc.final })} />
                ) : null}
                {reversible.map((h) => (
                  <MenuItem
                    key={h.id}
                    danger
                    label={`${h.type === "entry" ? pt("paisa.act.fix") : pt("paisa.act.undo")} · ${historyLabel(pt, h)} ${pkrText(h.amount)}`}
                    onClick={() => setSub({ kind: "reverse", item: h })}
                  />
                ))}
                {has("cancel") ? <MenuItem danger label={pt("paisa.act.cancel")} onClick={() => setSub({ kind: "cancel" })} /> : null}
              </div>
            ) : null}

            <section aria-label={pt("paisa.detail.history")} className="flex flex-col gap-2" data-testid="paisa-sheet-history">
              <h3 className="text-[13px] font-extrabold tracking-wide text-owner-ink-muted">{pt("paisa.detail.history")}</h3>
              <ol className="flex flex-col gap-2">
                {d.history.map((h) => (
                  <li key={`${h.type}-${h.id}`} className="flex items-start justify-between gap-3 border-l-2 border-owner-border pl-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[14px] font-semibold text-owner-ink">{historyLabel(pt, h)}</span>
                      <span className="text-[12.5px] text-owner-ink-muted">
                        {[fmt.when(h.at), h.by ? pt("paisa.h.by", { by: h.by }) : null, pnote(h.note)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={`shrink-0 tabular-nums text-[14px] font-bold ${h.amount < 0 ? "text-owner-danger" : "text-owner-ink"}`}>{signedPkr(h.amount)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Sheet>

      {d && b && sub?.kind === "record" ? (
        <RecordPaymentSheet bookingId={b.booking_id} playerLabel={b.player} owed={d.owed} isOwner={isOwner} onClose={() => setSub(null)} onDone={() => void after()} />
      ) : null}
      {d && b && sub?.kind === "adjust" ? <AdjustSheet detail={d} adj={sub.adj} max={sub.max} venueId={venueId} onClose={() => setSub(null)} onDone={() => void after()} /> : null}
      {d && sub?.kind === "reverse" ? <ReverseSheet item={sub.item} venueId={venueId} onClose={() => setSub(null)} onDone={() => void after()} /> : null}
      {d && b && sub?.kind === "credit" ? <UseCreditSheet detail={d} venueId={venueId} onClose={() => setSub(null)} onDone={() => void after()} /> : null}
      {d && b && sub?.kind === "cancel" ? <CancelSheet detail={d} isOwner={isOwner} onClose={() => setSub(null)} onDone={() => void after()} /> : null}
      {d && b && sub?.kind === "noshow" ? (
        <NoShowReverseDialog
          target={{ bookingId: b.booking_id, label: `${b.player} · ${b.short_code}`, total: d.final_if_noshow_undone, paid: d.calc.received }}
          onClose={() => setSub(null)}
          onDone={() => void after()}
        />
      ) : null}
    </>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-owner-bg ${danger ? "text-owner-danger" : "text-owner-ink"}`}>
      {label}
    </button>
  );
}

/** "Raqam kam karein" / "Maaf karein" (owner only): an adjustment with a reason, never a price edit. */
function AdjustSheet({ detail, adj, max, venueId, onClose, onDone }: { detail: PaisaBookingDetail; adj: "waived" | "price_reduced"; max: number; venueId?: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const pt = usePaisaT();
  const [amount, setAmount] = useState(String(max));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = parseRupees(amount);
  const tooMuch = Number.isFinite(typed) && typed > max;
  const ready = Number.isFinite(typed) && typed > 0 && !tooMuch && reason.trim() !== "";
  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.paisa.addAdjustment(detail.booking.booking_id, { kind: adj, amount_pkr: typed, reason: reason.trim() }, venueId);
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={pt(adj === "waived" ? "paisa.adj.waiveTitle" : "paisa.adj.reduceTitle")} subtitle={`${detail.booking.player} · ${detail.booking.short_code}`} data-testid="paisa-adjust-sheet">
      <TextField label={pt("paisa.rec.amount")} value={amount} onChange={setAmount} inputMode="numeric" error={tooMuch ? pt("paisa.adj.max", { amount: pkrText(max) }) : null} autoFocus />
      <TextField label={pt("paisa.adj.reason")} value={reason} onChange={setReason} testId="paisa-adjust-reason" />
      <ErrorText text={error} />
      <PrimaryButton label={pt("paisa.act.save")} onClick={save} disabled={!ready} busy={busy} testId="paisa-adjust-save" />
    </Sheet>
  );
}

/** "Ghalti theek karein" (a payment) / "Wapas lein" (an adjustment), owner only: a reversal with a reason. */
export function ReverseSheet({ item, venueId, onClose, onDone }: { item: { id: string; type: "entry" | "adjustment"; amount: number; kind: string }; venueId?: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const pt = usePaisaT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (item.type === "entry") await api.payments.reverseEntry(item.id, reason.trim());
      else await api.paisa.reverseAdjustment(item.id, reason.trim(), venueId);
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={pt(item.type === "entry" ? "paisa.act.fix" : "paisa.adj.undoTitle")} subtitle={pkrText(item.amount)} data-testid="paisa-reverse-sheet">
      <TextField label={pt("paisa.adj.reason")} value={reason} onChange={setReason} testId="paisa-reverse-reason" autoFocus />
      <ErrorText text={error} />
      <PrimaryButton label={pt("paisa.act.save")} tone="danger" onClick={save} disabled={!reason.trim()} busy={busy} testId="paisa-reverse-save" />
    </Sheet>
  );
}

function UseCreditSheet({ detail, venueId, onClose, onDone }: { detail: PaisaBookingDetail; venueId?: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const pt = usePaisaT();
  const max = Math.min(detail.credit_available, detail.owed);
  const [amount, setAmount] = useState(String(max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = parseRupees(amount);
  const ok = Number.isFinite(typed) && typed > 0 && typed <= max;
  async function save() {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.paisa.useCredit(detail.booking.booking_id, typed, venueId);
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={pt("paisa.act.useCredit")} subtitle={pt("paisa.detail.credit", { amount: pkrText(detail.credit_available) })}>
      <TextField label={pt("paisa.rec.amount")} value={amount} onChange={setAmount} inputMode="numeric" error={Number.isFinite(typed) && typed > max ? pt("paisa.adj.max", { amount: pkrText(max) }) : null} autoFocus />
      <ErrorText text={error} />
      <PrimaryButton label={pt("paisa.act.save")} onClick={save} disabled={!ok} busy={busy} />
    </Sheet>
  );
}

/** Owner / staff cancel (contract 2.3, founder 13 Nov): who asked decides the money; the preview says it in plain words. */
function CancelSheet({ detail, isOwner, onClose, onDone }: { detail: PaisaBookingDetail; isOwner: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const pt = usePaisaT();
  void isOwner;
  const id = detail.booking.booking_id;
  const [who, setWho] = useState<"player" | "venue" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["paisa", "cancel-preview", id, who], queryFn: () => api.bookings.cancelPreview(id, who ?? undefined), enabled: !!who });
  const p: CancelPreview | undefined = preview.data;
  const text = !p ? null : p.mode === "refund" ? pt("paisa.cancel.refundAll", { amount: pkrText(p.refund_pkr) }) : p.mode === "keep" ? pt("paisa.cancel.keep", { amount: pkrText(p.keep_pkr) }) : pt("paisa.cancel.clear");
  async function confirm() {
    if (!who || !p) return;
    setBusy(true);
    setError(null);
    try {
      await api.bookings.cancel(id, undefined, { cancelledFor: who, acceptKeepAdvance: p.mode === "keep" });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? friendlyErrorMessage(e, t) : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={pt("paisa.cancel.title")} subtitle={`${detail.booking.player} · ${detail.booking.short_code}`} data-testid="paisa-cancel-sheet">
      <Choice<"player" | "venue">
        label={pt("paisa.cancel.who")}
        value={who}
        onChange={setWho}
        testId="paisa-cancel-who"
        options={[
          { value: "player", label: pt("paisa.cancel.player") },
          { value: "venue", label: pt("paisa.cancel.venue") },
        ]}
      />
      {text ? (
        <p data-testid="paisa-cancel-preview" className={`rounded-xl px-3 py-3 text-[14px] font-semibold ${p?.mode === "keep" ? "bg-owner-warn-soft text-owner-ink" : "bg-owner-bg text-owner-ink"}`}>
          {text}
        </p>
      ) : null}
      <ErrorText text={error} />
      <PrimaryButton label={pt("paisa.cancel.confirm")} tone="danger" onClick={confirm} disabled={!who || !p} busy={busy} testId="paisa-cancel-confirm" />
    </Sheet>
  );
}
