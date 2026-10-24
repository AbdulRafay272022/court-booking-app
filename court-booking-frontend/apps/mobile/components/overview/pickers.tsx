import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { IconButton, Text, useRoleTheme } from "@/components/ui";

import { addMonths, daysOfMonth, formatMonth, monthOf, mondayFirstWeekdayOf, pktDateString } from "@/lib/format";
import { BottomSheet, Checkbox, OutlineButton, PrimaryButton } from "./ui";

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
  const t = useRoleTheme();
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
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Aaj" onPress={() => onPick(today)} />
          <PrimaryButton flex label="Band karein" onPress={onClose} />
        </View>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <IconButton icon={ChevronLeft} variant="mist" accessibilityLabel="Pichla mahina" onPress={() => setMonth(addMonths(month, -1))} />
        <Text variant="bodyStrong" accessibilityRole="header">
          {formatMonth(month)}
        </Text>
        <IconButton icon={ChevronRight} variant="mist" accessibilityLabel="Agla mahina" onPress={() => setMonth(addMonths(month, 1))} />
      </View>
      <View style={{ flexDirection: "row" }}>
        {WEEKDAYS.map((d) => (
          <Text key={d} variant="caption" weight="bold" tone="muted" align="center" style={{ flex: 1 }}>
            {d}
          </Text>
        ))}
      </View>
      <View style={{ gap: space[1] }}>
        {weeks.map((week, wi) => (
          <View key={wi} style={{ flexDirection: "row", gap: space[1] }}>
            {week.map((d, di) => {
              if (!d) return <View key={di} style={{ flex: 1, height: 44 }} />;
              const selected = d === value;
              return (
                <Pressable
                  key={d}
                  onPress={() => onPick(d)}
                  accessibilityRole="button"
                  accessibilityLabel={d}
                  accessibilityState={{ selected }}
                  style={{
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.sm,
                    backgroundColor: selected ? t.primary.bg : "transparent",
                    borderWidth: d === today && !selected ? 1.5 : 0,
                    borderColor: palette.teal,
                  }}
                >
                  <Text variant="bodyBold" color={selected ? t.primary.fg : palette.night}>
                    {String(Number(d.slice(8)))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
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
  exclusiveFromAll,
  onApply,
  onClose,
}: {
  title: string;
  options: PickOption[];
  value: string[];
  allLabel: string;
  /** Tapping an option while "all" is on selects just that option (statuses); otherwise it unticks that one (courts). */
  exclusiveFromAll?: boolean;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(value));
  const allSelected = picked.size === 0 || picked.size === options.length;

  function toggle(id: string) {
    if (allSelected && exclusiveFromAll) {
      setPicked(new Set([id]));
      return;
    }
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
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Cancel" onPress={onClose} />
          <PrimaryButton flex label="Lagayein" onPress={() => onApply([...picked])} />
        </View>
      }
    >
      <Checkbox checked={allSelected} label={allLabel} onPress={() => setPicked(new Set())} />
      {options.map((o) => (
        <Checkbox key={o.id} checked={(allSelected && !exclusiveFromAll) || picked.has(o.id)} label={o.label} sub={o.sub} onPress={() => toggle(o.id)} />
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
