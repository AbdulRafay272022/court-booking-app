import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { deductionKey, type ExcessChoice, type ExcessChoiceDetails, type PaisaBookingRow, type PaisaDaybookRow, type PaisaMoneyIn, type PaisaPlayer, type PaisaBox, type PaisaStatement } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Banner, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { formatPKR, formatShortDate, formatTime } from "@/lib/format";
import { cashShare, parseAmount, waLink } from "@/lib/paisa-mobile";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { BottomSheet, OutlineButton, PrimaryButton } from "@/components/overview/ui";
import { Choice, Line, MoneyStatusPill, PaisaCard, moneyError, pkr, type PT } from "./kit";

/** Statement card, single column (contract 6.2): Booking amount, − Deductions (+ breakdown), = Final, Received, + Due,
 * + Due at slot, + Waived, − Refund due. Every box comes from the server statement; tapping a box lists exactly the bookings in
 * its number (backend box filter). */
export function StatementCard({ s, t, onBox }: { s: PaisaStatement; t: PT; onBox?: (b: PaisaBox) => void }) {
  const tap = (b: PaisaBox) => (onBox ? () => onBox(b) : undefined);
  const parts = (["points", "no_show", "cancellation", "price_reduced"] as const).filter((k) => s.deductions[k] > 0);
  return (
    <PaisaCard testID="paisa-statement">
      <Text variant="bodyBold">{t("paisa.st.title")}</Text>
      <Line label={t("paisa.st.bookingAmount")} value={pkr(s.booking_amount)} />
      <Line label={`− ${t("paisa.st.deductions")}`} value={pkr(-s.deductions.total)} onPress={tap("deductions")} testID="paisa-st-deductions" />
      {parts.map((k) => (
        <Line key={k} indent label={t(deductionKey(k))} value={pkr(-s.deductions[k])} />
      ))}
      <Line strong label={`= ${t("paisa.st.final")}`} value={pkr(s.final)} testID="paisa-st-final" />
      <View style={{ height: 1, backgroundColor: palette.line, marginVertical: space[1] }} />
      <Line label={t("paisa.st.received")} value={pkr(s.received)} onPress={tap("received")} testID="paisa-st-received" />
      <Line label={`+ ${t("paisa.st.due")}`} value={pkr(s.due)} tone={s.due > 0 ? "waiting" : undefined} onPress={tap("due")} testID="paisa-st-due" />
      <Line label={`+ ${t("paisa.st.dueAtSlot")}`} value={pkr(s.due_at_slot)} onPress={tap("due_at_slot")} testID="paisa-st-due-at-slot" />
      <Line label={`+ ${t("paisa.st.waived")}`} value={pkr(s.waived)} onPress={tap("waived")} testID="paisa-st-waived" />
      <Line label={`− ${t("paisa.st.refundDue")}`} value={pkr(-s.refund_due)} tone={s.refund_due > 0 ? "danger" : undefined} onPress={tap("refund_due")} testID="paisa-st-refund-due" />
    </PaisaCard>
  );
}

/** "Money in": total, cash / transfer bar, refunds paid (by money business day). */
export function MoneyInCard({ m, t }: { m: PaisaMoneyIn; t: PT }) {
  const share = cashShare(m.cash, m.transfer);
  return (
    <PaisaCard testID="paisa-money-in">
      <Line strong label={t("paisa.in.title")} value={pkr(m.cash + m.transfer + m.other)} />
      <View style={{ flexDirection: "row", height: 10, borderRadius: radius.pill, overflow: "hidden", backgroundColor: palette.line }} accessibilityLabel={`${t("paisa.in.cash")} ${pkr(m.cash)}, ${t("paisa.in.transfer")} ${pkr(m.transfer)}`}>
        <View style={{ flex: share, backgroundColor: palette.teal }} />
        <View style={{ flex: 1 - share, backgroundColor: palette.waiting }} />
      </View>
      <Line label={`■ ${t("paisa.in.cash")}`} value={pkr(m.cash)} />
      <Line label={`■ ${t("paisa.in.transfer")}`} value={pkr(m.transfer)} />
      {m.other ? <Line label={t("paisa.in.other")} value={pkr(m.other)} /> : null}
      <Line label={t("paisa.in.refunds")} value={pkr(-m.refunds_paid.total)} tone={m.refunds_paid.total > 0 ? "danger" : undefined} />
      <Line strong label={t("paisa.in.net")} value={pkr(m.net)} />
    </PaisaCard>
  );
}

/** Booking card: name; "Day date · time · court · KH-id"; "Final X · Received Y"; right: status pill + balance. */
export function BookingRowCard({ r, t, highlighted, onPress }: { r: PaisaBookingRow; t: PT; highlighted?: boolean; onPress: () => void }) {
  const balance = r.due > 0 ? r.due : r.due_at_slot > 0 ? r.due_at_slot : r.refund_due > 0 ? -r.refund_due : 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${r.player} ${r.short_code}`} testID="paisa-booking-row"
      style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[3], gap: space[2], boxShadow: shadow.card, borderWidth: highlighted ? 2 : 0, borderColor: palette.teal }}>
      <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{r.player}</Text>
          <Text variant="caption" tone="muted">{`${formatShortDate(r.starts_at)} · ${formatTime(r.starts_at)} · ${r.court} · ${r.short_code}`}</Text>
          <Text variant="caption" tone="muted">{t("paisa.row.final", { final: pkr(r.final), received: pkr(r.received) })}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6, maxWidth: "45%" }}>
          <MoneyStatusPill status={r.money_status} t={t} />
          {balance !== 0 ? <Text variant="bodyBold" tone={balance < 0 ? "danger" : "waiting"}>{pkr(Math.abs(balance))}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

function rowKind(r: PaisaDaybookRow, t: PT): string {
  if (r.type === "adjustment") return t(deductionKey(r.kind));
  if (r.bucket === "refund") return r.kind === "correction" ? t("paisa.h.correction") : t("paisa.h.refund");
  if (r.kind === "correction") return t("paisa.h.correction");
  if (r.kind === "credit_in") return t("paisa.h.credit_in");
  if (r.kind === "credit_out") return t("paisa.h.credit_out");
  return t("paisa.h.payment");
}

function methodLabel(m: string | null, t: PT): string | null {
  return m === "cash" ? t("paisa.in.cash") : m === "transfer" ? t("paisa.in.transfer") : m === "other" ? t("paisa.in.other") : null;
}

/** Len-den row (no per-row "Theek karein": fixing is in the booking sheet's "Aur"). */
export function DaybookRow({ r, t, onPress }: { r: PaisaDaybookRow; t: PT; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="paisa-lenden-row"
      style={{ flexDirection: "row", gap: space[3], padding: space[3], backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: palette.divider }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyBold">{r.player}</Text>
        <Text variant="caption" tone="muted">{[rowKind(r, t), methodLabel(r.method, t), r.by].filter(Boolean).join(" · ")}</Text>
        <Text variant="caption" tone="muted">{`${r.short_code} · ${t("paisa.lenden.slotDay", { date: formatShortDate(`${r.slot_business_date}T12:00:00+05:00`) })}`}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text variant="bodyStrong" tone={r.amount < 0 ? "danger" : "primary"}>{`${r.amount < 0 ? "−" : "+"}${pkr(Math.abs(r.amount))}`}</Text>
        <Text variant="caption" tone="muted">{formatTime(r.at)}</Text>
      </View>
    </Pressable>
  );
}

export function DayHeader({ date, total, t }: { date: string; total: number; t: PT }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space[2], paddingHorizontal: space[3], paddingTop: space[4], paddingBottom: space[2], flexWrap: "wrap" }} testID="paisa-lenden-day">
      <Text variant="bodyBold">{formatShortDate(`${date}T12:00:00+05:00`)}</Text>
      <Text variant="meta" tone="muted">{t("paisa.lenden.dayTotal", { amount: pkr(total) })}</Text>
    </View>
  );
}

export function PlayerRow({ p, t, onPress }: { p: PaisaPlayer; t: PT; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="paisa-player-row"
      style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[3], gap: 4, boxShadow: shadow.card }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
        <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{p.name}</Text>
        {p.due_total > 0 ? <Text variant="bodyStrong" tone="waiting">{pkr(p.due_total)}</Text> : null}
      </View>
      <Text variant="caption" tone="muted">
        {[p.phone, p.open_bookings.length ? `${p.open_bookings.length} bookings` : null, p.credit ? t("paisa.players.credit", { amount: pkr(p.credit) }) : null].filter(Boolean).join(" · ")}
      </Text>
    </Pressable>
  );
}

/** "Raqam lein" from a player: oldest booking first breakdown, cash saved through POST /owners/paisa/players/payment;
 * WhatsApp share with the list. */
export function TakePaymentSheet({ p, t, venueName, onClose, onSaved }: { p: PaisaPlayer; t: PT; venueName: string; onClose: () => void; onSaved: () => void }) {
  const { activeVenueId } = useOwnerVenues();
  const [text, setText] = useState(String(p.due_total));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excess, setExcess] = useState<ExcessChoiceDetails | null>(null);
  const [choice, setChoice] = useState<ExcessChoice>("refund");
  const amount = parseAmount(text);
  let left = amount ?? 0;
  const plan = p.open_bookings.map((b) => {
    const part = Math.min(left, b.due);
    left -= part;
    return { ...b, part };
  });
  const list = p.open_bookings.map((b) => `${b.short_code} ${pkr(b.due)}`).join(", ");
  async function save() {
    if (amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.paisa.playerPayment({ player_id: p.key.player_id, phone: p.key.phone, amount_pkr: amount, excess_choice: excess ? choice : undefined }, activeVenueId);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && (e.code as string) === "EXCESS_CHOICE_REQUIRED") {
        const d = (e.details ?? {}) as Partial<ExcessChoiceDetails>;
        setExcess({ excess_pkr: d.excess_pkr ?? 0, can_credit: !!d.can_credit });
      } else setError(moneyError(e, t));
      setBusy(false);
    }
  }
  return (
    <BottomSheet title={t("paisa.players.take")} subtitle={`${p.name} · ${t("paisa.players.total", { amount: pkr(p.due_total) })}`} onClose={onClose} testID="paisa-take-sheet"
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          {p.phone ? <OutlineButton flex label={t("paisa.act.whatsapp")} onPress={() => void Linking.openURL(waLink(p.phone, t("paisa.players.wa", { name: p.name, venue: venueName, amount: pkr(p.due_total), list })))} /> : null}
          <PrimaryButton flex label={t("paisa.act.save")} disabled={amount === null || busy} loading={busy} onPress={save} testID="paisa-take-save" />
        </View>
      }>
      <Input label={`${t("paisa.rec.amount")} · ${t("paisa.rec.cash")}`} value={text} onChangeText={(v) => { setText(v); setExcess(null); }} keyboardType="number-pad" testID="paisa-take-amount" />
      <Text variant="label">{t("paisa.players.oldestFirst")}</Text>
      <PaisaCard style={{ backgroundColor: palette.ground }}>
        {plan.map((b) => (
          <Line key={b.booking_id} label={`${b.short_code} · ${formatShortDate(b.starts_at)}`} value={`${pkr(b.part)} / ${pkr(b.due)}`} />
        ))}
      </PaisaCard>
      {excess ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodyBold">{t("paisa.rec.extra", { amount: formatPKR(excess.excess_pkr) })}</Text>
          <Choice value={choice} onChange={setChoice} options={[{ value: "refund", label: t("paisa.rec.toPlayer") }, { value: "credit", label: t("paisa.rec.toCredit"), disabled: !excess.can_credit }]} />
        </View>
      ) : null}
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}
