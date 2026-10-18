import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryStatusFilter } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { addDays, daysOfMonth, formatDayHeader, formatPKR, monthOf, pktDateString, weekOf } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OV, STATUS_FILTERS } from "@/lib/overview";
import { ChevronLeftIcon, SearchIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { BookingCard } from "@/components/overview/booking-card";
import { DateChooserSheet, MultiSelectSheet, courtsSummary } from "@/components/overview/pickers";
import { OutlineButton, Pill, SelectButton } from "@/components/overview/ui";

type Preset = "aaj" | "kal" | "hafta" | "mahina" | "custom";

function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = pktDateString();
  if (p === "aaj") return { from: today, to: today };
  if (p === "kal") {
    const y = addDays(today, -1);
    return { from: y, to: y };
  }
  if (p === "hafta") {
    const w = weekOf(today);
    return { from: w[0], to: w[6] };
  }
  const days = daysOfMonth(monthOf(today));
  return { from: days[0], to: days[days.length - 1] };
}

function detectPreset(from: string, to: string): Preset {
  for (const p of ["aaj", "kal", "hafta", "mahina"] as const) {
    const r = presetRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

const PAGE_SIZE = 20;

/** Bookings history: date range (presets + custom), courts, statuses, search; paginated card list with a totals strip. */
export default function HistoryScreen() {
  const params = useLocalSearchParams<{ from?: string; to?: string; courts?: string; status?: string; q?: string; booking?: string }>();
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const today = pktDateString();
  const [from, setFrom] = useState(params.from ?? today);
  const [to, setTo] = useState(params.to ?? params.from ?? today);
  const [courtIds, setCourtIds] = useState<string[]>(params.courts ? params.courts.split(",").filter(Boolean) : []);
  const [statuses, setStatuses] = useState<string[]>(params.status ? params.status.split(",").filter(Boolean) : []);
  const [text, setText] = useState(params.q ?? "");
  const [q, setQ] = useState(params.q ?? "");
  const [sheet, setSheet] = useState<null | "from" | "to" | "courts" | "status">(null);
  // A2: a `booking` param scrolls to and highlights that card; it never opens a popup here.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(params.booking ?? null);
  const [focusOnly, setFocusOnly] = useState<boolean>(!!params.booking);
  const scrollRef = useRef<ScrollView>(null);
  const listY = useRef(0);
  const cardY = useRef(new Map<string, number>());
  useEffect(() => {
    if (!params.booking) return;
    setHighlight(params.booking);
    setFocusOnly(true);
    if (params.from) setFrom(params.from);
    if (params.to || params.from) setTo(params.to ?? params.from ?? today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.booking]);
  const preset = detectPreset(from, to);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search (the server is hit once the typing pauses).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQ(text.trim()), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);

  const allCourts = (activeVenue?.courts ?? []).filter((c) => c.is_active !== false);

  const query = useInfiniteQuery({
    queryKey: ["owner-history", activeVenueId, from, to, courtIds.join(","), statuses.join(","), q],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.owners.bookingsHistory({
        venueId: activeVenueId,
        dateFrom: from <= to ? from : to,
        dateTo: from <= to ? to : from,
        courtIds,
        statuses: statuses as HistoryStatusFilter[],
        q: q || undefined,
        page: pageParam,
        pageSize: PAGE_SIZE,
      }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: !!activeVenueId,
  });

  const allItems = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  // The focused booking may sit on a later page (or outside the range): its own detail row is the fallback.
  const focusDetail = useQuery({
    queryKey: ["owner-booking-detail", highlight],
    queryFn: () => api.owners.bookingDetail(highlight as string),
    enabled: !!highlight && focusOnly && !!query.data && !allItems.some((r) => r.booking_id === highlight),
  });
  const items = useMemo(() => {
    if (!focusOnly || !highlight) return allItems;
    const mine = allItems.filter((r) => r.booking_id === highlight);
    if (mine.length) return mine;
    return focusDetail.data ? [focusDetail.data.row] : [];
  }, [allItems, focusOnly, highlight, focusDetail.data]);

  function clearFocus() {
    setFocusOnly(false);
    setTimeout(() => {
      const y = highlight ? cardY.current.get(highlight) : undefined;
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, listY.current + y - 12), animated: true });
    }, 150);
  }
  const first = query.data?.pages[0];
  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  function setPreset(p: Preset) {
    if (p === "custom") {
      setSheet("from");
      return;
    }
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4 py-4 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(owner)/today"))}
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center"
        >
          <ChevronLeftIcon />
        </Pressable>
        <View className="flex-1">
          <Text className="font-plex-bold text-owner-ink text-[20px] -tracking-[0.3px]" accessibilityRole="header">
            Bookings history
          </Text>
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            {from === to ? formatDayHeader(from) : `${formatDayHeader(from)} - ${formatDayHeader(to)}`}
          </Text>
        </View>
      </View>

      {focusOnly && highlight ? (
        <View testID="history-focus-banner" className="px-4 py-2.5 bg-owner-accent-soft flex-row items-center justify-between gap-3">
          <Text className="flex-1 font-plex-semibold text-owner-ink text-[12.5px]">Sirf ye booking dikhayi ja rahi hai</Text>
          <Pressable onPress={clearFocus} accessibilityRole="button" accessibilityLabel="Filter hatayen" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text className="font-plex-bold text-owner-accent text-[13px] underline">Filter hatayen</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView ref={scrollRef} className="flex-1" contentContainerClassName="px-4 pt-4 pb-10 gap-3.5" keyboardShouldPersistTaps="handled">
        <View className="flex-row flex-wrap gap-2">
          <Pill label="Aaj" selected={preset === "aaj"} onPress={() => setPreset("aaj")} />
          <Pill label="Kal" selected={preset === "kal"} onPress={() => setPreset("kal")} />
          <Pill label="Is hafte" selected={preset === "hafta"} onPress={() => setPreset("hafta")} />
          <Pill label="Is mahine" selected={preset === "mahina"} onPress={() => setPreset("mahina")} />
          <Pill label="Custom" selected={preset === "custom"} onPress={() => setPreset("custom")} />
        </View>
        {preset === "custom" ? (
          <View className="flex-row gap-3">
            <View className="flex-1">
              <SelectButton label="Se" value={formatDayHeader(from)} onPress={() => setSheet("from")} />
            </View>
            <View className="flex-1">
              <SelectButton label="Tak" value={formatDayHeader(to)} onPress={() => setSheet("to")} />
            </View>
          </View>
        ) : null}
        <SelectButton label="Courts" value={courtsSummary(courtIds, allCourts)} onPress={() => setSheet("courts")} disabled={allCourts.length === 0} />
        <SelectButton
          label="Status"
          value={statuses.length === 0 ? "Sab status" : statuses.map((s) => STATUS_FILTERS.find((f) => f.key === s)?.label ?? s).join(", ")}
          onPress={() => setSheet("status")}
        />
        <View
          className="flex-row items-center gap-2 rounded-xl bg-owner-surface px-3.5"
          style={{ minHeight: 52, borderWidth: 1.5, borderColor: OV.border }}
        >
          <SearchIcon />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Naam, phone ya booking ID"
            placeholderTextColor={OV.faint}
            accessibilityLabel="Search"
            autoCapitalize="none"
            returnKeyType="search"
            className="flex-1 font-plex-medium text-owner-ink text-[15px]"
          />
        </View>

        {first ? (
          <View className="flex-row justify-between rounded-2xl bg-owner-surface px-4 py-3" style={{ borderWidth: 1.5, borderColor: OV.border }}>
            <Total label="Bookings" value={String(first.totals.count)} />
            <Total label="Total" value={formatPKR(first.totals.total)} />
            <Total label="Collected" value={formatPKR(first.totals.collected)} />
            <Total label="Due" value={formatPKR(first.totals.due)} color={first.totals.due > 0 ? OV.red : undefined} />
          </View>
        ) : null}

        {venuesLoading || query.isLoading ? (
          <View className="py-14 items-center">
            <ActivityIndicator color={OV.accent} />
          </View>
        ) : forbidden ? (
          <Text className="font-plex-medium text-owner-danger text-[14px] py-6">Aapke paas bookings history dekhne ki ijazat nahi hai.</Text>
        ) : query.isError && !query.data ? (
          <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
        ) : items.length === 0 && !(focusOnly && focusDetail.isFetching) ? (
          <View className="py-12 items-center gap-1">
            <Text className="font-plex-bold text-owner-ink text-[16px]">Koi booking nahi mili</Text>
            <Text className="font-plex-medium text-owner-ink-faint text-[13px] text-center">Tareekh ya filter badal kar dekhein.</Text>
          </View>
        ) : (
          <View className="gap-3.5" onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
            {items.map((row) => (
              <View
                key={`${row.booking_id}:${row.kind}:${row.status_key}`}
                testID={highlight === row.booking_id ? "history-highlighted" : undefined}
                onLayout={(e) => {
                  if (!cardY.current.has(row.booking_id) || row.kind === "booked") cardY.current.set(row.booking_id, e.nativeEvent.layout.y);
                }}
              >
                <BookingCard
                  row={row}
                  highlighted={highlight === row.booking_id}
                  onOpen={() => setDetailId(row.booking_id)}
                  onOpenOriginal={() => row.original_booking_id && setDetailId(row.original_booking_id)}
                />
              </View>
            ))}
            {focusOnly && highlight ? null : query.hasNextPage ? (
              <OutlineButton label={query.isFetchingNextPage ? "Load ho raha hai" : "Aur dikhao"} onPress={() => query.fetchNextPage()} />
            ) : (
              <Text className="font-plex-medium text-owner-ink-faint text-[12.5px] text-center">{`${first?.total ?? items.length} mein se sab dikha diye`}</Text>
            )}
          </View>
        )}
      </ScrollView>

      {sheet === "from" || sheet === "to" ? (
        <DateChooserSheet
          title={sheet === "from" ? "Shuru ki tareekh" : "Aakhri tareekh"}
          value={sheet === "from" ? from : to}
          onClose={() => setSheet(null)}
          onPick={(d) => {
            if (sheet === "from") {
              setFrom(d);
              if (d > to) setTo(d);
              setSheet("to");
            } else {
              setTo(d);
              if (d < from) setFrom(d);
              setSheet(null);
            }
          }}
        />
      ) : null}
      {sheet === "courts" ? (
        <MultiSelectSheet
          title="Courts chunein"
          allLabel={`Sab courts (${allCourts.length})`}
          options={allCourts.map((c) => ({ id: c.id, label: c.name, sub: c.sport }))}
          value={courtIds}
          onClose={() => setSheet(null)}
          onApply={(ids) => {
            setCourtIds(ids);
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === "status" ? (
        <MultiSelectSheet
          title="Status chunein"
          allLabel="Sab status"
          exclusiveFromAll
          options={STATUS_FILTERS.map((f) => ({ id: f.key, label: f.label }))}
          value={statuses}
          onClose={() => setSheet(null)}
          onApply={(ids) => {
            setStatuses(ids);
            setSheet(null);
          }}
        />
      ) : null}
      {detailId ? (
        <BookingDetailSheet bookingId={detailId} hideHistoryLink onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} />
      ) : null}
    </SafeAreaView>
  );
}

function Total({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="items-start gap-0.5">
      <Text className="font-plex-medium text-owner-ink-muted text-[11.5px]">{label}</Text>
      <Text className="font-mono-semibold text-[14px]" style={{ color: color ?? OV.ink }}>
        {value}
      </Text>
    </View>
  );
}
