/**
 * PSearch "Filters" bottom sheet (Floodlight Sheet), also used by the Home search pill (Khel / Kab / Kitni der only).
 * Edits a DRAFT and applies on the footer button; the applied filters live in the search route params (lib/venue-filters).
 * Only the existing GET /venues filter params are offered. Not a route (leading underscore).
 */
import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { LocateFixed } from "lucide-react-native";
import { AMENITY_OPTIONS, SPORT_OPTIONS, amenityLabel, formatDuration, formatTime24As12, pktDayTabs } from "@court-booking/types";
import { palette, space } from "@court-booking/ui-tokens";

import { Banner, Button, Chip, Input, Sheet, Text, useCopy, useLang } from "@/components/ui";
import { api } from "@/lib/api";
import { DURATION_OPTIONS, EMPTY_FILTERS, START_TIME_OPTIONS, filterProblems, filtersToQuery, type VenueFilters } from "@/lib/venue-filters";

export const DEFAULT_CITY = "Karachi";
const DAY_CHIPS = 14;

export type FilterSection = "sport" | "where" | "when" | "price" | "indoor" | "amenities";
const ALL: FilterSection[] = ["sport", "where", "when", "price", "indoor", "amenities"];

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ gap: 2 }}>
        <Text variant="eyebrow" tone="muted" accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const Wrap = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{children}</View>;

export function FiltersSheet({
  open,
  initial,
  sections = ALL,
  title,
  onApply,
  onClose,
}: {
  open: boolean;
  initial: VenueFilters;
  sections?: FilterSection[];
  title?: string;
  onApply: (next: VenueFilters) => void;
  onClose: () => void;
}) {
  const copy = useCopy();
  const lang = useLang();
  const [draft, setDraft] = useState<VenueFilters>(initial);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const patch = (p: Partial<VenueFilters>) => setDraft((d) => ({ ...d, ...p }));
  const problems = filterProblems(draft);
  const blocked = !!(problems.price || problems.date);
  const has = (s: FilterSection) => sections.includes(s);
  const days = pktDayTabs(DAY_CHIPS, new Date(), lang);

  const areasQuery = useQuery({ queryKey: ["venue-areas"], queryFn: () => api.venues.areas(), staleTime: 5 * 60_000, enabled: open && has("where") });
  // Live count for the apply button: the same list call the results screen makes (real data, not a guess).
  const countQuery = useQuery({
    queryKey: ["venue-search", filtersToQuery(draft, DEFAULT_CITY)],
    queryFn: () => api.venues.list(filtersToQuery(draft, DEFAULT_CITY)),
    enabled: open && !blocked,
  });
  const count = countQuery.data?.venues.length;

  async function useMyLocation() {
    setLocationError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError(copy("Location ki ijazat nahi mili. Neeche se ilaqa chunein.", "Location permission was denied. Pick an area below instead."));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      patch({ near: true, lat: pos.coords.latitude, lng: pos.coords.longitude, area: undefined });
    } catch {
      setLocationError(copy("Location nahi mili. Location on karein ya ilaqa chunein.", "Couldn't get your location. Turn location on, or pick an area."));
    } finally {
      setLocating(false);
    }
  }

  const applyLabel = blocked
    ? copy("Pehle upar theek karein", "Fix the values above first")
    : count === undefined
      ? copy("Venues dikhao", "Show venues")
      : copy(`${count} venues dikhao`, `Show ${count} venues`);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? copy("Filters", "Filters")}
      testID="filters-sheet"
      footer={
        <View style={{ flexDirection: "row", gap: space[3], flexWrap: "wrap" }}>
          <Button
            label={copy("Sab saaf", "Clear all")}
            variant="soft"
            size="md"
            onPress={() => setDraft({ ...EMPTY_FILTERS })}
            testID="filters-clear"
          />
          <View style={{ flex: 1, minWidth: 160 }}>
            <Button label={applyLabel} block size="md" disabled={blocked} onPress={() => onApply(draft)} testID="filters-apply" />
          </View>
        </View>
      }
    >
      {has("sport") ? (
        <Group title={copy("Khel", "Sport")}>
          <Wrap>
            <Chip label={copy("Koi bhi", "Any")} selected={!draft.sport} onPress={() => patch({ sport: undefined })} />
            {SPORT_OPTIONS.map((s) => (
              <Chip key={s} label={s} selected={draft.sport === s} onPress={() => patch({ sport: draft.sport === s ? undefined : s })} testID={`filter-sport-${s}`} />
            ))}
          </Wrap>
        </Group>
      ) : null}

      {has("where") ? (
        <Group title={copy("Kahan", "Where")}>
          <Button
            label={draft.near ? copy("✓ Meri location ke qareeb", "✓ Near my location") : copy("Meri location ke qareeb", "Near my location")}
            variant="soft"
            size="sm"
            loading={locating}
            icon={<LocateFixed size={16} color={palette.night} />}
            onPress={() => (draft.near ? patch({ near: false, lat: undefined, lng: undefined }) : useMyLocation())}
          />
          {locationError ? <Banner tone="waiting" body={locationError} /> : null}
          <Wrap>
            <Chip label={copy(`Poora ${DEFAULT_CITY}`, `All of ${DEFAULT_CITY}`)} selected={!draft.area && !draft.near} onPress={() => patch({ area: undefined, near: false, lat: undefined, lng: undefined })} />
            {(areasQuery.data?.areas ?? []).map((a) => (
              <Chip key={a} label={a} selected={draft.area === a} onPress={() => patch({ area: draft.area === a ? undefined : a, near: false, lat: undefined, lng: undefined })} />
            ))}
          </Wrap>
        </Group>
      ) : null}

      {has("when") ? (
        <Group title={copy("Kab", "When")} hint={copy("Sirf wo venues jin ka court us waqt khaali ho.", "Only venues with a court free at that time.")}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
            <Chip label={copy("Koi bhi din", "Any day")} selected={!draft.date} onPress={() => patch({ date: undefined, time: undefined, duration: undefined })} />
            {days.map((d, i) => (
              <Chip
                key={d.date}
                label={i === 0 ? copy("Aaj", "Today") : i === 1 ? copy("Kal", "Tomorrow") : `${d.weekday} ${d.day} ${d.month}`}
                selected={draft.date === d.date}
                onPress={() => patch({ date: d.date })}
                testID={`filter-day-${i}`}
              />
            ))}
          </ScrollView>
          {draft.date ? (
            <>
              <Text variant="label">{copy("Kis waqt", "What time")}</Text>
              <Wrap>
                <Chip label={copy("Koi bhi waqt", "Any time")} selected={!draft.time} onPress={() => patch({ time: undefined, duration: undefined })} />
                {START_TIME_OPTIONS.map((t) => (
                  <Chip key={t} label={formatTime24As12(t)} selected={draft.time === t} onPress={() => patch({ time: t })} testID={`filter-time-${t}`} />
                ))}
              </Wrap>
            </>
          ) : null}
          {draft.date && draft.time ? (
            <>
              <Text variant="label">{copy("Kitni der", "How long")}</Text>
              <Wrap>
                <Chip label={copy("Koi bhi", "Any")} selected={!draft.duration} onPress={() => patch({ duration: undefined })} />
                {DURATION_OPTIONS.map((m) => (
                  <Chip key={m} label={formatDuration(m, lang)} selected={draft.duration === m} onPress={() => patch({ duration: m })} testID={`filter-dur-${m}`} />
                ))}
              </Wrap>
            </>
          ) : null}
          {problems.date ? <Banner tone="danger" body={problems.date} /> : null}
        </Group>
      ) : null}

      {has("price") ? (
        <Group title={copy("Qeemat (fi slot)", "Price (per slot)")} hint={copy("PKR, venue ka sab se sasta slot.", "PKR, the venue's lowest slot price.")}>
          <View style={{ flexDirection: "row", gap: space[3], flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 130 }}>
              <Input label={copy("Kam se kam", "Minimum")} prefix="PKR" keyboardType="number-pad" value={draft.minPrice} onChangeText={(v) => patch({ minPrice: v.replace(/[^0-9]/g, "") })} placeholder={copy("Koi bhi", "Any")} />
            </View>
            <View style={{ flex: 1, minWidth: 130 }}>
              <Input label={copy("Zyada se zyada", "Maximum")} prefix="PKR" keyboardType="number-pad" value={draft.maxPrice} onChangeText={(v) => patch({ maxPrice: v.replace(/[^0-9]/g, "") })} placeholder={copy("Koi bhi", "Any")} />
            </View>
          </View>
          {problems.price ? <Banner tone="danger" body={problems.price} /> : null}
        </Group>
      ) : null}

      {has("indoor") ? (
        <Group title={copy("Indoor / outdoor", "Indoor / outdoor")}>
          <Wrap>
            <Chip label={copy("Dono", "Either")} selected={!draft.indoor} onPress={() => patch({ indoor: undefined })} />
            <Chip label="Indoor" selected={draft.indoor === "indoor"} onPress={() => patch({ indoor: "indoor" })} />
            <Chip label="Outdoor" selected={draft.indoor === "outdoor"} onPress={() => patch({ indoor: "outdoor" })} />
          </Wrap>
        </Group>
      ) : null}

      {has("amenities") ? (
        <Group title={copy("Amenities", "Amenities")} hint={copy("Venue mein ye sab hon.", "The venue must have all of these.")}>
          <Wrap>
            {AMENITY_OPTIONS.map((a) => (
              <Chip
                key={a.key}
                label={amenityLabel(a.key, lang)}
                selected={draft.amenities.includes(a.key)}
                onPress={() => patch({ amenities: draft.amenities.includes(a.key) ? draft.amenities.filter((k) => k !== a.key) : [...draft.amenities, a.key] })}
              />
            ))}
          </Wrap>
        </Group>
      ) : null}
    </Sheet>
  );
}
