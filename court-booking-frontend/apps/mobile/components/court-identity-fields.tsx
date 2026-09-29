import { View } from "react-native";
import { SPORT_OPTIONS } from "@court-booking/types";

import { findSport } from "@/lib/sport";
import { Chip, FieldLabel, SectionCard, SectionLabel, TextField } from "../app/(owner)/venue-setup/_components";

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
      <SectionLabel>Court details</SectionLabel>
      <TextField label="Court name" value={name} onChangeText={(v) => onChange({ name: v })} placeholder="Court 1" />
      <View className="gap-2">
        <FieldLabel>Sport</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {options.map((s) => (
            <Chip key={s} label={s} selected={selected === s} onPress={() => onChange({ sport: s })} />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <FieldLabel>Setting</FieldLabel>
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
      <FieldLabel>Amenities</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((a) => (
          <Chip key={a.key} label={a.label} selected={value.includes(a.key)} onPress={() => onToggle(a.key)} />
        ))}
      </View>
    </View>
  );
}
