import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { formatTime24As12, parseTime24, pktDayTabs, toTime24, type Meridiem, type Time12 } from "@court-booking/types";

/**
 * 12-hour time input for owners, stored and sent as "HH:MM" 24-hour. Tap the field, then pick the hour,
 * the minutes and AM/PM. Replaces free-text "06:00" boxes (Section 32: no owner should type or read 24-hour
 * times). Only chips, so it works the same on iOS, Android and the web target with no native picker module.
 */
const MINUTES = [0, 15, 30, 45, 59];
const DEFAULT_TIME: Time12 = { hour: 6, minute: 0, meridiem: "AM" };
const TEAL = "#0E6274";

function Pill({ label, selected, onPress, minWidth = 44 }: { label: string; selected: boolean; onPress: () => void; minWidth?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="items-center justify-center rounded-lg"
      style={{
        minHeight: 44,
        minWidth,
        paddingHorizontal: 10,
        backgroundColor: selected ? TEAL : "#FFFFFF",
        borderWidth: selected ? 0 : 1,
        borderColor: "#DCE3E6",
      }}
    >
      <Text className="font-plex-semibold text-sm" style={{ color: selected ? "#FFFFFF" : "#5B7079" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TimeField12({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  /** "HH:MM" (24-hour) or "" when optional and unset */
  value: string;
  onChange: (next: string) => void;
  optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseTime24(value);
  const set = (patch: Partial<Time12>) => onChange(toTime24({ ...(parsed ?? DEFAULT_TIME), ...patch }));
  const minutes = parsed && !MINUTES.includes(parsed.minute) ? [...MINUTES, parsed.minute].sort((a, b) => a - b) : MINUTES;

  return (
    <View className="gap-2 flex-1">
      {label ? <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={`${label || "Time"}: ${parsed ? formatTime24As12(value) : "not set"}`}
        className="justify-center"
        style={{
          height: 48,
          paddingHorizontal: 14,
          borderRadius: 9,
          backgroundColor: "#FFFFFF",
          borderWidth: open ? 1.5 : 1,
          borderColor: open ? TEAL : "#DCE3E6",
        }}
      >
        <Text className="font-mono-medium" style={{ fontSize: 15, color: parsed ? "#101C21" : "#8399A1" }}>
          {parsed ? formatTime24As12(value) : optional ? "Any time" : "Set time"}
        </Text>
      </Pressable>
      {open ? (
        <View className="gap-3 p-3 rounded-[10px] border border-owner-border bg-owner-surface">
          <View className="flex-row flex-wrap gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <Pill key={h} label={String(h)} selected={parsed?.hour === h} onPress={() => set({ hour: h })} />
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {minutes.map((m) => (
              <Pill key={m} label={`:${String(m).padStart(2, "0")}`} selected={parsed?.minute === m} onPress={() => set({ minute: m })} />
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {(["AM", "PM"] as Meridiem[]).map((mer) => (
              <Pill key={mer} label={mer} selected={parsed?.meridiem === mer} onPress={() => set({ meridiem: mer })} minWidth={64} />
            ))}
            {optional && parsed ? <Pill label="Clear" selected={false} onPress={() => onChange("")} minWidth={64} /> : null}
            <Pill label="Done" selected={false} onPress={() => setOpen(false)} minWidth={64} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Pick a Pakistan calendar day from today onward as human chips ("Today", "Tomorrow", "Thu 24 Sep").
 * `value` is "YYYY-MM-DD" (or "" when nothing is chosen yet). */
export function DayPicker({ label, value, onChange, days = 21 }: { label: string; value: string; onChange: (next: string) => void; days?: number }) {
  const options = pktDayTabs(days);
  return (
    <View className="gap-2">
      {label ? <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {options.map((d, i) => (
          <Pill
            key={d.date}
            label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${d.weekday} ${d.day} ${d.month}`}
            selected={d.date === value}
            onPress={() => onChange(d.date)}
            minWidth={72}
          />
        ))}
      </ScrollView>
    </View>
  );
}
