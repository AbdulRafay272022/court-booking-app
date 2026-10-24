import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppState, FlatList, Pressable, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { Heart, List } from "lucide-react-native";
import {
  activeDot,
  alpha,
  amenitiesChipLabel,
  amenityItems,
  AUTOPLAY_MS,
  carouselLabel,
  carouselMode,
  carouselReducer,
  initialCarousel,
  palette,
  placeholderIndex,
  prefetchIndex,
  radius,
  shadow,
  SLIDE_MS,
  slideCount,
  space,
  timerShouldRun,
  VISIBLE_THRESHOLD,
  type VenueCardData,
} from "@court-booking/ui-tokens";
import { AmenitiesSheet } from "./AmenitiesSheet";
import { IconButton } from "./IconButton";
import { Text } from "./Text";
import { useCopy, useLang, useReduceMotion, useRoleTheme } from "./theme";
import { haptic } from "./haptics";

export type { VenueCardData };

export interface VenueCardTime {
  label: string;
  onPress: () => void;
}

export interface VenueCardProps {
  /** Build with venueCardData(summary, { sport }) from @court-booking/ui-tokens: real API fields only. */
  venue: VenueCardData;
  /** Opens the venue page (whole card + photo). */
  onPress: () => void;
  /** Heart (44pt). Omit onToggleSave to hide it (e.g. owners). */
  saved?: boolean;
  onToggleSave?: () => void;
  /**
   * Is >= 60% of the card on screen? Drive it from the list's viewability (useVenueCardViewability). Autoplay runs ONLY
   * while true; undefined/false = no autoplay (manual swipe still works).
   */
  visible?: boolean;
  /** Optional row of open times (Home "Aaj raat khaali"): real availability only. Shows 3, then "+N". */
  times?: VenueCardTime[];
  onMoreTimes?: () => void;
  /** Card photo height (150 on phone lists). */
  photoHeight?: number;
  testID?: string;
}

const ARTS = [
  "M70 140 100 40h158l30 100zM179 40v100M86 90h186",
  "M20 120h318M40 120V60h278v60M179 60v60",
  "M40 130 179 20l139 110zM179 20v110M110 75h138",
  "M30 40h298v80H30zM179 40v80M30 80h298",
];
function HeartFilled(p: { size?: number; color?: string; strokeWidth?: number }) {
  return <Heart {...p} fill={p.color} />;
}

const PLACEHOLDER_BG = [palette.teal, palette.night, palette.tealDeep, palette.orangeDeep];

/** Photo-less art: court lines on a brand colour (no fake photo). */
export function CourtPlaceholder({ seed, width, height }: { seed: string; width: number; height: number }) {
  const k = placeholderIndex(seed);
  return (
    <View style={{ width, height, backgroundColor: PLACEHOLDER_BG[k] }}>
      <Svg width={width} height={height} viewBox="0 0 358 150" preserveAspectRatio="none">
        <Path d={ARTS[k]} stroke={alpha.courtLines} strokeWidth={2} fill="none" />
      </Svg>
    </View>
  );
}

/** For FlatList / FlashList: `const vis = useVenueCardViewability(); <FlatList {...vis.listProps} renderItem={({item}) => <VenueCard visible={vis.isVisible(item.id)} .../>} />`. */
export function useVenueCardViewability(keyOf: (item: never) => string = (item: { id: string }) => item.id) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const keyRef = useRef(keyOf);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setIds(new Set(viewableItems.filter((v) => v.isViewable && v.item).map((v) => keyRef.current(v.item as never))));
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: VISIBLE_THRESHOLD * 100, minimumViewTime: 150 }).current;
  return { isVisible: (id: string) => ids.has(id), listProps: { onViewableItemsChanged, viewabilityConfig } };
}

function useCarousel(count: number, visible: boolean) {
  const reduce = useReduceMotion();
  const [s, dispatch] = useReducer(carouselReducer, count, (c: number) => initialCarousel(c, { visible, reduceMotion: reduce }));
  useEffect(() => dispatch({ type: "count", count }), [count]);
  useEffect(() => dispatch({ type: "visible", value: visible }), [visible]);
  useEffect(() => dispatch({ type: "reduceMotion", value: reduce }), [reduce]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => dispatch({ type: "appActive", value: st === "active" }));
    return () => sub.remove();
  }, []);
  const running = timerShouldRun(s);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => dispatch({ type: "tick", now: Date.now() }), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [running]);
  return [s, dispatch] as const;
}

/**
 * Shared venue list card (VenueCard.dc.html frame A + venue-card-photos-amenities-prompt.md): photo carousel (0 = court
 * placeholder, 1 = static, >= 2 = 3.5 s autoplay only while visible, pause on touch, resume 6 s after, off with reduce-motion
 * and in background; expo-image memory-disk cache + prefetch of the next photo only), sport chip, optional next-free pill,
 * dots, 44pt heart, name / rating / area / price, ONE "Amenities [n]" chip -> AmenitiesSheet, optional times row.
 */
export function VenueCard({ venue, onPress, saved, onToggleSave, visible = false, times, onMoreTimes, photoHeight = 150, testID }: VenueCardProps) {
  const copy = useCopy();
  const lang = useLang();
  const t = useRoleTheme();
  const [width, setWidth] = useState(0);
  const [amenitiesOpen, setAmenitiesOpen] = useState(false);
  const photos = venue.photos;
  const count = photos.length;
  const mode = carouselMode(count);
  const [s, dispatch] = useCarousel(count, visible);
  const listRef = useRef<FlatList<number>>(null);
  const userDrag = useRef(false);
  const amenities = useMemo(() => amenityItems(venue.amenities, lang), [venue.amenities, lang]);

  // Move the track when the state index changes (autoplay or user goTo).
  useEffect(() => {
    if (!width || mode !== "auto") return;
    listRef.current?.scrollToOffset({ offset: s.index * width, animated: s.animate });
    if (s.index >= count) {
      const id = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        dispatch({ type: "settle" });
      }, SLIDE_MS + 50);
      return () => clearTimeout(id);
    }
  }, [s.index, s.animate, width, mode, count, dispatch]);

  // Prefetch ONLY the next photo.
  useEffect(() => {
    const n = prefetchIndex(s);
    if (n !== null && visible) void Image.prefetch(photos[n], "memory-disk").catch(() => undefined);
  }, [s, photos, visible]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width)), []);
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!userDrag.current || !width) return;
    userDrag.current = false;
    let i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i >= count) {
      i = 0;
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
    const now = Date.now();
    dispatch({ type: "goTo", index: i, now });
    dispatch({ type: "touchEnd", now });
  };

  const dot = activeDot(s);
  const shownTimes = (times ?? []).slice(0, 3);
  const extraTimes = (times?.length ?? 0) - shownTimes.length;
  const meta = [venue.area, venue.distance].filter(Boolean).join(" · ");

  return (
    <View testID={testID ?? "venue-card"} style={{ backgroundColor: palette.white, borderRadius: radius.card, boxShadow: shadow.card }}>
      <View
        onLayout={onLayout}
        accessible={false}
        style={{ height: photoHeight, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, overflow: "hidden", backgroundColor: palette.night }}
      >
        {width > 0 ? (
          mode === "empty" ? (
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={carouselLabel(venue.name, 0, 0, lang)}>
              <CourtPlaceholder seed={venue.id} width={width} height={photoHeight} />
            </Pressable>
          ) : (
            <FlatList
              ref={listRef}
              data={Array.from({ length: slideCount(count) }, (_, i) => i)}
              keyExtractor={(i) => String(i)}
              horizontal
              pagingEnabled
              scrollEnabled={mode === "auto"}
              showsHorizontalScrollIndicator={false}
              bounces={false}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              onScrollBeginDrag={() => {
                userDrag.current = true;
                dispatch({ type: "touchStart", now: Date.now() });
              }}
              onMomentumScrollEnd={onMomentumEnd}
              onScrollEndDrag={() => dispatch({ type: "touchEnd", now: Date.now() })}
              accessibilityLabel={carouselLabel(venue.name, count, dot, lang)}
              renderItem={({ item: i }) => (
                <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={carouselLabel(venue.name, count, i % count, lang)} style={{ width, height: photoHeight }}>
                  <Image
                    source={{ uri: photos[i % count] }}
                    style={{ width, height: photoHeight }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={`${venue.id}-${i}`}
                    transition={0}
                    accessible={false}
                  />
                </Pressable>
              )}
            />
          )
        ) : null}

        {venue.sport ? (
          <View pointerEvents="none" style={{ position: "absolute", left: space[3], top: space[3], minHeight: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: alpha.onPhoto, borderWidth: 1, borderColor: alpha.onPhotoBorder, justifyContent: "center" }}>
            <Text variant="caption" weight="black" tone="onDark">
              {venue.sport}
            </Text>
          </View>
        ) : null}
        {venue.nextFree ? (
          <View pointerEvents="none" style={{ position: "absolute", left: space[3], bottom: space[3], minHeight: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: palette.white, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.nowLine }} />
            <Text variant="caption" weight="black">
              {venue.nextFree}
            </Text>
          </View>
        ) : null}
        {mode === "auto" ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: "absolute", right: space[3], bottom: space[4], height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: alpha.onPhotoStrong, flexDirection: "row", alignItems: "center", gap: 5 }}
          >
            {photos.map((p, i) => (
              <View key={`${p}-${i}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === dot ? palette.white : alpha.dotIdle }} />
            ))}
          </View>
        ) : null}
        {onToggleSave ? (
          <IconButton
            icon={saved ? HeartFilled : Heart}
            variant="onPhoto"
            selected={!!saved}
            accessibilityLabel={saved ? copy(`${venue.name} saved hai, hatayein`, `Remove ${venue.name} from saved`) : copy(`${venue.name} save karein`, `Save ${venue.name}`)}
            onPress={onToggleSave}
            style={{ position: "absolute", right: 10, top: 10 }}
            testID="venue-card-heart"
          />
        ) : null}
      </View>

      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={[venue.name, meta, venue.priceFrom ? `${copy("shuru", "from")} ${venue.priceFrom}` : null].filter(Boolean).join(", ")} style={{ paddingHorizontal: space[4], paddingTop: 14, gap: space[2] }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 150, gap: 3 }}>
            <Text variant="title">{venue.name}</Text>
            {venue.rating !== null || meta ? (
              <Text variant="meta" tone="muted">
                {venue.rating !== null ? (
                  <>
                    {"★ "}
                    <Text variant="meta" weight="black">
                      {venue.rating.toFixed(1)}
                    </Text>
                    {meta ? " · " : ""}
                  </>
                ) : null}
                {meta}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {venue.priceFrom ? (
              <>
                <Text variant="caption" tone="subtle">
                  {copy("shuru", "from")}
                </Text>
                <Text variant="bodyStrong">{venue.priceFrom}</Text>
              </>
            ) : (
              <Text variant="caption" tone="subtle">
                {copy("Price abhi nahi", "No price yet")}
              </Text>
            )}
          </View>
        </View>
      </Pressable>

      <View style={{ paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: 14, gap: space[3] }}>
        {amenities.length > 0 ? (
          <Pressable
            testID="venue-card-amenities"
            accessibilityRole="button"
            accessibilityLabel={amenitiesChipLabel(amenities.length, lang)}
            accessibilityHint={copy("List ki sheet kholta hai", "Opens the list")}
            onPress={() => {
              haptic("selection");
              setAmenitiesOpen(true);
            }}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              minHeight: 44,
              paddingLeft: space[3],
              paddingRight: space[2],
              borderRadius: 22,
              backgroundColor: palette.ground,
              borderWidth: 1,
              borderColor: palette.line,
              flexDirection: "row",
              alignItems: "center",
              gap: space[2],
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <List size={16} color={palette.tealDeep} strokeWidth={2.2} />
            <Text variant="label">Amenities</Text>
            <View style={{ minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 13, backgroundColor: palette.tealTint, alignItems: "center", justifyContent: "center" }}>
              <Text variant="caption" weight="black" color={palette.tealDeep}>
                {String(amenities.length)}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {shownTimes.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {shownTimes.map((tm) => (
              <Pressable
                key={tm.label}
                accessibilityRole="button"
                accessibilityLabel={copy(`${tm.label} khaali, book karein`, `${tm.label} available, book`)}
                onPress={tm.onPress}
                style={{ minHeight: 44, minWidth: 76, paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: t.selected.bg, borderWidth: 1.5, borderColor: t.selected.border, alignItems: "center", justifyContent: "center" }}
              >
                <Text variant="bodyBold" color={t.selected.fg}>
                  {tm.label}
                </Text>
              </Pressable>
            ))}
            {extraTimes > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy(`${extraTimes} aur waqt`, `${extraTimes} more times`)}
                onPress={onMoreTimes ?? onPress}
                style={{ minHeight: 44, minWidth: 56, paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: palette.ground, alignItems: "center", justifyContent: "center" }}
              >
                <Text variant="bodyBold">{`+${extraTimes}`}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {amenities.length > 0 ? <AmenitiesSheet open={amenitiesOpen} onClose={() => setAmenitiesOpen(false)} venueName={venue.name} amenities={venue.amenities} /> : null}
    </View>
  );
}
