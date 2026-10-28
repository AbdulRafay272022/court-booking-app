import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { addDays, formatDateRelative, formatTime, pktDateString } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Chip, EmptyState, ErrorState, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OwnerHeader } from "./_fl";

/**
 * audit 2026-10-28 Phase 3 item 2: "Bank se mila lein" on the app -- every transfer credited on one day (advance and balance
 * screenshots approved), to tick off against the bank statement. Owner, or staff with view_ledger. Same endpoint as the web page.
 */
export default function BankCheckScreen() {
  const { activeVenue, activeVenueId } = useOwnerVenues();
  const today = pktDateString();
  const [day, setDay] = useState(today);
  const query = useQuery({
    queryKey: ["bank-check", activeVenueId, day],
    queryFn: () => api.owners.bankCheck(activeVenueId!, day),
    enabled: !!activeVenueId,
  });
  const data = query.data;
  const days = [0, -1, -2, -3, -4, -5, -6].map((n) => addDays(today, n));

  return (
    <Screen testID="bank-check-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <OwnerHeader title="Bank se mila lein" subtitle={activeVenue?.name} />
      <Text variant="meta" tone="muted">
        Is din transfer se jo paisa darj hua (advance aur baqi). Apni bank statement se ek ek mila lein.
      </Text>
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel="Din">
        {days.map((d) => (
          <Chip key={d} label={formatDateRelative(`${d}T12:00:00+05:00`, new Date(), "ru")} selected={day === d} onPress={() => setDay(d)} />
        ))}
      </View>
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !data ? (
        <SkeletonCard />
      ) : data.items.length === 0 ? (
        <EmptyState title="Kuch nahi aaya" body="Is din transfer se koi paisa darj nahi hua." />
      ) : (
        <>
          {data.items.map((i) => (
            <View key={i.entry_id} style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[3], gap: 2 }} testID="bank-check-row">
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{i.player_name ?? "Player"}</Text>
                <Text variant="bodyStrong">{formatPkr(i.amount_pkr)}</Text>
              </View>
              <Text variant="meta" tone="muted">{`${formatTime(i.credited_at)} · ${i.kind === "balance" ? "Baqi" : "Advance"} · ${i.code} · ${i.court_name}`}</Text>
              <Text variant="meta" tone="muted">{`Approve: ${i.approved_by === "auto" ? "khud (auto)" : i.approved_by}`}</Text>
            </View>
          ))}
          <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4] }} testID="bank-check-total">
            <Text variant="title">{`Kul: ${formatPkr(data.total_pkr)}`}</Text>
          </View>
        </>
      )}
    </Screen>
  );
}
