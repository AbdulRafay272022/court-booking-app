import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { taskKey, type OwnerRefund, type PaisaBankMissingItem, type PaisaDueItem, type PaisaNoShowItem, type PaisaTaskGroup, type PaisaTasks } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, EmptyState, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatDayHeader, formatWhen } from "@/lib/format";
import { GroupLabel } from "@/app/(owner)/_fl";
import { BankCheckBlock } from "./bank-check-block";
import { RefundCard } from "./refund-card";
import { invalidatePaisa } from "./booking-sheet";
import { MoneyStatusPill, moneyError, pkr, type PT } from "./kit";

export type KaamOpen =
  | { kind: "booking"; id: string }
  | { kind: "refund"; refund: OwnerRefund }
  | { kind: "noshow"; bookingId: string; replyId: string; subtitle: string }
  | { kind: "due"; due: PaisaDueItem };

function Card({ children, red, testID }: { children: React.ReactNode; red?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={{ backgroundColor: red ? palette.dangerTint : palette.white, borderColor: red ? palette.dangerBorder : "transparent", borderWidth: red ? 1.5 : 0, borderRadius: radius.tile, padding: space[3], gap: space[1] }}>
      {children}
    </View>
  );
}

function dueStatus(d: PaisaDueItem, t: PT): string {
  if (d.status === "disputed" && d.owner_decision === "collect") return t("due.collect");
  return t(`due.${d.status}` as Parameters<PT>[0]);
}

/** One Kaam group (contract 5.6 / 6.2): label + count, then its cards. Buttons that are owner-only are hidden for staff. */
export function KaamGroupCard({ group, t, open, courtName, filterDate, onClearFilter }: {
  group: PaisaTaskGroup;
  t: PT;
  open: (o: KaamOpen) => void;
  courtName: (refund: OwnerRefund) => string;
  filterDate?: string;
  onClearFilter?: () => void;
}) {
  const qc = useQueryClient();
  const isStaff = useAuthStore((s) => s.user?.role) === "staff";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await invalidatePaisa(qc);
      await qc.invalidateQueries({ queryKey: ["staff-activity"] });
    } catch (e) {
      setError(moneyError(e, t));
    } finally {
      setBusy(null);
    }
  }

  const title = `${t(taskKey(group.key))}${group.count ? ` · ${group.count}` : ""}`;
  let body: React.ReactNode = null;
  switch (group.key) {
    case "short_decide":
    case "due_collect":
      body = (group.items as PaisaDueItem[]).map((d) => (
        <Card key={d.id} testID={`kaam-${group.key}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} onPress={() => open({ kind: "booking", id: d.booking_id })}>{`${d.player_name ?? "Player"} · ${d.code}`}</Text>
            <Text variant="bodyStrong">{pkr(d.due_pkr)}</Text>
          </View>
          <Text variant="meta" tone="muted">{[dueStatus(d, t), d.starts_at ? formatWhen(d.starts_at, new Date(), "ru") : null].filter(Boolean).join(" · ")}</Text>
          {d.player_reason ? <Text variant="body">{t("paisa.detail.playerSays", { reason: d.player_reason })}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
            {group.key === "short_decide" && !isStaff ? (
              <>
                <Button label={t("paisa.act.collect")} size="sm" loading={busy === `c${d.id}`} onPress={() => act(`c${d.id}`, () => api.phase3.decideShort(d.id, "collect"))} testID="kaam-collect" />
                <Button label={t("paisa.act.waive")} size="sm" variant="danger" loading={busy === `w${d.id}`} onPress={() => act(`w${d.id}`, () => api.phase3.decideShort(d.id, "waive"))} testID="kaam-waive" />
              </>
            ) : null}
            {group.key === "due_collect" ? <Button label={t("paisa.players.take")} size="sm" onPress={() => open({ kind: "due", due: d })} testID="kaam-due-done" /> : null}
          </View>
        </Card>
      ));
      break;
    case "noshow_reply":
      body = (group.items as PaisaNoShowItem[]).map((n) => {
        const sub = [n.player_name ?? "Player", n.court_name ?? "", n.starts_at ? formatWhen(n.starts_at, new Date(), "ru") : ""].filter(Boolean).join(" · ");
        return (
          <Card key={n.booking_id} red={n.highlight} testID="kaam-noshow">
            <Text variant="bodyStrong" onPress={() => open({ kind: "booking", id: n.booking_id })}>{sub}</Text>
            {n.highlight ? <Text variant="meta" weight="bold" tone="danger">{t("paisa.kaam.gps")}</Text> : null}
            <Text variant="body">{`${t("paisa.kaam.playerCame")}${n.player_note ? ` ("${n.player_note}")` : ""}`}</Text>
            {!isStaff && n.reply_id ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
                <Button label={t("paisa.act.playerRight")} size="sm" onPress={() => open({ kind: "noshow", bookingId: n.booking_id, replyId: n.reply_id!, subtitle: sub })} testID="kaam-noshow-reverse" />
                <Button label={t("paisa.act.keepNoshow")} size="sm" variant="soft" loading={busy === `k${n.reply_id}`} onPress={() => act(`k${n.reply_id}`, () => api.phase3.decideNoShow(n.reply_id!, "keep"))} testID="kaam-noshow-keep" />
              </View>
            ) : null}
          </Card>
        );
      });
      break;
    case "refund_due":
    case "refund_not_got":
      body = (
        <>
          {group.key === "refund_due" && group.count > 0 ? (
            <Text variant="meta" tone="muted" testID="kaam-refund-header">{t("paisa.kaam.refundHeader", { amount: pkr(group.total), days: group.oldest_days })}</Text>
          ) : null}
          {group.key === "refund_due" && filterDate ? (
            <Banner tone="info" body={formatDayHeader(filterDate)} action={<Button label={t("paisa.clearFilter")} variant="soft" size="sm" onPress={onClearFilter} />} />
          ) : null}
          {(group.items as OwnerRefund[]).map((r) => (
            <RefundCard key={r.id} refund={r} court={courtName(r)} t={t} canMark onMark={() => open({ kind: "refund", refund: r })} onOpenBooking={() => open({ kind: "booking", id: r.booking_id })} />
          ))}
        </>
      );
      break;
    case "bank_check":
      body = (
        <>
          {(group.items as PaisaBankMissingItem[]).map((m) => (
            <Card key={m.entry_id} red testID="kaam-bank-open">
              <Text variant="bodyStrong">{`${m.code} · ${m.player_name ?? "Player"} · ${formatPkr(m.amount_pkr)}`}</Text>
              <Text variant="meta" weight="bold" tone="danger">{`${m.approved_by_name ?? "?"} · ${formatWhen(m.credited_at, new Date(), "ru")}`}</Text>
              {!isStaff ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
                  {m.approved_by_role === "staff" ? (
                    <Button label={t("paisa.act.staffPays")} size="sm" loading={busy === `s${m.entry_id}`} onPress={() => act(`s${m.entry_id}`, () => api.owners.bankMissingDecide(m.entry_id, "staff"))} testID="kaam-bank-staff" />
                  ) : null}
                  <Button label={t("paisa.act.playerPays")} size="sm" variant="soft" loading={busy === `p${m.entry_id}`} onPress={() => act(`p${m.entry_id}`, () => api.owners.bankMissingDecide(m.entry_id, "player"))} testID="kaam-bank-player" />
                </View>
              ) : null}
            </Card>
          ))}
          <BankCheckBlock />
        </>
      );
      break;
    case "screenshots":
      body = (
        <Card testID="kaam-screenshots">
          <Text variant="body">{t("paisa.kaam.screenshotsLine", { n: group.count })}</Text>
          <View style={{ flexDirection: "row" }}>
            <Button label={t("paisa.act.openApprovals")} size="sm" variant="soft" onPress={() => router.navigate("/(owner)/(tabs)/approvals")} />
          </View>
        </Card>
      );
      break;
    case "attendance":
      body = group.items.map((r) => (
        <Card key={r.booking_id} testID="kaam-attendance">
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
            <Text variant="bodyStrong" style={{ flexShrink: 1 }} onPress={() => open({ kind: "booking", id: r.booking_id })}>{`${r.player} · ${r.short_code}`}</Text>
            <MoneyStatusPill status={r.money_status} t={t} />
          </View>
          <Text variant="meta" tone="muted">{`${formatWhen(r.starts_at, new Date(), "ru")} · ${r.court}`}</Text>
          <View style={{ flexDirection: "row" }}>
            <Button label={t("paisa.kaam.attendance")} size="sm" variant="soft" onPress={() => open({ kind: "booking", id: r.booking_id })} />
          </View>
        </Card>
      ));
      break;
  }
  const empty = group.count === 0 && group.key !== "bank_check" && group.key !== "screenshots";
  return (
    <View style={{ gap: space[2] }} testID={`kaam-group-${group.key}`}>
      <GroupLabel>{title}</GroupLabel>
      {empty ? <Text variant="meta" tone="muted">{t("paisa.empty.group")}</Text> : body}
      {error ? <Banner tone="danger" body={error} /> : null}
    </View>
  );
}

/** Kaam groups in the contract order; with `focus` that group comes first. */
export function orderedGroups(tasks: PaisaTasks | undefined, focus?: string): PaisaTaskGroup[] {
  const groups = tasks?.groups ?? [];
  if (!focus) return groups;
  const i = groups.findIndex((g) => g.key === focus);
  return i <= 0 ? groups : [groups[i], ...groups.slice(0, i), ...groups.slice(i + 1)];
}

export function KaamEmpty({ t }: { t: PT }) {
  return <EmptyState title={t("paisa.empty.kaam")} />;
}
