import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { bookingHorizonText, upcomingBlackouts, weeklyHoursLines } from "@court-booking/types";
import type { Court } from "@court-booking/types";

import { api } from "@/lib/api";

/**
 * "When can I book this court?" for the player venue screen: weekly booking hours (12-hour Pakistan time, overnight
 * and 24-hour courts spelled out, closed days listed), the booking horizon, and closed/unavailable periods still
 * ahead. The schedule comes with the venue; blackouts from the public GET /courts/{id}/blackouts.
 */
export function CourtHoursPanel({ court, horizonDays }: { court: Court; horizonDays: number | null | undefined }) {
  const blackoutsQuery = useQuery({
    queryKey: ["court-blackouts", court.id],
    queryFn: () => api.courts.listBlackouts(court.id),
    staleTime: 60_000,
  });
  const lines = weeklyHoursLines(court.schedule_templates ?? []);
  const blackouts = upcomingBlackouts(blackoutsQuery.data ?? []);
  const horizon = bookingHorizonText(horizonDays);

  return (
    <View className="rounded-xl border border-player-border-light px-3.5 py-3 gap-2.5" testID={`court-hours-${court.name}`}>
      <View className="gap-1">
        <Text className="font-figtree-bold text-player-ink-fainter text-[11px] tracking-[1.5px]">BOOKING HOURS</Text>
        {lines.map((l) => (
          <View key={l.days} className="flex-row justify-between gap-3">
            <Text className="font-figtree-semibold text-player-ink-muted text-[13px]">{l.days}</Text>
            <Text
              className={l.closed ? "font-figtree-medium text-player-ink-faint text-[13px]" : "font-mono-semibold text-player-ink text-[12.5px]"}
              style={{ flexShrink: 1, textAlign: "right" }}
            >
              {l.hours}
            </Text>
          </View>
        ))}
      </View>
      {horizon ? <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">{horizon}</Text> : null}
      {blackouts.length > 0 ? (
        <View className="gap-1">
          <Text className="font-figtree-bold text-player-ink-fainter text-[11px] tracking-[1.5px]">CLOSED / UNAVAILABLE</Text>
          {blackouts.map((b) => (
            <Text key={b.id} className="font-figtree-medium text-player-ink-muted text-[13px]">
              <Text className="font-figtree-semibold">{b.label}</Text> · {b.when}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
