import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, formatMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

// green = open, amber = almost full, red = fully booked; closed gets a hollow ring instead of a filled dot.
const DOT_COLOR: Partial<Record<DaySummaryState, string>> = {
  open: "#1F7A52",
  few: "#B5730B",
  full: "#B3261E",
};

/**
 * A single court's month calendar (Section 32 Part 4b): every day of the shown month gets a dot for its
 * availability state. Each instance owns its own month/navigation state -- courts do not share a page-level
 * week strip or month anymore. Reused both inline on the venue page (the default view) and inside the day
 * popup's "back to month" view.
 */
export function CourtMonthCalendar({
  courtId,
  onSelectDate,
  onSummary,
}: {
  courtId: string;
  onSelectDate: (date: string) => void;
  onSummary?: (summary: CourtMonthSummary) => void;
}) {
  const todayMonth = useMemo(() => monthOf(pktDateString()), []);
  const [month, setMonth] = useState(todayMonth);

  const summaryQuery = useQuery({
    queryKey: ["court-month-summary", courtId, month],
    queryFn: async () => {
      const summary = await api.availability.monthSummary(courtId, month);
      onSummary?.(summary);
      return summary;
    },
  });
  const summary = summaryQuery.data;
  const dayByDate = new Map((summary?.days ?? []).map((d) => [d.date, d]));
  const dates = daysOfMonth(month);
  const leadingBlanks = mondayFirstWeekdayOf(dates[0]);
  const today = pktDateString();

  const prevDisabled = month <= todayMonth;
  const nextDisabled = summary ? addMonths(month, 1) > monthOf(summary.last_bookable_date) : true;

  return (
    <View className="gap-2.5">
      <View className="flex-row items-center justify-between">
        <Pressable
          disabled={prevDisabled}
          onPress={() => setMonth((m) => addMonths(m, -1))}
          accessibilityLabel="Previous month"
          className="w-9 h-9 rounded-lg items-center justify-center"
          style={{ opacity: prevDisabled ? 0.3 : 1, backgroundColor: "#F4EFEC" }}
        >
          <Text className="font-figtree-bold text-player-ink text-[16px]">‹</Text>
        </Pressable>
        <Text className="font-figtree-bold text-player-ink text-[13.5px]">{formatMonth(month)}</Text>
        <Pressable
          disabled={nextDisabled}
          onPress={() => setMonth((m) => addMonths(m, 1))}
          accessibilityLabel="Next month"
          className="w-9 h-9 rounded-lg items-center justify-center"
          style={{ opacity: nextDisabled ? 0.3 : 1, backgroundColor: "#F4EFEC" }}
        >
          <Text className="font-figtree-bold text-player-ink text-[16px]">›</Text>
        </Pressable>
      </View>

      <View className="flex-row">
        {WEEKDAY_HEADERS.map((h, i) => (
          <View key={i} style={{ width: "14.28%" }} className="items-center">
            <Text className="font-figtree-semibold text-player-ink-fainter text-[10.5px]">{h}</Text>
          </View>
        ))}
      </View>

      {summaryQuery.isLoading ? (
        <View className="py-8 items-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : (
        <View className="flex-row flex-wrap">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <View key={`b${i}`} style={{ width: "14.28%" }} className="aspect-square" />
          ))}
          {dates.map((date) => {
            const day = dayByDate.get(date);
            const state = day?.state ?? "closed";
            const tappable = state !== "past" && state !== "beyond";
            const isToday = date === today;
            const dotColor = DOT_COLOR[state];
            return (
              <Pressable
                key={date}
                disabled={!tappable}
                onPress={() => onSelectDate(date)}
                accessibilityLabel={date}
                style={{ width: "14.28%" }}
                className="aspect-square items-center justify-center gap-1"
              >
                <View
                  className="w-7 h-7 rounded-full items-center justify-center"
                  style={{ backgroundColor: isToday ? "#141A1D" : "transparent" }}
                >
                  <Text
                    className="font-mono-semibold text-[12.5px]"
                    style={{ color: isToday ? "#FFFFFF" : tappable ? "#141A1D" : "#C2BAB2" }}
                  >
                    {Number(date.slice(8))}
                  </Text>
                </View>
                {dotColor ? (
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
                ) : state === "closed" ? (
                  <View className="w-1.5 h-1.5 rounded-full" style={{ borderWidth: 1, borderColor: "#C9C2BC" }} />
                ) : (
                  <View className="w-1.5 h-1.5" />
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
