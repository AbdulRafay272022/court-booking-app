import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { addMonths, daysOfMonth, formatMonth, monthOf, mondayFirstWeekdayOf, pktDateString } from "@/lib/format";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { OV } from "@/lib/overview";
import { BottomSheet, Checkbox, OrangeButton, OutlineButton } from "./ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A JS date chooser (no native module): month grid, Monday first, any date past or future. Pakistan dates only. */
export function DateChooserSheet({
  title = "Tareekh chunein",
  value,
  onPick,
  onClose,
}: {
  title?: string;
  value: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(monthOf(value));
  const today = pktDateString();
  const days = daysOfMonth(month);
  const lead = mondayFirstWeekdayOf(days[0]);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <BottomSheet
      title={title}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Aaj" onPress={() => onPick(today)} />
          <OrangeButton flex label="Band karein" onPress={onClose} />
        </View>
      }
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => setMonth(addMonths(month, -1))}
          accessibilityLabel="Pichla mahina"
          className="w-11 h-11 rounded-xl border border-owner-border items-center justify-center"
        >
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16px]" accessibilityRole="header">
          {formatMonth(month)}
        </Text>
        <Pressable
          onPress={() => setMonth(addMonths(month, 1))}
          accessibilityLabel="Agla mahina"
          className="w-11 h-11 rounded-xl border border-owner-border items-center justify-center"
        >
          <ChevronRightIcon />
        </Pressable>
      </View>
      <View className="flex-row">
        {WEEKDAYS.map((d) => (
          <Text key={d} className="flex-1 text-center font-plex-semibold text-owner-ink-faint text-[11.5px]">
            {d}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row gap-1">
          {week.map((d, di) => {
            if (!d) return <View key={di} className="flex-1" style={{ height: 44 }} />;
            const selected = d === value;
            return (
              <Pressable
                key={d}
                onPress={() => onPick(d)}
                accessibilityRole="button"
                accessibilityLabel={d}
                accessibilityState={{ selected }}
                className="flex-1 items-center justify-center rounded-xl"
                style={{
                  height: 44,
                  backgroundColor: selected ? OV.accent : "transparent",
                  borderWidth: d === today && !selected ? 1.5 : 0,
                  borderColor: OV.accent,
                }}
              >
                <Text className="font-plex-semibold text-[14px]" style={{ color: selected ? "#FFFFFF" : OV.ink }}>
                  {Number(d.slice(8))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </BottomSheet>
  );
}

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
}

/** Multi-select with checkboxes. `value` empty = everything ("Sab"). */
export function MultiSelectSheet({
  title,
  options,
  value,
  allLabel,
  onApply,
  onClose,
}: {
  title: string;
  options: PickOption[];
  value: string[];
  allLabel: string;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(value));
  const allSelected = picked.size === 0 || picked.size === options.length;

  function toggle(id: string) {
    const next = new Set(allSelected ? options.map((o) => o.id) : picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next.size === options.length ? new Set() : next);
  }

  // An empty selection with some options means "all"; refuse to apply an impossible "none".
  return (
    <BottomSheet
      title={title}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Cancel" onPress={onClose} />
          <OrangeButton flex label="Lagayein" onPress={() => onApply([...picked])} />
        </View>
      }
    >
      <Checkbox checked={allSelected} label={allLabel} onPress={() => setPicked(new Set())} />
      {options.map((o) => (
        <Checkbox key={o.id} checked={allSelected || picked.has(o.id)} label={o.label} sub={o.sub} onPress={() => toggle(o.id)} />
      ))}
    </BottomSheet>
  );
}

/** "Sab courts (8)" / "Court 1" / "3 courts". */
export function courtsSummary(selected: string[], courts: { id: string; name: string }[]): string {
  if (selected.length === 0 || selected.length >= courts.length) return `Sab courts (${courts.length})`;
  if (selected.length === 1) return courts.find((c) => c.id === selected[0])?.name ?? "1 court";
  return `${selected.length} courts`;
}
