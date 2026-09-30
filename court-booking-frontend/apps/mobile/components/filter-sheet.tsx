import { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { AMENITY_OPTIONS, SPORT_OPTIONS, formatDuration, formatTime24As12, pktDayTabs } from "@court-booking/types";

import {
  DURATION_OPTIONS,
  EMPTY_FILTERS,
  FILTER_DATE_DAYS,
  START_TIME_OPTIONS,
  filterProblems,
  type VenueFilters,
} from "@/lib/venue-filters";
import { LocationPinIcon } from "@/components/icons";

const WEB_NO_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined;

function Pill({ label, selected, onPress, minWidth }: { label: string; selected: boolean; onPress: () => void; minWidth?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className="px-4 rounded-full items-center justify-center"
      style={{ minHeight: 40, minWidth, backgroundColor: selected ? "#141A1D" : "#F4EFEC" }}
    >
      <Text className="font-figtree-semibold text-[13px]" style={{ color: selected ? "#FFFFFF" : "#5C544D" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="gap-2.5">
      <View className="gap-0.5">
        <Text className="font-figtree-bold text-[11px] tracking-[0.1em] text-player-ink-fainter">{title.toUpperCase()}</Text>
        {hint ? <Text className="font-figtree-medium text-player-ink-faint text-[12px]">{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View className="flex-1 gap-1.5">
      <Text className="font-figtree-semibold text-player-ink-muted text-[12px]">{label}</Text>
      <View className="h-12 px-3 rounded-[12px] bg-player-surface-2 flex-row items-center gap-1.5">
        <Text className="font-mono-medium text-player-ink-faint text-[13px]">PKR</Text>
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          accessibilityLabel={label}
          placeholder="Any"
          placeholderTextColor="#A39A92"
          className="flex-1 font-mono-medium text-player-ink text-[15px]"
          // web only: drop the browser focus outline (the rounded wrapper is the visual field)
          style={[{ height: 48 }, WEB_NO_OUTLINE]}
        />
      </View>
    </View>
  );
}

/**
 * The discovery filter sheet. It edits a DRAFT and only applies on "Show results", so the list does not reload on every tap.
 * The applied filters live in the search screen's route params (see lib/venue-filters.ts).
 */
export function FilterSheet({
  initial,
  areas,
  resultHint,
  onApply,
  onClose,
}: {
  initial: VenueFilters;
  areas: string[];
  resultHint?: string;
  onApply: (next: VenueFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<VenueFilters>(initial);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const patch = (p: Partial<VenueFilters>) => setDraft((d) => ({ ...d, ...p }));
  const problems = filterProblems(draft);
  const blocked = !!(problems.price || problems.date);
  // Dates run from today (Pakistan calendar, never the UTC date) to the default booking horizon.
  const days = pktDayTabs(FILTER_DATE_DAYS);

  async function useMyLocation() {
    setLocationError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location permission was denied, so we can't sort by distance. Pick an area below instead.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      patch({ near: true, lat: pos.coords.latitude, lng: pos.coords.longitude, area: undefined });
    } catch {
      setLocationError("Couldn't get your location. Check that location is turned on, or pick an area below.");
    } finally {
      setLocating(false);
    }
  }

  function toggleAmenity(key: string) {
    patch({ amenities: draft.amenities.includes(key) ? draft.amenities.filter((k) => k !== key) : [...draft.amenities, key] });
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose}>
        <Pressable className="bg-player-surface rounded-t-3xl pt-5" style={{ maxHeight: "92%" }} onPress={(e) => e.stopPropagation?.()}>
          <View className="flex-row items-center justify-between px-5 pb-3">
            <Text className="font-figtree-extrabold text-player-ink text-[19px] -tracking-[0.3px]">Filters</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close filters" className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
              <Text className="font-figtree-bold text-player-ink text-base">✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerClassName="px-5 pb-4 gap-6" keyboardShouldPersistTaps="handled">
            <Section title="Sport">
              <View className="flex-row flex-wrap gap-2">
                <Pill label="Any" selected={!draft.sport} onPress={() => patch({ sport: undefined })} />
                {SPORT_OPTIONS.map((s) => (
                  <Pill key={s} label={s} selected={draft.sport === s} onPress={() => patch({ sport: draft.sport === s ? undefined : s })} />
                ))}
              </View>
            </Section>

            <Section title="Where">
              <Pressable
                onPress={useMyLocation}
                disabled={locating}
                accessibilityLabel="Use my current location"
                className="flex-row items-center gap-2 self-start px-4 h-11 rounded-full"
                style={{ backgroundColor: draft.near ? "#141A1D" : "#F4EFEC" }}
              >
                {locating ? <ActivityIndicator size="small" color="#EF5A2C" /> : <LocationPinIcon size={15} color={draft.near ? "#FFFFFF" : undefined} />}
                <Text className="font-figtree-semibold text-[13px]" style={{ color: draft.near ? "#FFFFFF" : "#5C544D" }}>
                  {locating ? "Locating…" : draft.near ? "Using my location (nearest first)" : "Use my current location"}
                </Text>
              </Pressable>
              {locationError ? <Text className="font-figtree-medium text-[12.5px]" style={{ color: "#A8432C" }}>{locationError}</Text> : null}
              <View className="flex-row flex-wrap gap-2">
                <Pill label="Anywhere" selected={!draft.area && !draft.near} onPress={() => patch({ area: undefined, near: false, lat: undefined, lng: undefined })} />
                {areas.map((a) => (
                  <Pill key={a} label={a} selected={draft.area === a} onPress={() => patch({ area: draft.area === a ? undefined : a, near: false, lat: undefined, lng: undefined })} />
                ))}
              </View>
            </Section>

            <Section title="Price per slot" hint="PKR, the lowest slot price at the venue.">
              <View className="flex-row gap-3">
                <PriceInput label="Minimum" value={draft.minPrice} onChange={(v) => patch({ minPrice: v })} />
                <PriceInput label="Maximum" value={draft.maxPrice} onChange={(v) => patch({ maxPrice: v })} />
              </View>
              {problems.price ? <Text className="font-figtree-medium text-[12.5px]" style={{ color: "#A8432C" }}>{problems.price}</Text> : null}
            </Section>

            <Section title="Indoor / outdoor">
              <View className="flex-row gap-2">
                <Pill label="Either" selected={!draft.indoor} onPress={() => patch({ indoor: undefined })} />
                <Pill label="Indoor" selected={draft.indoor === "indoor"} onPress={() => patch({ indoor: "indoor" })} />
                <Pill label="Outdoor" selected={draft.indoor === "outdoor"} onPress={() => patch({ indoor: "outdoor" })} />
              </View>
            </Section>

            <Section title="Amenities" hint="A venue must have all of the ones you pick.">
              <View className="flex-row flex-wrap gap-2">
                {AMENITY_OPTIONS.map((a) => (
                  <Pill key={a.key} label={a.label} selected={draft.amenities.includes(a.key)} onPress={() => toggleAmenity(a.key)} />
                ))}
              </View>
            </Section>

            <Section title="Free at" hint="Only venues with a court free at that time.">
              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerClassName="gap-2 pb-2">
                <Pill label="Any day" selected={!draft.date} onPress={() => patch({ date: undefined, time: undefined, duration: undefined })} />
                {days.map((d, i) => (
                  <Pill
                    key={d.date}
                    label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${d.weekday} ${d.day} ${d.month}`}
                    selected={draft.date === d.date}
                    minWidth={72}
                    onPress={() => patch({ date: d.date })}
                  />
                ))}
              </ScrollView>
              {draft.date ? (
                <>
                  <Text className="font-figtree-semibold text-player-ink-muted text-[12px]">Start time</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator contentContainerClassName="gap-2 pb-2">
                    <Pill label="Any time" selected={!draft.time} onPress={() => patch({ time: undefined, duration: undefined })} />
                    {START_TIME_OPTIONS.map((t) => (
                      <Pill key={t} label={formatTime24As12(t)} selected={draft.time === t} minWidth={72} onPress={() => patch({ time: t })} />
                    ))}
                  </ScrollView>
                </>
              ) : null}
              {draft.date && draft.time ? (
                <>
                  <Text className="font-figtree-semibold text-player-ink-muted text-[12px]">For how long (optional)</Text>
                  <View className="flex-row gap-2">
                    <Pill label="Any" selected={!draft.duration} onPress={() => patch({ duration: undefined })} />
                    {DURATION_OPTIONS.map((m) => (
                      <Pill key={m} label={formatDuration(m)} selected={draft.duration === m} onPress={() => patch({ duration: m })} />
                    ))}
                  </View>
                </>
              ) : null}
              {draft.date && !draft.time ? (
                <Text className="font-figtree-medium text-player-ink-faint text-[12px]">Pick a start time to filter by availability.</Text>
              ) : null}
            </Section>
          </ScrollView>

          <View className="flex-row gap-3 px-5 pt-3 pb-6 border-t border-player-border-light">
            <Pressable onPress={() => setDraft({ ...EMPTY_FILTERS })} accessibilityLabel="Clear all filters" className="h-[52px] px-5 rounded-[14px] border border-player-border-light items-center justify-center">
              <Text className="font-figtree-bold text-player-ink text-[14.5px]">Clear all</Text>
            </Pressable>
            <Pressable
              onPress={() => !blocked && onApply(draft)}
              disabled={blocked}
              accessibilityLabel="Show results"
              className="flex-1 h-[52px] rounded-[14px] items-center justify-center"
              style={{ backgroundColor: blocked ? "#D8D2CB" : "#EF5A2C" }}
            >
              <Text className="font-figtree-bold text-white text-[14.5px]">{resultHint ?? "Show results"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
