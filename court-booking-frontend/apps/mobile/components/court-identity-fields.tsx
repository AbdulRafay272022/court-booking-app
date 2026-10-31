import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { SLOT_MINUTES_OPTIONS, SPORT_OPTIONS } from "@court-booking/types";
import { fontFamily, palette, radius, space } from "@court-booking/ui-tokens";

import { findSport } from "@/lib/sport";
import { Sheet, Text } from "@/components/ui";
import { Chip, FieldLabel, SectionCard, SectionLabel, TextField, useReadOnly } from "../app/(owner)/venue-setup/_components";

/** Court-level identity: name, sport and indoor/outdoor. Shared by the wizard's court tabs and Venue Settings' court tabs.
 * `sports` limits the sport chips (the venue's offered sports); the court's current sport is always shown so an
 * older court on a sport the venue no longer lists doesn't silently lose its selection. */
export function CourtIdentityFields({
  name,
  sport,
  isIndoor,
  sports,
  onChange,
}: {
  name: string;
  sport: string;
  isIndoor: boolean;
  sports?: readonly string[];
  onChange: (patch: { name?: string; sport?: string; isIndoor?: boolean }) => void;
}) {
  const base = sports && sports.length > 0 ? sports : SPORT_OPTIONS;
  const options = findSport(base, sport) || !sport ? [...base] : [...base, sport];
  const selected = findSport(options, sport);
  return (
    <SectionCard>
      <SectionLabel>Court ki tafseel</SectionLabel>
      <TextField label="Court ka naam" value={name} onChangeText={(v) => onChange({ name: v })} placeholder="Court 1" />
      <View className="gap-2">
        <FieldLabel>Sport</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {options.map((s) => (
            <Chip key={s} label={s} selected={selected === s} onPress={() => onChange({ sport: s })} />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <FieldLabel>Andar ya bahar</FieldLabel>
        <View className="flex-row gap-2">
          <Chip label="Outdoor" selected={!isIndoor} onPress={() => onChange({ isIndoor: false })} />
          <Chip label="Indoor" selected={isIndoor} onPress={() => onChange({ isIndoor: true })} />
        </View>
      </View>
    </SectionCard>
  );
}

/** Multi-select amenity chips (AMENITY_OPTIONS keys). */
export function AmenityPicker({
  value,
  onToggle,
  options,
}: {
  value: readonly string[];
  onToggle: (key: string) => void;
  options: readonly { key: string; label: string }[];
}) {
  return (
    <View className="gap-2">
      <FieldLabel>Sahuliyat</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((a) => (
          <Chip key={a.key} label={a.label} selected={value.includes(a.key)} onPress={() => onToggle(a.key)} />
        ))}
      </View>
    </View>
  );
}

type GridPick = "sport" | "slot" | "place" | null;

/** OSettings board "Court 1 ki tafseel": a 2x2 grid (Naam / Khel / Slot / Jagah). Naam is typed in place; the other three
 * open a small sheet of choices. Slot = the court's minimum booking time. */
export function CourtDetailsGrid({
  name,
  sport,
  isIndoor,
  slotMinutes,
  sports,
  onChange,
  onSlotChange,
  footer,
}: {
  name: string;
  sport: string;
  isIndoor: boolean;
  slotMinutes: number;
  sports?: readonly string[];
  onChange: (patch: { name?: string; sport?: string; isIndoor?: boolean }) => void;
  onSlotChange: (minutes: number) => void;
  /** Under the grid (e.g. what changing the slot does to existing bookings). */
  footer?: React.ReactNode;
}) {
  const readOnly = useReadOnly();
  const [pick, setPick] = useState<GridPick>(null);
  const base = sports && sports.length > 0 ? sports : SPORT_OPTIONS;
  const sportOptions = findSport(base, sport) || !sport ? [...base] : [...base, sport];
  const choices: { label: string; selected: boolean; onPress: () => void }[] =
    pick === "sport"
      ? sportOptions.map((s) => ({ label: cap(s), selected: findSport([s], sport) != null, onPress: () => onChange({ sport: s }) }))
      : pick === "slot"
        ? SLOT_MINUTES_OPTIONS.map((m) => ({ label: `${m} min`, selected: slotMinutes === m, onPress: () => onSlotChange(m) }))
        : pick === "place"
          ? [
              { label: "Outdoor", selected: !isIndoor, onPress: () => onChange({ isIndoor: false }) },
              { label: "Indoor", selected: isIndoor, onPress: () => onChange({ isIndoor: true }) },
            ]
          : [];
  const title = pick === "sport" ? "Khel" : pick === "slot" ? "Kam se kam booking time" : "Jagah";
  return (
    <View testID="court-details-grid" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: 12 }}>
      <Text variant="bodyStrong" accessibilityRole="header">{`${name.trim() || "Court"} ki tafseel`}</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <GridCell label="Naam">
          <TextInput
            value={name}
            onChangeText={(v) => onChange({ name: v })}
            editable={!readOnly}
            placeholder="Court 1"
            placeholderTextColor={palette.muted}
            accessibilityLabel="Court ka naam"
            style={{ flex: 1, minHeight: 44, fontFamily: fontFamily.mobile.bodyBold, fontSize: 15, color: palette.night, paddingVertical: 0 }}
          />
        </GridCell>
        <GridCell label="Khel" value={cap(sport)} onPress={readOnly ? undefined : () => setPick("sport")} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <GridCell label="Slot" value={`${slotMinutes} min`} onPress={readOnly ? undefined : () => setPick("slot")} />
        <GridCell label="Jagah" value={isIndoor ? "Indoor" : "Outdoor"} onPress={readOnly ? undefined : () => setPick("place")} />
      </View>
      {footer}
      <Sheet open={pick !== null} onClose={() => setPick(null)} title={title} testID="court-grid-sheet">
        <View style={{ gap: space[2] }}>
          {choices.map((c) => (
            <Pressable
              key={c.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: c.selected }}
              onPress={() => {
                c.onPress();
                setPick(null);
              }}
              style={{
                minHeight: 52,
                borderRadius: 14,
                paddingHorizontal: space[4],
                justifyContent: "center",
                backgroundColor: c.selected ? palette.tealTint : palette.ground,
                borderWidth: c.selected ? 2 : 0,
                borderColor: palette.teal,
              }}
            >
              <Text variant="bodyBold">{`${c.selected ? "✓ " : ""}${c.label}`}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function GridCell({ label, value, onPress, children }: { label: string; value?: string; onPress?: () => void; children?: React.ReactNode }) {
  const box = {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palette.lineStrong,
    paddingHorizontal: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  };
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Text variant="caption" weight="bold" tone="muted">
        {label}
      </Text>
      {children ? (
        <View style={box}>{children}</View>
      ) : (
        <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={box}>
          <Text variant="bodyBold" numberOfLines={1} style={{ flex: 1, fontSize: 15 }}>
            {value}
          </Text>
          {onPress ? <ChevronDown size={16} color={palette.muted} /> : null}
        </Pressable>
      )}
    </View>
  );
}
