import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, formatWhen, pktDateString, type StaffActivityRow, type StaffBankMissing } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { NoShowReverseSheet, type ReverseTarget } from "@/components/money-sheets";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OwnerHeader } from "./_fl";
import { VenueMoneyHealth } from "@/components/money-health-card";

const PRESETS = [7, 30, 90] as const;

/**
 * Audit 2026-10-28 item 16: the owner's staff dashboard on the app (read-only, owner only; the "Aur" entry is ownerOnly).
 * Per person: bookings marked, no-shows, check-ins, walk-ins, short payments ("kam mila"), cash, transfers, refunds, total;
 * then the no-show list with who marked it and when. Same endpoint as the web page.
 */
export default function StaffActivityScreen() {
  const { activeVenue, activeVenueId } = useOwnerVenues();
  const [days, setDays] = useState<(typeof PRESETS)[number]>(30);
  const to = pktDateString();
  const from = addDays(to, -(days - 1));
  const query = useQuery({
    queryKey: ["staff-activity", activeVenueId, from, to],
    queryFn: () => api.owners.staffActivity(activeVenueId!, from, to),
    enabled: !!activeVenueId,
  });
  const data = query.data;

  return (
    <Screen testID="staff-activity-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <OwnerHeader title="Staff ka kaam" subtitle={activeVenue?.name} />
      <VenueMoneyHealth venueId={activeVenueId} />
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel="Kitne din">
        {PRESETS.map((d) => (
          <Chip key={d} label={`Pichle ${d} din`} selected={days === d} onPress={() => setDays(d)} testID={`sact-days-${d}`} />
        ))}
      </View>
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !data ? (
        <SkeletonCard />
      ) : data.people.length === 0 ? (
        <EmptyState title="Koi kaam darj nahi" body="Is muddat mein kisi ne kuch mark nahi kiya." />
      ) : (
        <>
          {data.people.map((p) => (
            <PersonCard key={p.user_id ?? p.name ?? "?"} p={p} />
          ))}
          <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[1] }} testID="sact-totals">
            <Text variant="title">Kul</Text>
            <Text variant="body">{`Darj paisa: ${formatPkr(data.totals.total_recorded_pkr)} (cash ${formatPkr(data.totals.cash_pkr)}, transfer ${formatPkr(data.totals.transfers_pkr)})`}</Text>
            <Text variant="body">{`Nahi aaye: ${data.totals.no_shows} · Kam mila: ${data.totals.short_payments}`}</Text>
          </View>
        </>
      )}

      {data && (data.bank_missing ?? []).length > 0 ? (
        <View style={{ gap: space[2] }} testID="sact-bank-missing">
          <Text variant="title" tone="danger" accessibilityRole="header">
            Bank mein nahi mila
          </Text>
          <Text variant="meta" tone="muted">
            Baqi raqam ke transfer jo venue par approve hue lekin bank mein nahi aaye. Faisla karein: staff se wasool ya player se baqi.
          </Text>
          {(data.bank_missing ?? []).map((m) => (
            <BankMissingCard key={m.entry_id} m={m} />
          ))}
        </View>
      ) : null}

      {data ? (
        <View style={{ gap: space[2] }} testID="sact-no-shows">
          <Text variant="title" accessibilityRole="header">
            No-show ki list
          </Text>
          {data.no_shows.length === 0 ? (
            <Text variant="body" tone="muted">
              Is muddat mein koi no-show nahi.
            </Text>
          ) : (
            data.no_shows.map((n) => (
              <View
                key={n.booking_id}
                testID={n.highlight ? "sact-no-show-red" : "sact-no-show"}
                style={{
                  backgroundColor: n.highlight ? palette.dangerTint : palette.white,
                  borderColor: n.highlight ? palette.dangerBorder : "transparent",
                  borderWidth: n.highlight ? 1.5 : 0,
                  borderRadius: radius.tile,
                  padding: space[3],
                  gap: 2,
                }}
              >
                <Text variant="bodyStrong">{[n.player_name ?? "Player", n.court_name, n.starts_at ? formatWhen(n.starts_at, new Date(), "ru") : null].filter(Boolean).join(" · ")}</Text>
                <Text variant="meta" tone="muted">{`${n.marked_by_name ?? "?"} ne mark kiya, ${formatWhen(n.marked_at, new Date(), "ru")}`}</Text>
                {n.highlight ? <Text variant="meta" weight="bold" tone="danger">GPS: player venue par tha</Text> : null}
                {n.player_replied ? <Text variant="body">{`Player ne kaha: main aaya tha${n.player_note ? ` ("${n.player_note}")` : ""}`}</Text> : null}
                {n.owner_decision ? <Text variant="meta" tone="muted">{n.owner_decision === "reverse" ? "Aap ne no-show hata diya." : "Aap ne no-show rakha."}</Text> : null}
                {n.reply_id && !n.owner_decision ? (
                  <NoShowDecision
                    replyId={n.reply_id}
                    bookingId={n.booking_id}
                    subtitle={[n.player_name ?? "Player", n.court_name, n.starts_at ? formatWhen(n.starts_at, new Date(), "ru") : null].filter(Boolean).join(" · ")}
                  />
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function PersonCard({ p }: { p: StaffActivityRow }) {
  const line = (label: string, value: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
      <Text variant="body" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
  const red = (p.bank_missing_open ?? 0) > 0;
  return (
    <View
      style={{
        backgroundColor: red ? palette.dangerTint : palette.white,
        borderColor: red ? palette.dangerBorder : "transparent",
        borderWidth: red ? 1.5 : 0,
        borderRadius: radius.card,
        padding: space[4],
        gap: space[2],
      }}
      testID={red ? "sact-person-red" : "sact-person"}
    >
      <Text variant="title">{`${p.name ?? "?"} ${p.role === "owner" ? "(owner)" : "(staff)"}`}</Text>
      {line("Bookings mark", String(p.bookings_marked))}
      {line("Nahi aaye (no-show)", String(p.no_shows))}
      {line("Check-in", String(p.check_ins))}
      {line("Walk-in", String(p.walkins))}
      {line("Kam mila", p.short_payments > 0 ? `${p.short_payments} (${formatPkr(p.short_amount_pkr)})` : "0")}
      {line("Cash", formatPkr(p.cash_pkr))}
      {line("Transfer", formatPkr(p.transfers_pkr))}
      {line("Refund diye", formatPkr(p.refunds_paid_pkr))}
      {line("Kul darj", formatPkr(p.total_recorded_pkr))}
      {p.bank_missing ? (
        <Text variant="bodyStrong" tone={red ? "danger" : "muted"}>
          {`Bank mein nahi mila: ${p.bank_missing} (${formatPkr(p.bank_missing_pkr ?? 0)})${red ? " · faisla baqi" : ""}`}
        </Text>
      ) : null}
    </View>
  );
}

/** audit fixes 2026-10-31 (b): a balance transfer the bank never got. The owner chooses once: collect it from the staff member
 * (no player message) or ask the player (the normal short-payment flow). */
function BankMissingCard({ m }: { m: StaffBankMissing }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"staff" | "player" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "staff" | "player") {
    setBusy(decision);
    setError(null);
    try {
      await api.owners.bankMissingDecide(m.entry_id, decision);
      await queryClient.invalidateQueries({ queryKey: ["staff-activity"] });
      await queryClient.invalidateQueries({ queryKey: ["bank-check"] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const open = m.decision == null;
  return (
    <View
      testID={open ? "sact-bank-open" : "sact-bank-done"}
      style={{
        backgroundColor: open ? palette.dangerTint : palette.white,
        borderColor: open ? palette.dangerBorder : "transparent",
        borderWidth: open ? 1.5 : 0,
        borderRadius: radius.tile,
        padding: space[3],
        gap: space[1],
      }}
    >
      <Text variant="bodyStrong">{`${m.code} · ${m.player_name ?? "Player"} · ${formatPkr(m.amount_pkr)}`}</Text>
      <Text variant="meta" weight={open ? "bold" : undefined} tone={open ? "danger" : "muted"}>
        {`${m.approved_by_name ?? "?"} ne approve kiya, ${formatWhen(m.credited_at, new Date(), "ru")}`}
      </Text>
      {open ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
          {m.approved_by_role === "staff" ? (
            <Button label="Staff se wasool karein" size="sm" loading={busy === "staff"} onPress={() => decide("staff")} testID="sact-bank-staff" />
          ) : null}
          <Button label="Player se baqi maangein" size="sm" variant="soft" loading={busy === "player"} onPress={() => decide("player")} testID="sact-bank-player" />
        </View>
      ) : (
        <Text variant="meta" tone="muted">{m.decision === "staff" ? "Staff se wasool hoga" : "Player se baqi maanga gaya"}</Text>
      )}
      {error ? <Banner tone="danger" body={error} /> : null}
    </View>
  );
}

/** audit 2026-10-28 Phase 3 item 6: the owner's answer to "Main aaya tha". Keep is one tap; taking the no-show back asks the
 * final price, the money received and cash / transfer first (audit fixes 2026-10-31). */
function NoShowDecision({ replyId, bookingId, subtitle }: { replyId: string; bookingId: string; subtitle: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reverse, setReverse] = useState<ReverseTarget | null>(null);
  async function keep() {
    setBusy("keep");
    setError(null);
    try {
      await api.phase3.decideNoShow(replyId, "keep");
      await queryClient.invalidateQueries({ queryKey: ["staff-activity"] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function openReverse() {
    setBusy("reverse");
    setError(null);
    try {
      const detail = await api.owners.bookingDetail(bookingId);
      setReverse({ bookingId, subtitle, total: detail.row.total, paid: detail.row.total_paid, replyId });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <View style={{ gap: space[2], paddingTop: space[1] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Button label="No-show rakhein" size="sm" variant="soft" loading={busy === "keep"} onPress={keep} testID="sact-noshow-keep" />
        <Button label="No-show hatayein" size="sm" loading={busy === "reverse"} onPress={openReverse} testID="sact-noshow-reverse" />
      </View>
      {error ? <Banner tone="danger" body={error} /> : null}
      {reverse ? (
        <NoShowReverseSheet
          target={reverse}
          onClose={() => setReverse(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["staff-activity"] })}
        />
      ) : null}
    </View>
  );
}
