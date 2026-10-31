import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { EmptyState, ErrorState, Header, Screen, SkeletonCard, Text } from "@/components/ui";

import { MoneyHealthTiles } from "@/components/money-health-card";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** audit 2026-10-28 Phase 3 item 9: points, dues and disputes across every venue, worst first (admin; English like the console). */
export default function AdminMoneyHealthScreen() {
  const q = useQuery({ queryKey: ["admin-money-health"], queryFn: () => api.phase3.adminMoneyHealth() });
  return (
    <Screen testID="admin-money-health" refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Header title="Dues & points" onBack={() => router.back()} />
      {q.isError ? (
        <ErrorState message={friendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <SkeletonCard />
      ) : (
        <>
          <MoneyHealthTiles totals={q.data.totals} title="All venues" />
          {q.data.venues.length === 0 ? (
            <EmptyState title="Nothing yet" body="No dues, disputes or points anywhere." />
          ) : (
            q.data.venues.map((v) => (
              <View key={v.venue_id} style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: 2 }}>
                <Text variant="bodyStrong">{v.venue_name}</Text>
                <Text variant="meta" tone={v.short_disputes_waiting + v.noshow_replies_waiting > 0 ? "danger" : "muted"}>
                  {`Disputes ${v.short_disputes_waiting} · No-show replies ${v.noshow_replies_waiting}`}
                </Text>
                <Text variant="meta" tone="muted">{`Open dues ${v.dues_open} (${formatPkr(v.dues_open_pkr)}) · Points ${v.points_awarded} / ${v.points_used}`}</Text>
              </View>
            ))
          )}
        </>
      )}
    </Screen>
  );
}
