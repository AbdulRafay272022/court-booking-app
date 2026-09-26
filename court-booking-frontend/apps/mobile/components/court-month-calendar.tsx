import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, formatMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

// Day-state colours. open/few/full are filled dots; closed is a filled grey dot (an intentional "no play this
// day" marker, not the old hollow ring that read as a loading glitch). past/beyond draw no dot at all.
const DOT_COLOR: Partial<Record<DaySummaryState, string>> = {
  open: "#1F7A52",
  few: "#B5730B",
  full: "#B3261E",
  closed: "#CDC6BF",
};

// The legend that makes the dots self-explanatory (post-batch #5).
const LEGEND: { state: DaySummaryState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "few", label: "Few left" },
  { state: "full", label: "Full" },
  { state: "closed", label: "Closed" },
];

/**
 * A single court's month calendar (Section 32 Part 4b; visual pass post-batch #5): every day of the shown month
 * gets a dot for its availability state, with a legend and a clear empty state when the court has no opening
 * hours yet. Each instance owns its own month/navigation state. Reused inline on the venue page (the default
 * view) and inside the day popup's "back to month" view. The calendar-first interaction is unchanged.
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

  // A court with no active schedule returns every future day as "closed"; there is nothing to book, so we say
  // so plainly rather than filling the grid with markers that look broken.
  const hasBookable = (summary?.days ?? []).some((d) => d.state === "open" || d.state === "few" || d.state === "full");
  const noHours = !!summary && !hasBookable;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          disabled={prevDisabled}
          onPress={() => setMonth((m) => addMonths(m, -1))}
          accessibilityLabel="Previous month"
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ opacity: prevDisabled ? 0.3 : 1, backgroundColor: "#F4EFEC" }}
        >
          <Text className="font-figtree-bold text-player-ink text-[16px]">‹</Text>
        </Pressable>
        <Text className="font-figtree-bold text-player-ink text-[14px]">{formatMonth(month)}</Text>
        <Pressable
          disabled={nextDisabled}
          onPress={() => setMonth((m) => addMonths(m, 1))}
          accessibilityLabel="Next month"
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ opacity: nextDisabled ? 0.3 : 1, backgroundColor: "#F4EFEC" }}
        >
          <Text className="font-figtree-bold text-player-ink text-[16px]">›</Text>
        </Pressable>
      </View>

      <View className="flex-row">
        {WEEKDAY_HEADERS.map((h, i) => (
          <View key={i} style={{ width: "14.28%" }} className="items-center pb-1">
            <Text className="font-figtree-bold text-player-ink-fainter text-[10px]">{h}</Text>
          </View>
        ))}
      </View>

      {summaryQuery.isLoading ? (
        <View className="py-10 items-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <View key={`b${i}`} style={{ width: "14.28%" }} className="aspect-square" />
            ))}
            {dates.map((date) => {
              const state = dayByDate.get(date)?.state ?? "closed";
              const tappable = state !== "past" && state !== "beyond";
              const isToday = date === today;
              const dotColor = DOT_COLOR[state];
              return (
                <Pressable
                  key={date}
                  disabled={!tappable}
                  onPress={() => onSelectDate(date)}
                  accessibilityLabel={`${date}, ${state}`}
                  style={{ width: "14.28%" }}
                  className="aspect-square items-center justify-center gap-1"
                >
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: isToday ? "#141A1D" : "transparent" }}
                  >
                    <Text
                      className="font-mono-semibold text-[12.5px]"
                      style={{ color: isToday ? "#FFFFFF" : tappable ? "#141A1D" : "#C2BAB2" }}
                    >
                      {Number(date.slice(8))}
                    </Text>
                  </View>
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor ?? "transparent" }} />
                </Pressable>
              );
            })}
          </View>

          {noHours ? (
            <View
              className="mt-1 rounded-xl px-3.5 py-3 flex-row items-start gap-2.5"
              style={{ backgroundColor: "#FBF5F1", borderWidth: 1, borderColor: "#F0E6DE" }}
            >
              <Text className="text-[15px] mt-0.5">🕓</Text>
              <Text className="flex-1 text-[12.5px] leading-snug text-player-ink-faint font-figtree">
                This court hasn’t set its opening hours yet, so there are no times to book here.
              </Text>
            </View>
          ) : (
            <View className="mt-0.5 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 6 }}>
              {LEGEND.map(({ state, label }) => (
                <View key={state} className="flex-row items-center" style={{ gap: 6 }}>
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DOT_COLOR[state] }} />
                  <Text className="text-[10.5px] font-figtree-semibold text-player-ink-fainter">{label}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
