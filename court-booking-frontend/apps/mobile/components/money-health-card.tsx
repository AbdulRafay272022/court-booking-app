import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { MoneyHealth } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Text } from "@/components/ui";

import { api } from "@/lib/api";

/** audit 2026-10-28 Phase 3 item 9: points / dues / disputes at a glance (owner + staff screens: one venue; admin: totals).
 * Hidden when there is nothing to show. */
export function MoneyHealthTiles({ totals, title }: { totals: MoneyHealth["totals"]; title: string }) {
  const tiles: [string, string, boolean][] = [
    ["Baqi (bookings · raqam)", `${totals.dues_open} · ${formatPkr(totals.dues_open_pkr)}`, false],
    ["Hisaab par faisla baqi", String(totals.short_disputes_waiting), totals.short_disputes_waiting > 0],
    ["\"Main aaya tha\" par faisla baqi", String(totals.noshow_replies_waiting), totals.noshow_replies_waiting > 0],
    ["Points diye / istemal", `${totals.points_awarded} / ${totals.points_used}`, false],
  ];
  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[2] }} testID="money-health">
      <Text variant="title">{title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {tiles.map(([label, value, warn]) => (
          <View key={label} style={{ minWidth: "46%", flexGrow: 1, gap: 2 }}>
            <Text variant="meta" tone="muted">{label}</Text>
            <Text variant="bodyStrong" tone={warn ? "danger" : undefined}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function VenueMoneyHealth({ venueId }: { venueId: string | null | undefined }) {
  const q = useQuery({ queryKey: ["owner-money-health", venueId], queryFn: () => api.phase3.moneyHealth(venueId!), enabled: !!venueId });
  const t = q.data?.totals;
  if (!t || (t.dues_open === 0 && t.short_disputes_waiting === 0 && t.noshow_replies_waiting === 0 && t.points_awarded === 0 && t.points_used === 0)) return null;
  return <MoneyHealthTiles totals={t} title="Points, baqi aur jhagre" />;
}
