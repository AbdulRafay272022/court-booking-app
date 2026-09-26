import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, formatMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

// Palette from the approved mockup (calendar-redesign-mockup.html).
const OPEN = "#1E9E5A";
const LIMITED = "#D6900A";
const FULL = "#C43A3A";
const CLOSED_RING = "#B9B2AA";
const NOHOURS_INK = "#9A9791";
const ACCENT = "#EF5A2C";
const CELL_BG: Partial<Record<DaySummaryState, string>> = { open: "#E3F7EB", few: "#FBEED9", full: "#FBE6E6" };
const DOT_COLOR: Partial<Record<DaySummaryState, string>> = { open: OPEN, few: LIMITED, full: FULL };

const LEGEND: { state: DaySummaryState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "few", label: "Filling up" },
  { state: "full", label: "Fully booked" },
  { state: "closed", label: "Closed that day" },
];

/** Diagonal-hatch fill for a no-hours day, matching the web CSS repeating-linear-gradient (RN has no CSS
 * gradients, so we draw it with an SVG pattern). Clipped to the cell's rounded corners by the parent's overflow. */
function HatchFill() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="nohours-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(135)">
          <Rect width="8" height="8" fill="#F3EEE9" />
          <Rect width="4" height="8" fill="#EDE7E1" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#nohours-hatch)" />
    </Svg>
  );
}

/**
 * A single court's month calendar (Section 32 Part 4b; visual redesign post-batch #5, matching the owner's
 * approved mockup): soft-tinted state cells, a hollow ring for "closed", and a diagonal-hatch "no hours set"
 * state with a callout when a court has no schedule. The calendar-first interaction is unchanged.
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

  const hasBookable = (summary?.days ?? []).some((d) => d.state === "open" || d.state === "few" || d.state === "full");
  const noHours = !!summary && !hasBookable;

  return (
    <View className="gap-2.5">
      <View className="flex-row items-center justify-between">
        <NavButton dir="prev" disabled={prevDisabled} onPress={() => setMonth((m) => addMonths(m, -1))} />
        <Text className="font-figtree-extrabold text-player-ink text-[16px]">{formatMonth(month)}</Text>
        <NavButton dir="next" disabled={nextDisabled} onPress={() => setMonth((m) => addMonths(m, 1))} />
      </View>

      <View className="flex-row mb-1">
        {WEEKDAY_HEADERS.map((h, i) => (
          <View key={i} style={{ width: "14.28%" }} className="items-center">
            <View className="rounded-md items-center justify-center" style={{ width: 24, height: 20, backgroundColor: "#F3EEE9" }}>
              <Text className="font-figtree-bold text-player-ink-faint text-[10px]">{h}</Text>
            </View>
          </View>
        ))}
      </View>

      {summaryQuery.isLoading ? (
        <View className="py-10 items-center">
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <View key={`b${i}`} style={{ width: "14.28%" }} className="aspect-square" />
            ))}
            {dates.map((date) => {
              const state = dayByDate.get(date)?.state ?? "closed";
              const isPast = state === "past" || state === "beyond";
              const isNoHours = noHours && !isPast;
              const tappable = !isPast && !isNoHours;
              const isToday = date === today;
              const dotColor = DOT_COLOR[state];
              return (
                <View key={date} style={{ width: "14.28%" }} className="aspect-square p-0.5">
                  <Pressable
                    disabled={!tappable}
                    onPress={() => onSelectDate(date)}
                    accessibilityLabel={`${date}, ${isNoHours ? "no hours set" : state}`}
                    className="flex-1 rounded-[10px] items-center justify-center overflow-hidden"
                    style={{
                      backgroundColor: isNoHours ? "transparent" : CELL_BG[state] ?? "transparent",
                      borderWidth: 2,
                      borderColor: isToday ? ACCENT : "transparent",
                      opacity: isPast ? 0.45 : 1,
                    }}
                  >
                    {isNoHours ? <HatchFill /> : null}
                    <Text
                      className="font-figtree-semibold text-[12.5px]"
                      style={{ color: isPast || isNoHours ? NOHOURS_INK : "#141A1D" }}
                    >
                      {Number(date.slice(8))}
                    </Text>
                    {isNoHours ? (
                      // no-hours cells carry the hatch only — no dot or dash under the number
                      <View style={{ width: 6, height: 6, marginTop: 3 }} />
                    ) : isPast ? (
                      <View style={{ width: 6, height: 6, marginTop: 3 }} />
                    ) : dotColor ? (
                      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 3, backgroundColor: dotColor }} />
                    ) : state === "closed" ? (
                      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 3, borderWidth: 1.5, borderColor: CLOSED_RING }} />
                    ) : (
                      <View style={{ width: 6, height: 6, marginTop: 3 }} />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          {noHours ? (
            <>
              <View className="flex-row flex-wrap mt-4 pt-3.5" style={{ borderTopWidth: 1, borderTopColor: "#E5DED8", borderStyle: "dashed" }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#EDE7E1", borderWidth: 1, borderColor: NOHOURS_INK }} />
                  <Text className="text-[12px] font-figtree-semibold text-player-ink-faint">No hours set for this court</Text>
                </View>
              </View>
              <View className="rounded-xl px-4 py-3.5 mt-4" style={{ backgroundColor: "#FDECE5", borderWidth: 1, borderColor: "#f3cdb9" }}>
                <Text className="text-[13.5px]" style={{ color: "#8a3417" }}>
                  This court hasn't set its opening hours yet — check back soon or message the venue.
                </Text>
              </View>
            </>
          ) : (
            <View className="flex-row flex-wrap mt-4 pt-3.5" style={{ borderTopWidth: 1, borderTopColor: "#E5DED8", borderStyle: "dashed", columnGap: 14, rowGap: 8 }}>
              {LEGEND.map(({ state, label }) => (
                <View key={state} className="flex-row items-center" style={{ gap: 6 }}>
                  {state === "closed" ? (
                    <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: CLOSED_RING }} />
                  ) : (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DOT_COLOR[state] }} />
                  )}
                  <Text className="text-[12px] font-figtree-semibold text-player-ink-faint">{label}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function NavButton({ dir, disabled, onPress }: { dir: "prev" | "next"; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={dir === "prev" ? "Previous month" : "Next month"}
      className="w-7 h-7 rounded-lg items-center justify-center"
      style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5DED8", opacity: disabled ? 0.35 : 1 }}
    >
      <Text className="text-[13px]" style={{ color: "#5C544D" }}>{dir === "prev" ? "‹" : "›"}</Text>
    </Pressable>
  );
}
