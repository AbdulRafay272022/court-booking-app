import { useRef, useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deductionKey, type CancelPreview, type PaisaBookingDetail, type PaisaHistoryItem, type PaisaKey } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, Input, MoneyRows, Pill, Skeleton, Text, type MoneyRow } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { invalidateOwnerMoney } from "@/lib/owner-cache";
import { parseAmount } from "@/lib/paisa-mobile";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { KeyValue, KeyValueBlock } from "@/app/(owner)/_fl";
import { BottomSheet, OutlineButton, PrimaryButton } from "@/components/overview/ui";
import { NoShowReverseSheet } from "@/components/money-sheets";
import { Choice, MoneyStatusPill, moneyError, pf, pkr, usePT, type PT } from "./kit";
import { PaisaRecordSheet } from "./record-sheet";

export const PAISA_KEYS = ["paisa-summary", "paisa-bookings", "paisa-booking", "paisa-daybook", "paisa-players", "paisa-tasks"] as const;

export async function invalidatePaisa(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([...PAISA_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })), invalidateOwnerMoney(qc)]);
}

type Follow =
  | { kind: "record" }
  | { kind: "adjust"; adj: "price_reduced" | "waived"; max: number }
  | { kind: "reverseEntry"; id: string; amount: number }
  | { kind: "undoAdj"; id: string; amount: number }
  | { kind: "useCredit"; max: number }
  | { kind: "noshow" }
  | { kind: "cancel" };

function historyLabel(h: PaisaHistoryItem, t: PT): string {
  if (h.type === "adjustment") {
    const base = t(deductionKey(h.kind));
    return h.reverses ? `${t("paisa.act.undo")}: ${base}` : base;
  }
  return t(`paisa.h.${h.kind}` as PaisaKey);
}

/** The ledger v2 booking sheet (contract 6.2): ID, pills, player / phone / slot, the calculation and its result, dispute
 * message, main actions, History, "Paisa darj karein" + "Aur" (owner-only corrections). Follow-up sheets are SIBLINGS that
 * mount once this one has animated out (two stacked @gorhom modals dismiss each other on Expo web). */
export function PaisaBookingSheet({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const t = usePT();
  const qc = useQueryClient();
  const { activeVenueId } = useOwnerVenues();
  const isStaff = useAuthStore((s) => s.user?.role) === "staff";
  const q = useQuery({
    queryKey: ["paisa-booking", bookingId],
    queryFn: () => api.paisa.booking(bookingId, activeVenueId),
    placeholderData: undefined,
  });
  const d = q.data;
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollowState] = useState<Follow | null>(null);
  const followRef = useRef<Follow | null>(null);
  const setFollow = (f: Follow | null) => {
    followRef.current = f;
    setFollowState(f);
  };
  const [followShown, setFollowShown] = useState(false);
  const saved = useRef(false);
  const onSaved = () => {
    saved.current = true;
    void invalidatePaisa(qc);
  };
  const endFollow = () => {
    setFollow(null);
    if (saved.current) {
      saved.current = false;
      void q.refetch();
    }
    setFollowShown(false);
  };

  async function decide(decision: "collect" | "waive") {
    if (!d?.dispute) return;
    setBusy(decision);
    setError(null);
    try {
      await api.phase3.decideShort(d.dispute.claim_id, decision);
      await invalidatePaisa(qc);
      await q.refetch();
    } catch (e) {
      setError(moneyError(e, t));
    } finally {
      setBusy(null);
    }
  }

  const sub = d ? `${d.booking.player} · ${d.booking.short_code}` : "";

  return (
    <>
      {followShown ? null : (
        <BottomSheet
          open={follow === null}
          eyebrow="Booking ID"
          title={d ? d.booking.short_code : "Booking"}
          onClose={() => (followRef.current ? setFollowShown(true) : onClose())}
          testID="paisa-booking-sheet"
        >
          {q.isLoading || !d ? (
            q.isError ? (
              <Banner tone="danger" body={moneyError(q.error, t)} />
            ) : (
              <View style={{ gap: space[3] }} accessibilityLabel={t("paisa.loading")}>
                <Skeleton height={44} r={radius.md} />
                <Skeleton height={180} r={18} />
              </View>
            )
          ) : (
            <Detail d={d} t={t} more={more} isStaff={isStaff} busy={busy} error={error}
              onMore={() => setMore((v) => !v)}
              onDecide={decide}
              onFollow={setFollow}
            />
          )}
        </BottomSheet>
      )}
      {d && followShown && follow?.kind === "record" ? (
        <PaisaRecordSheet bookingId={bookingId} subtitle={sub} owed={d.owed} onClose={endFollow} onSaved={() => { onSaved(); endFollow(); }} />
      ) : null}
      {d && followShown && follow?.kind === "adjust" ? (
        <AdjustSheet bookingId={bookingId} kind={follow.adj} max={follow.max} subtitle={sub} onClose={endFollow} onSaved={() => { onSaved(); endFollow(); }} />
      ) : null}
      {d && followShown && (follow?.kind === "reverseEntry" || follow?.kind === "undoAdj") ? (
        <ReasonSheet
          title={follow.kind === "reverseEntry" ? t("paisa.act.fix") : t("paisa.adj.undoTitle")}
          subtitle={`${sub} · ${pkr(follow.amount)}`}
          onClose={endFollow}
          onSubmit={async (reason) => {
            if (follow.kind === "reverseEntry") await api.payments.reverseEntry(follow.id, reason);
            else await api.paisa.reverseAdjustment(follow.id, reason, activeVenueId);
            onSaved();
            endFollow();
          }}
        />
      ) : null}
      {d && followShown && follow?.kind === "useCredit" ? (
        <AmountSheet
          title={t("paisa.act.useCredit")}
          subtitle={sub}
          max={follow.max}
          onClose={endFollow}
          onSubmit={async (amount) => {
            await api.paisa.useCredit(bookingId, amount, activeVenueId);
            onSaved();
            endFollow();
          }}
        />
      ) : null}
      {d && followShown && follow?.kind === "noshow" ? (
        <NoShowReverseSheet
          target={{ bookingId, subtitle: sub, total: d.final_if_noshow_undone, paid: d.calc.received }}
          onClose={endFollow}
          onSaved={() => { onSaved(); endFollow(); }}
        />
      ) : null}
      {d && followShown && follow?.kind === "cancel" ? (
        <CancelSheet bookingId={bookingId} subtitle={sub} ownerSide onClose={endFollow} onSaved={() => { onSaved(); endFollow(); }} />
      ) : null}
    </>
  );
}

function Detail({ d, t, more, isStaff, busy, error, onMore, onDecide, onFollow }: {
  d: PaisaBookingDetail; t: PT; more: boolean; isStaff: boolean; busy: string | null; error: string | null;
  onMore: () => void; onDecide: (d: "collect" | "waive") => void; onFollow: (f: Follow) => void;
}) {
  const b = d.booking;
  const c = d.calc;
  const can = (a: string) => d.actions.includes(a as never);
  const rows: MoneyRow[] = [{ label: t("paisa.st.bookingAmount"), value: pkr(c.booking_amount) }];
  for (const x of c.deductions) rows.push({ label: `− ${t(deductionKey(x.kind))}`, value: pkr(-x.amount), note: pf.note(x.reason) ?? undefined });
  rows.push({ label: `= ${t("paisa.st.final")}`, value: pkr(c.final), strong: true });
  rows.push({ label: t("paisa.st.received"), value: pkr(c.received) });
  if (c.waived > 0) rows.push({ label: t("paisa.st.waived"), value: pkr(c.waived) });
  if (c.due > 0) rows.push({ label: t("paisa.detail.result.due"), value: pkr(c.due), strong: true, tone: "waiting" });
  else if (c.due_at_slot > 0) rows.push({ label: t("paisa.detail.result.dueAtSlot"), value: pkr(c.due_at_slot), strong: true, tone: "waiting" });
  else if (c.refund_due > 0) rows.push({ label: t("paisa.detail.result.refund"), value: pkr(c.refund_due), strong: true, tone: "danger" });
  else rows.push({ label: t("paisa.detail.result.settled"), value: pkr(0), strong: true, tone: "open" });

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <MoneyStatusPill status={b.money_status} t={t} size="md" />
        <Pill size="md" tone="neutral" label={b.court} />
      </View>
      <KeyValueBlock>
        <KeyValue label={t("paisa.detail.player")} value={b.player} />
        {b.phone ? <KeyValue label={t("paisa.detail.phone")} value={b.phone} /> : null}
        <KeyValue label={t("paisa.detail.slot")} value={pf.whenRange(b.starts_at, b.ends_at)} last />
      </KeyValueBlock>
      <MoneyRows rows={rows} testID="paisa-calc" />
      {d.dispute?.player_reason ? <Banner tone="waiting" body={t("paisa.detail.playerSays", { reason: d.dispute.player_reason })} /> : null}
      {d.pending_screenshots.map((p) => (
        <Text key={p.payment_id} variant="meta" tone="muted">{t("paisa.detail.pendingShot", { amount: pkr(p.amount) })}</Text>
      ))}
      {d.credit_available > 0 ? <Text variant="meta" tone="muted">{t("paisa.detail.credit", { amount: pkr(d.credit_available) })}</Text> : null}

      <View style={{ gap: space[2] }}>
        {can("collect") ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Button label={t("paisa.act.collect")} size="md" loading={busy === "collect"} onPress={() => onDecide("collect")} testID="paisa-collect" style={{ flexGrow: 1 }} />
            <Button label={t("paisa.act.waive")} size="md" variant="danger" loading={busy === "waive"} onPress={() => onDecide("waive")} testID="paisa-decide-waive" style={{ flexGrow: 1 }} />
          </View>
        ) : null}
        {can("record_payment") ? <Button label={t("paisa.act.record")} block size="md" onPress={() => onFollow({ kind: "record" })} testID="paisa-record" /> : null}
        {!can("collect") && can("waive") ? <Button label={t("paisa.act.waive")} variant="soft" block size="md" onPress={() => onFollow({ kind: "adjust", adj: "waived", max: c.due })} testID="paisa-waive" /> : null}
        {error ? <Banner tone="danger" body={error} /> : null}
      </View>

      <Text variant="bodyBold">{t("paisa.detail.history")}</Text>
      <View style={{ gap: 10 }} testID="paisa-history">
        {d.history.map((h) => (
          <View key={`${h.type}-${h.id}`} style={{ flexDirection: "row", gap: space[2] }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: h.amount < 0 ? palette.danger : palette.open }} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
                <Text variant="bodyBold" style={{ flexShrink: 1 }}>{historyLabel(h, t)}</Text>
                <Text variant="bodyBold" tone={h.amount < 0 ? "danger" : "primary"}>{pkr(h.amount)}</Text>
              </View>
              <Text variant="caption" tone="muted">
                {[pf.when(h.at), h.method ? (h.method === "cash_at_venue" ? t("paisa.in.cash") : h.method === "bank_transfer_proof" ? t("paisa.in.transfer") : t("paisa.in.other")) : null, h.by ? t("paisa.h.by", { by: h.by }) : null].filter(Boolean).join(" · ")}
              </Text>
              {h.note ? <Text variant="caption" tone="muted">{pf.note(h.note)}</Text> : null}
              {more && h.reversible && !isStaff ? (
                <View style={{ flexDirection: "row" }}>
                  <Button
                    label={h.type === "entry" ? t("paisa.act.fix") : t("paisa.act.undo")}
                    size="sm"
                    variant="quiet"
                    onPress={() => onFollow(h.type === "entry" ? { kind: "reverseEntry", id: h.id, amount: h.amount } : { kind: "undoAdj", id: h.id, amount: h.amount })}
                    testID={h.type === "entry" ? "paisa-fix-entry" : "paisa-undo-adj"}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <Button label={`${t("paisa.detail.more")} ⋯`} variant="soft" block size="md" onPress={onMore} testID="paisa-more" />
      {more ? (
        <View style={{ gap: space[2] }} testID="paisa-more-actions">
          {can("reduce_price") ? <Button label={t("paisa.act.reduce")} variant="soft" block size="md" onPress={() => onFollow({ kind: "adjust", adj: "price_reduced", max: c.final })} testID="paisa-reduce" /> : null}
          {can("use_credit") ? <Button label={t("paisa.act.useCredit")} variant="soft" block size="md" onPress={() => onFollow({ kind: "useCredit", max: Math.min(d.credit_available, d.owed) })} /> : null}
          {can("reverse_noshow") ? <Button label={t("paisa.act.reverseNoshow")} variant="soft" block size="md" onPress={() => onFollow({ kind: "noshow" })} testID="paisa-reverse-noshow" /> : null}
          {can("cancel") ? <Button label={t("paisa.act.cancel")} variant="danger" block size="md" onPress={() => onFollow({ kind: "cancel" })} testID="paisa-cancel" /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** "Raqam kam karein" / "Maaf karein" (owner-only adjustments): amount up to `max`, reason required. */
function AdjustSheet({ bookingId, kind, max, subtitle, onClose, onSaved }: { bookingId: string; kind: "price_reduced" | "waived"; max: number; subtitle: string; onClose: () => void; onSaved: () => void }) {
  const t = usePT();
  const { activeVenueId } = useOwnerVenues();
  const [amountText, setAmountText] = useState(kind === "waived" ? String(max) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmount(amountText);
  const ok = amount !== null && amount <= max && reason.trim().length > 0 && !busy;
  async function save() {
    if (!ok || amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.paisa.addAdjustment(bookingId, { kind, amount_pkr: amount, reason: reason.trim() }, activeVenueId);
      onSaved();
    } catch (e) {
      setError(moneyError(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet title={kind === "waived" ? t("paisa.adj.waiveTitle") : t("paisa.adj.reduceTitle")} subtitle={subtitle} onClose={onClose}
      footer={<PrimaryButton label={t("paisa.act.save")} disabled={!ok} loading={busy} onPress={save} testID="paisa-adjust-save" />}>
      <Input label={t("paisa.rec.amount")} value={amountText} onChangeText={setAmountText} keyboardType="number-pad" help={t("paisa.adj.max", { amount: pkr(max) })}
        error={amount !== null && amount > max ? t("paisa.adj.max", { amount: pkr(max) }) : null} testID="paisa-adjust-amount" />
      <Input label={t("paisa.adj.reason")} value={reason} onChangeText={setReason} testID="paisa-adjust-reason" />
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}

/** A reason, then the action (Ghalti theek karein / Wapas lein). */
function ReasonSheet({ title, subtitle, onClose, onSubmit }: { title: string; subtitle: string; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const t = usePT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setError(moneyError(e, t));
      setBusy(false);
    }
  }
  return (
    <BottomSheet title={title} subtitle={subtitle} onClose={onClose}
      footer={<PrimaryButton label={title} disabled={!reason.trim() || busy} loading={busy} onPress={go} testID="paisa-reason-save" />}>
      <Input label={t("paisa.adj.reason")} value={reason} onChangeText={setReason} testID="paisa-reason" />
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}

function AmountSheet({ title, subtitle, max, onClose, onSubmit }: { title: string; subtitle: string; max: number; onClose: () => void; onSubmit: (amount: number) => Promise<void> }) {
  const t = usePT();
  const [text, setText] = useState(String(max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmount(text);
  const ok = amount !== null && amount <= max && !busy;
  return (
    <BottomSheet title={title} subtitle={subtitle} onClose={onClose}
      footer={<PrimaryButton label={t("paisa.act.save")} disabled={!ok} loading={busy} onPress={async () => {
        if (!ok || amount === null) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit(amount);
        } catch (e) {
          setError(moneyError(e, t));
          setBusy(false);
        }
      }} />}>
      <Input label={t("paisa.rec.amount")} value={text} onChangeText={setText} keyboardType="number-pad" help={t("paisa.adj.max", { amount: pkr(max) })} />
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}

/** Booking cancel (contract 2.3): owner/staff choose who asked; the preview says what happens to the money; a cancel that keeps
 * the advance says "Advance PKR X wapas nahi hoga" and sends accept_keep_advance. The player side passes ownerSide=false. */
export function CancelSheet({ bookingId, subtitle, ownerSide, onClose, onSaved }: { bookingId: string; subtitle: string; ownerSide: boolean; onClose: () => void; onSaved: () => void }) {
  const t = usePT();
  const [who, setWho] = useState<"player" | "venue" | null>(ownerSide ? null : "player");
  const preview = useQuery({
    queryKey: ["cancel-preview", bookingId, who],
    queryFn: () => api.bookings.cancelPreview(bookingId, ownerSide ? (who ?? undefined) : undefined),
    enabled: !ownerSide || who !== null,
  });
  const p: CancelPreview | undefined = preview.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await api.bookings.cancel(bookingId, undefined, { cancelledFor: ownerSide ? (who ?? undefined) : undefined, acceptKeepAdvance: p.mode === "keep" });
      onSaved();
    } catch (e) {
      setError(moneyError(e, t));
      setBusy(false);
    }
  }
  const line = !p ? null : p.mode === "refund" ? t("paisa.cancel.refundAll", { amount: pkr(p.refund_pkr) }) : p.mode === "keep" ? t("paisa.cancel.keep", { amount: pkr(p.keep_pkr) }) : t("paisa.cancel.clear");
  return (
    <BottomSheet title={t("paisa.cancel.title")} subtitle={subtitle} onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label={t("paisa.act.cancelForm")} onPress={onClose} />
          <PrimaryButton flex label={t("paisa.cancel.confirm")} disabled={!p || !p.allowed || busy} loading={busy} onPress={go} testID="paisa-cancel-confirm" />
        </View>
      }>
      {ownerSide ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label">{t("paisa.cancel.who")}</Text>
          <Choice testID="paisa-cancel-who" value={who} onChange={setWho} options={[{ value: "player", label: t("paisa.cancel.player") }, { value: "venue", label: t("paisa.cancel.venue") }]} />
        </View>
      ) : null}
      {line ? <Banner tone={p?.mode === "keep" ? "danger" : "info"} body={line} testID="paisa-cancel-line" /> : null}
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}
