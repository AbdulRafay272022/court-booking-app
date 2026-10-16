import { ActivityIndicator, Text, View } from "react-native";
import { useQueries } from "@tanstack/react-query";
import type { Slot } from "@court-booking/types";

import { api } from "@/lib/api";
import { formatDayHeader, formatTime } from "@/lib/format";
import { OV } from "@/lib/overview";
import { BottomSheet } from "./ui";

type Look = { label: string; bg: string; fg: string; border: string; dashed?: boolean };

function look(slot: Slot, now: number): Look {
  if (slot.status === "booked") return { label: "Booked", bg: OV.accent, fg: "#FFFFFF", border: OV.accent };
  if (slot.status === "held" || slot.status === "payment_submitted") return { label: "Pending", bg: OV.amberBg, fg: OV.amberDark, border: OV.amberBorder };
  if (slot.status === "blocked") return { label: "Blocked", bg: "#E3E9EB", fg: OV.muted, border: "#C6D2D7" };
  if (new Date(slot.ends_at).getTime() < now) return { label: "Past", bg: "#F4F6F7", fg: OV.faint, border: OV.border, dashed: true };
  return { label: "Free", bg: "#FFFFFF", fg: OV.ink, border: OV.faint, dashed: true };
}

const LEGEND: Look[] = [
  { label: "Booked", bg: OV.accent, fg: "#FFFFFF", border: OV.accent },
  { label: "Pending", bg: OV.amberBg, fg: OV.amberDark, border: OV.amberBorder },
  { label: "Blocked", bg: "#E3E9EB", fg: OV.muted, border: "#C6D2D7" },
  { label: "Free", bg: "#FFFFFF", fg: OV.ink, border: OV.faint, dashed: true },
  { label: "Past", bg: "#F4F6F7", fg: OV.faint, border: OV.border, dashed: true },
];

/** "Sab slots dekho": every slot of the selected day, grouped by court. Availability is fetched only while this sheet is mounted. */
export function SlotsSheet({
  date,
  courts,
  onClose,
}: {
  date: string;
  courts: { id: string; name: string }[];
  onClose: () => void;
}) {
  const results = useQueries({
    queries: courts.map((c) => ({
      queryKey: ["owner-overview-slots", c.id, date],
      queryFn: () => api.availability.forCourtOnDate(c.id, date),
    })),
  });
  const now = Date.now();

  return (
    <BottomSheet title="Sab slots" subtitle={formatDayHeader(date)} onClose={onClose} tall>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1.5 pb-1">
        {LEGEND.map((l) => (
          <View key={l.label} className="flex-row items-center gap-1.5">
            <View
              style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: l.bg, borderWidth: 1.5, borderColor: l.border, borderStyle: l.dashed ? "dashed" : "solid" }}
            />
            <Text className="font-plex-medium text-owner-ink-muted text-[12px]">{l.label}</Text>
          </View>
        ))}
      </View>
      {courts.map((c, i) => {
        const r = results[i];
        return (
          <View key={c.id} className="gap-2 mt-2">
            <Text className="font-plex-bold text-owner-ink text-[15px]">{c.name}</Text>
            {r.isLoading ? (
              <ActivityIndicator color={OV.accent} />
            ) : r.isError || !r.data ? (
              <Text className="font-plex-medium text-owner-danger text-[12.5px]">Slots load nahi ho sake.</Text>
            ) : r.data.slots.length === 0 ? (
              <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">Is din band hai.</Text>
            ) : (
              <View className="flex-row flex-wrap gap-1.5">
                {r.data.slots.map((s) => {
                  const l = look(s, now);
                  return (
                    <View
                      key={s.starts_at}
                      accessibilityLabel={`${formatTime(s.starts_at)} ${l.label}`}
                      className="px-2.5 items-center justify-center rounded-lg"
                      style={{ minHeight: 40, backgroundColor: l.bg, borderWidth: 1.5, borderColor: l.border, borderStyle: l.dashed ? "dashed" : "solid" }}
                    >
                      <Text className="font-mono-semibold text-[12px]" style={{ color: l.fg }}>
                        {formatTime(s.starts_at)}
                      </Text>
                      <Text className="font-plex-medium text-[9.5px]" style={{ color: l.fg }}>
                        {l.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </BottomSheet>
  );
}
