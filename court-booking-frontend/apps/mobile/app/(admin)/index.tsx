import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, Building2, IdCard, LogOut, RotateCcw } from "lucide-react-native";
import { Badge, Card, Header, ListRow, Screen, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { confirmLogout } from "@/lib/logout";

/**
 * audit 2026-10-28 Phase 2 item 4: the super admin's CORE tools in the app (it used to say "use the web console"):
 * venue approvals, owner CNIC review, refunds owed across the platform, and alerts. Everything else (feature flags,
 * premium billing, staff activity, overview metrics) stays on the web console, said below. English like the web console.
 */
export default function AdminHomeScreen() {
  const pending = useQuery({ queryKey: ["admin-pending-venues"], queryFn: () => api.admin.pendingVenues() });
  const cnic = useQuery({ queryKey: ["admin-identities", "unverified", 1], queryFn: () => api.admin.ownerIdentities("unverified", 1) });
  const refunds = useQuery({ queryKey: ["admin-refund-queue"], queryFn: () => api.admin.refundQueue() });
  const owed = (refunds.data ?? []).filter((r) => r.refund_status === "owed" && (r.refund_amount ?? 0) > 0);
  const overdue = owed.filter((r) => r.is_overdue).length;
  const count = (n: number | undefined) => (n ? <Badge count={n} /> : null);

  return (
    <Screen testID="admin-home">
      <Header title="Khelo admin" subtitle="Core tools. The full console is on the web." />
      <Card padding={0} radiusSize="cardL">
        <ListRow icon={Building2} title="Venue approvals" subtitle="Approve, request changes, reject" trailing={count(pending.data?.length)} onPress={() => router.push("/(admin)/venues" as never)} divider testID="admin-venues" />
        <ListRow icon={IdCard} title="Owner CNIC" subtitle="Approve or not approve, with a reason" trailing={count(cnic.data?.total)} onPress={() => router.push("/(admin)/identities" as never)} divider testID="admin-identities" />
        <ListRow
          icon={RotateCcw}
          title="Refunds owed"
          subtitle={overdue > 0 ? `${overdue} overdue` : "Across every venue"}
          trailing={count(owed.length)}
          onPress={() => router.push("/(admin)/refunds" as never)}
          divider
          testID="admin-refunds"
        />
        <ListRow icon={Bell} title="Alerts" subtitle="New venues, payments, refunds" onPress={() => router.push("/(admin)/alerts" as never)} testID="admin-alerts" />
      </Card>
      <Text variant="meta" tone="muted">
        Feature flags, premium billing, staff activity and the overview metrics are on the web console.
      </Text>
      <Card padding={0} radiusSize="cardL">
        <ListRow icon={LogOut} title="Log out" danger onPress={confirmLogout} testID="admin-logout" />
      </Card>
    </Screen>
  );
}
