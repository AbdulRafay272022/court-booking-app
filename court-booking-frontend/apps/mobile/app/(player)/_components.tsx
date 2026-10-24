/**
 * Local Floodlight building blocks for the PLAYER screens (not a route: the leading underscore keeps expo-router away).
 * Everything here is built from @/components/ui + @court-booking/ui-tokens (no hex). Candidates to promote into
 * components/ui are listed in the M1 report: DateTile, DayChip, PhotoHero.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { FlatList, Linking, Modal, Platform, Pressable, Share, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react-native";
import { alpha, palette, radius, size, space } from "@court-booking/ui-tokens";
import { pktDateString, pktParts, type Booking } from "@court-booking/types";

import { CourtPlaceholder, IconButton, OfflineBanner, Text, useCopy, useEffectiveFontScale, useRoleTheme, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useNetworkStatus } from "@/lib/network-status";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { FAVORITES_KEY, useFavorites } from "@/lib/use-favorites";

const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MO = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** A clock that ticks (for "past slot" checks and hold timers). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/* ------------------------------------------------------------------ favourites */

/** Saved state + toggle for VenueCard hearts (optimistic; flips back and says so when the call fails). */
export function useFavoriteToggle() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const copy = useCopy();
  const { enabled, ids } = useFavorites();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const isSaved = (id: string) => pending[id] ?? ids.has(id);
  async function toggle(id: string) {
    if (!enabled || pending[id] !== undefined) return;
    const next = !ids.has(id);
    setPending((p) => ({ ...p, [id]: next }));
    try {
      if (next) await api.favorites.add(id);
      else await api.favorites.remove(id);
      await queryClient.invalidateQueries({ queryKey: FAVORITES_KEY });
    } catch (e) {
      toast.show({ message: `${copy("Save nahi ho saka", "Couldn't update saved venues")}: ${friendlyErrorMessage(e)}`, tone: "danger" });
    } finally {
      setPending((p) => {
        const { [id]: _drop, ...rest } = p;
        return rest;
      });
    }
  }
  return { enabled, isSaved, toggle };
}

/* ------------------------------------------------------------------ booking context */

/** Court + venue of a booking (the booking embeds neither: contract section (c)). Shared cache keys with the rest of the app. */
export function useBookingPlace(booking: Pick<Booking, "court_id"> | null | undefined) {
  const courtQuery = useQuery({ queryKey: ["court", booking?.court_id], queryFn: () => api.courts.get(booking!.court_id), enabled: !!booking?.court_id });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  return { court: courtQuery.data ?? null, venue: venueQuery.data ?? null, loading: courtQuery.isLoading || venueQuery.isLoading };
}

export function sportLabel(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ outbound links */

export function openDirections(v: { latitude?: number | null; longitude?: number | null; address?: string | null; name: string }) {
  const q = v.latitude != null && v.longitude != null ? `${v.latitude},${v.longitude}` : encodeURIComponent([v.name, v.address].filter(Boolean).join(", "));
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
}

/** The venue's own WhatsApp (or phone) number, when the owner gave one. */
export function venueWhatsApp(v: { whatsapp?: string | null; phone?: string | null } | null | undefined): string | null {
  const raw = v?.whatsapp || v?.phone || null;
  const digits = raw ? raw.replace(/[^0-9]/g, "") : "";
  return digits.length >= 10 ? digits : null;
}

export function openVenueWhatsApp(digits: string, text?: string) {
  void Linking.openURL(`https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`);
}

export async function shareText(message: string) {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && "share" in navigator) {
      await (navigator as Navigator & { share: (d: { text: string }) => Promise<void> }).share({ text: message });
      return;
    }
    await Share.share({ message });
  } catch {
    // cancelled
  }
}

/* ------------------------------------------------------------------ date tile */

/** Board date block ("SAT / 24 / OCT"): orange (next game, Status) or soft ground (lists). Never a colour-only cue. */
export function DateTile({ iso, variant = "soft", month = false }: { iso: string; variant?: "orange" | "soft" | "night"; month?: boolean }) {
  const t = useRoleTheme();
  const p = pktParts(iso);
  const bg = variant === "orange" ? t.primary.bg : variant === "night" ? palette.night : palette.ground;
  const fg = variant === "orange" ? t.primary.fg : variant === "night" ? palette.white : palette.night;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ minWidth: 56, minHeight: 60, paddingHorizontal: 6, paddingVertical: 6, borderRadius: radius.input, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}
    >
      <Text variant="eyebrow" weight="black" color={fg}>
        {WD[p.weekday]}
      </Text>
      <Text variant="h3" color={fg}>
        {String(p.day)}
      </Text>
      {month ? (
        <Text variant="caption" weight="bold" color={fg}>
          {MO[p.month]}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ day chip */

export type DayState = "open" | "few" | "full" | "closed" | "past" | "beyond" | null;

/** Venue step 2 "Din" chip: weekday, date, availability dot (+ spoken state, so the dot is never the only cue). */
export function DayChip({ date, selected, state, onPress, testID }: { date: string; selected: boolean; state: DayState; onPress: () => void; testID?: string }) {
  const t = useRoleTheme();
  const copy = useCopy();
  const today = pktDateString();
  const tomorrow = pktDateString(Date.now() + 86_400_000);
  const p = pktParts(`${date}T12:00:00+05:00`);
  const top = date === today ? copy("AAJ", "TODAY") : date === tomorrow ? copy("KAL", "TMRW") : WD[p.weekday];
  const dot = state === "open" ? palette.teal : state === "few" ? palette.waiting : state === "full" || state === "closed" ? palette.danger : null;
  const stateWord =
    state === "open"
      ? copy("khaali slots", "open slots")
      : state === "few"
        ? copy("thore slots", "few slots left")
        : state === "full"
          ? copy("full", "full")
          : state === "closed"
            ? copy("band", "closed")
            : "";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[`${WD[p.weekday]} ${p.day} ${MO[p.month]}`, stateWord].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 52,
        minHeight: 70,
        paddingHorizontal: 4,
        paddingVertical: 6,
        borderRadius: radius.md,
        backgroundColor: selected ? t.selected.bg : palette.ground,
        borderWidth: 2,
        borderColor: selected ? t.selected.border : "transparent",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text variant="tab" weight="black" align="center">
        {top}
      </Text>
      <Text variant="cta" align="center">
        {String(p.day)}
      </Text>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot ?? "transparent" }} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ venue photo hero */

/**
 * Venue board hero: swipeable real photos (NO autoplay on the detail page), "1 / N tasveerein" counter, tap = full-screen
 * gallery. No photo = the court-line placeholder (never a fake photo). Floating glass buttons are passed in `top`.
 */
export function PhotoHero({ photos, name, seed, height = 300, top }: { photos: string[]; name: string; seed: string; height?: number; top?: ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const copy = useCopy();
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  return (
    <View style={{ height, backgroundColor: palette.night }}>
      {photos.length === 0 ? (
        <CourtPlaceholder seed={seed} width={width} height={height} />
      ) : (
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u, i) => `${i}-${u}`}
          onMomentumScrollEnd={onEnd}
          onScrollEndDrag={Platform.OS === "web" ? onEnd : undefined}
          renderItem={({ item, index: i }) => (
            <Pressable
              onPress={() => setFull(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel={copy(`${name} ki ${photos.length} photos, photo ${i + 1}. Bari dekhein`, `${name}, ${photos.length} photos, photo ${i + 1}. Open full screen`)}
            >
              <Image source={{ uri: item }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" />
            </Pressable>
          )}
        />
      )}
      <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + space[2], left: space[4], right: space[4] }}>
        {top}
      </View>
      {photos.length > 0 ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", right: space[4], bottom: 40, minHeight: 30, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: alpha.onPhoto, borderWidth: 1, borderColor: alpha.onPhotoBorder, justifyContent: "center" }}
        >
          <Text variant="caption" weight="black" tone="onDark">
            {photos.length > 1 ? copy(`${index + 1} / ${photos.length} tasveerein`, `${index + 1} / ${photos.length} photos`) : copy("1 tasveer", "1 photo")}
          </Text>
        </View>
      ) : null}
      <Modal visible={full} transparent={false} animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={{ flex: 1, backgroundColor: palette.night }}>
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.min(index, Math.max(0, photos.length - 1))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(u, i) => `full-${i}-${u}`}
            renderItem={({ item }) => <Image source={{ uri: item }} style={{ width, height: "100%" }} contentFit="contain" />}
          />
          <View style={{ position: "absolute", top: insets.top + space[3], right: space[4] }}>
            <IconButton icon={X} variant="onDark" accessibilityLabel={copy("Band karein", "Close")} onPress={() => setFull(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ misc */

/** Section title + optional right element, Bricolage (board h2). */
export function BlockTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" }}>
      <Text variant="h3" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Numbered step heading (Venue "1 Court chunein", Pay "1 PKR 4,000 bhejein"). */
export function StepHeading({ n, label, right }: { n: number; label: string; right?: ReactNode }) {
  const t = useRoleTheme();
  const scale = useEffectiveFontScale();
  const d = Math.round(24 * Math.min(scale, 1.4));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexShrink: 1 }}>
        <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: t.primary.bg, alignItems: "center", justifyContent: "center" }}>
          <Text variant="caption" weight="black" color={t.primary.fg}>
            {String(n)}
          </Text>
        </View>
        <Text variant="bodyBold" weight="black" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {label}
        </Text>
      </View>
      {right}
    </View>
  );
}

/* ------------------------------------------------------------------ offline + status bar */

const OnlineContext = createContext(true);

/** ONE /health poller for the whole player (or auth) group; screens read it with usePlayerOnline(). */
export function PlayerNetworkProvider({ children }: { children: ReactNode }) {
  const online = useNetworkStatus();
  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>;
}
export function usePlayerOnline(): boolean {
  return useContext(OnlineContext);
}

/** PStates frame 3 in the flow of the page (never covers the header buttons): "Internet nahi hai" + Retry (refetch). */
export function PlayerOfflineBanner() {
  const online = usePlayerOnline();
  const queryClient = useQueryClient();
  return <OfflineBanner visible={!online} placement="inline" onRetry={() => void queryClient.refetchQueries({ type: "active" })} />;
}

/** Night-hero screens want light status-bar text while focused (the root sets "dark"). */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");
      return () => setStatusBarStyle("dark");
    }, []),
  );
}

/** Signed-in player's first name (for "Salam, Ali"). */
export function useFirstName(): string | null {
  const name = useAuthStore((s) => s.user?.name);
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

export const TAP = size.tap;

/** A list from an API response, or [] when the payload is not a list (never crash a screen on a malformed reply). */
export function asList<T>(v: T[] | null | undefined | unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
