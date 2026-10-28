import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, formatWhen, pktDateString, type StaffActivityRow } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
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
                {n.reply_id && !n.owner_decision ? <NoShowDecision replyId={n.reply_id} /> : null}
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
  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[2] }} testID="sact-person">
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
    </View>
  );
}

/** audit 2026-10-28 Phase 3 item 6: the owner's answer to "Main aaya tha" (keep the no-show, or take it off). */
function NoShowDecision({ replyId }: { replyId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "keep" | "reverse") {
    setBusy(decision);
    setError(null);
    try {
      await api.phase3.decideNoShow(replyId, decision);
      await queryClient.invalidateQueries({ queryKey: ["staff-activity"] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <View style={{ gap: space[2], paddingTop: space[1] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Button label="No-show rakhein" size="sm" variant="soft" loading={busy === "keep"} onPress={() => decide("keep")} testID="sact-noshow-keep" />
        <Button label="No-show hatayein" size="sm" loading={busy === "reverse"} onPress={() => decide("reverse")} testID="sact-noshow-reverse" />
      </View>
      {error ? <Banner tone="danger" body={error} /> : null}
    </View>
  );
}
