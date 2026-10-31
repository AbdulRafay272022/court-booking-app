import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatWhen } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { EmptyState, ErrorState, Header, Pill, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** audit 2026-10-28 Phase 2 item 4: every refund still owed on the platform, oldest problems first (read-only: the venue
 * owner marks a refund as paid from their own Refunds list). */
export default function AdminRefundsScreen() {
  const query = useQuery({ queryKey: ["admin-refund-queue"], queryFn: () => api.admin.refundQueue() });
  const owed = (query.data ?? [])
    .filter((r) => r.refund_status === "owed" && (r.refund_amount ?? 0) > 0)
    .sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue) || Date.parse(a.created_at) - Date.parse(b.created_at));
  return (
    <Screen testID="admin-refunds-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header title="Refunds owed" onBack={() => router.back()} />
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <SkeletonCard />
      ) : owed.length === 0 ? (
        <EmptyState title="Nothing owed" body="No refund is waiting anywhere." />
      ) : (
        owed.map((r) => (
          <View key={r.id} style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: 4 }} testID="admin-refund-row">
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>{`${r.venue_name} · ${r.court_name}`}</Text>
              {r.is_overdue ? <Pill tone="danger" label="Overdue" size="sm" /> : null}
            </View>
            <Text variant="body">{`${formatPkr(r.remaining_amount || r.refund_amount || 0)} to ${r.player_name ?? r.player_phone ?? "player"}`}</Text>
            <Text variant="meta" tone="muted">{`${r.reason.replace(/_/g, " ")} · since ${formatWhen(r.created_at, new Date(), "en")}`}</Text>
          </View>
        ))
      )}
    </Screen>
  );
}
