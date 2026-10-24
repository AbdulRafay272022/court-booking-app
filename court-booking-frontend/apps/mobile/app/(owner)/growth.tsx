import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Crown, TrendingUp } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { formatTime24As12 } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Chip, EmptyState, ErrorState, Pill, Screen, SkeletonCard, Text } from "@/components/ui";

import { courtLabel } from "@/components/court-label";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { growthGrid } from "@/lib/owner-floodlight";
import { NoAccess } from "@/components/no-access";
import { OwnerHeader } from "./_fl";

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pct = (f: number) => `${Math.round(f * 100)}%`;
const hourText = (h: number) => formatTime24As12(`${String(h % 24).padStart(2, "0")}:00`).replace(":00", "");

/**
 * OGrowthTeam frame 1 "Growth". GET /owners/growth returns ONLY the under-booked cells and a server text suggestion
 * (contract B3): the heatmap shows those cells and leaves the rest neutral ("no signal", never "0%"). No discount amounts
 * or one-tap discount actions exist in the backend, so none are offered here.
 */
export default function GrowthScreen() {
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();
  const perms = useMyPermissions();
  const flags = useFeatureFlags();

  const query = useQuery({
    queryKey: ["owner-growth", activeVenueId],
    queryFn: () => api.owners.growth(activeVenueId),
    enabled: !!activeVenueId && perms.can("view_growth") && flags.on("growth_suggestions"),
    retry: false,
  });

  const ineligible = query.error instanceof ApiError && query.error.status === 403;
  const suggestions = query.data?.underbooked_slots ?? [];
  const grid = growthGrid(suggestions);
  const weeks = suggestions.length ? Math.max(...suggestions.map((s) => s.weeks_of_data)) : 0;

  // Staff without view_growth: the shared no-access screen, not the owner's "premium feature" upsell.
  if (perms.settled && !perms.can("view_growth")) return <NoAccess what="Growth" />;

  return (
    <Screen testID="growth-screen">
      <OwnerHeader title="Growth" subtitle="Kaun se ghante kam bharte hain, aap ki venue ki apni bookings se." />
      {showSwitcher ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {venues.map((v) => (
            <Chip key={v.id} label={v.name} selected={v.id === activeVenueId} onPress={() => setVenueId(v.id)} />
          ))}
        </View>
      ) : null}

      {!flags.on("growth_suggestions") ? (
        <EmptyState title="Growth suggestions abhi band hain" body="Ye feature Khelo ne abhi sab ke liye band kiya hua hai." icon={TrendingUp} />
      ) : venuesLoading || query.isLoading ? (
        <SkeletonCard />
      ) : ineligible ? (
        <EmptyState
          title="Growth suggestions premium feature hai"
          body={`Premium mein "Growth suggestions" on karein: phir ${activeVenue?.name ?? "venue"} ke kam bharne wale ghante aur un ke idea yahan dikhenge.`}
          icon={Crown}
          actionLabel="Premium kholein"
          onAction={() => router.push("/(owner)/premium")}
        />
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : suggestions.length === 0 ? (
        <EmptyState title="Kuch hafton baad dekhein" body="Kam az kam kuch hafton ki bookings ke baad hi kam bharne wale ghante pehchane ja sakte hain." icon={TrendingUp} />
      ) : (
        <>
          <View testID="growth-heatmap" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3], boxShadow: shadow.card }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space[2] }}>
              <Text variant="bodyStrong">Hafte ke kam bharne wale ghante</Text>
              <Text variant="caption" tone="muted">{`Pichle ${weeks} hafte`}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <View style={{ width: 44 }} />
              {DAY_SHORT.map((d) => (
                <Text key={d} variant="caption" weight="bold" tone="muted" align="center" style={{ flex: 1 }}>
                  {d}
                </Text>
              ))}
            </View>
            {grid.hours.map((h) => (
              <View key={h} style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                <Text variant="caption" weight="bold" tone="muted" style={{ width: 44 }}>
                  {hourText(h)}
                </Text>
                {DAY_SHORT.map((_, d) => {
                  const c = grid.cell(d, h);
                  return (
                    <View
                      key={d}
                      accessible
                      accessibilityLabel={c ? `${DAY_LONG[d]} ${hourText(h)}: sirf ${pct(c.rate)} bharta hai` : `${DAY_LONG[d]} ${hourText(h)}: koi signal nahi`}
                      style={{ flex: 1, height: 30, borderRadius: 6, backgroundColor: c ? palette.waitingTint : palette.ground, borderWidth: c ? 1 : 0, borderStyle: "dashed", borderColor: palette.waitingBorder, alignItems: "center", justifyContent: "center" }}
                    >
                      {c ? (
                        <Text variant="tab" tone="waiting">
                          {pct(c.rate)}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: palette.waitingTint, borderWidth: 1, borderStyle: "dashed", borderColor: palette.waitingBorder }} />
                <Text variant="caption" tone="body">
                  Kam bharta (% = kitna bharta hai)
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: palette.ground }} />
                <Text variant="caption" tone="body">
                  Koi signal nahi
                </Text>
              </View>
            </View>
          </View>

          <Text variant="title" accessibilityRole="header">
            Ideas
          </Text>
          {suggestions.map((s) => {
            const c = activeVenue?.courts.find((x) => x.id === s.court_id);
            return (
              <View key={`${s.court_id}-${s.day_of_week}-${s.hour}`} style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[4], gap: space[2] }}>
                <Pill size="sm" tone="waiting" label="Khaali slot" />
                <Text variant="bodyStrong">{`${DAY_LONG[s.day_of_week] ?? "Ye din"} ${hourText(s.hour)} · ${c ? courtLabel(c.name, c.sport) : "Court"} sirf ${pct(s.booking_rate)} bharta hai`}</Text>
                <Text variant="body" tone="muted">{`Aap ki venue ki average ${pct(s.venue_average)} hai. ${s.suggestion}`}</Text>
                <Text variant="caption" tone="subtle">{`${s.weeks_of_data} hafte ke data par`}</Text>
              </View>
            );
          })}
          <Text variant="caption" tone="muted">
            Suggestion server ki apni likhai hai. Discount ki raqam ya ek tap se offer abhi app mein nahi.
          </Text>
        </>
      )}
    </Screen>
  );
}
