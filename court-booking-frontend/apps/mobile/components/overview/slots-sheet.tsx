import { View } from "react-native";
import { useQueries } from "@tanstack/react-query";
import { slotChipState } from "@court-booking/ui-tokens";
import { Skeleton, SlotChip, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { formatDayHeader, formatTime } from "@/lib/format";
import { BottomSheet } from "./ui";

/**
 * "Sab slots dekho": every slot of the selected day, grouped by court, as Floodlight SlotChips (each state has a non-colour
 * cue: strikethrough booked, dashed + hourglass held, dashed + lock closed). Free slots that already started are not shown
 * (same rule as the player side). Availability is fetched only while this sheet is mounted.
 */
export function SlotsSheet({
  date,
  courts,
  onClose,
  onlyFree,
}: {
  date: string;
  courts: { id: string; name: string }[];
  onClose: () => void;
  /** Round 2 (A7): the Overview's "Free" legend opens this sheet showing only the free (upcoming) slots. */
  onlyFree?: boolean;
}) {
  const results = useQueries({
    queries: courts.map((c) => ({
      queryKey: ["owner-overview-slots", c.id, date],
      queryFn: () => api.availability.forCourtOnDate(c.id, date),
    })),
  });
  const now = Date.now();

  return (
    <BottomSheet title={onlyFree ? "Khali slots" : "Sab slots"} subtitle={formatDayHeader(date)} onClose={onClose}>
      <Text variant="caption" tone="muted">
        {onlyFree ? "Sirf aane wale khaali slots." : "Kata hua = booked · dashed + ghari = hold / approval baqi · taala = band. Guzre hue khaali slots nahi dikhaye."}
      </Text>
      {courts.map((c, i) => {
        const r = results[i];
        const chips = (r.data?.slots ?? [])
          .map((s) => ({ s, state: slotChipState({ ...s, is_mine: false }, { now }) }))
          .filter((x) => x.state !== null && (!onlyFree || x.state === "open"));
        return (
          <View key={c.id} style={{ gap: 8 }}>
            <Text variant="bodyStrong">{c.name}</Text>
            {r.isLoading ? (
              <Skeleton height={48} r={14} />
            ) : r.isError || !r.data ? (
              <Text variant="meta" tone="danger">
                Slots load nahi ho sake.
              </Text>
            ) : r.data.slots.length === 0 ? (
              <Text variant="meta" tone="muted">
                Is din band hai.
              </Text>
            ) : chips.length === 0 ? (
              <Text variant="meta" tone="muted">
                {onlyFree ? "Koi khali slot nahi." : "Is din ke sab slots guzar chuke."}
              </Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {chips.map(({ s, state }) => (
                  <SlotChip key={s.starts_at} state={state!} label={formatTime(s.starts_at)} reason={s.reason} />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </BottomSheet>
  );
}
