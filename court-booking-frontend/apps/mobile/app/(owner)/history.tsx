import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryStatusFilter } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { addDays, daysOfMonth, formatDayHeader, formatPKR, monthOf, pktDateString, weekOf } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { STATUS_FILTERS } from "@/lib/overview";
import { shareCsv } from "@/lib/export-csv";
import { Download, Search } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Input, Screen, SkeletonCard, Text } from "@/components/ui";
import { OwnerHeader, PaisaSwitch } from "./_fl";
import { NoAccess } from "@/components/no-access";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { BookingCard } from "@/components/overview/booking-card";
import { DateChooserSheet, MultiSelectSheet, courtsSummary } from "@/components/overview/pickers";
import { OutlineButton, SelectButton } from "@/components/overview/ui";

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
  const perms = useMyPermissions();
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
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
    enabled: !!activeVenueId && perms.can("view_ledger"),
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

  if (perms.settled && !perms.can("view_ledger")) return <NoAccess what="Bookings history" />;

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.owners.bookingsHistoryCsv({
        venueId: activeVenueId,
        dateFrom: from <= to ? from : to,
        dateTo: from <= to ? to : from,
        courtIds,
        statuses: statuses as HistoryStatusFilter[],
        q: q || undefined,
      });
      await shareCsv(csv, `bookings_${from}_${to}.csv`);
    } catch (e) {
      setExportError(friendlyErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const statusChip = (key: string) => {
    const on = statuses.length === 1 && statuses[0] === key;
    return (
      <Chip
        key={key}
        label={STATUS_FILTERS.find((f) => f.key === key)?.label ?? key}
        selected={on}
        onPress={() => setStatuses(on ? [] : [key])}
      />
    );
  };

  return (
    <Screen scroll={false} gutter={false} testID="history-screen">
      <View style={{ paddingHorizontal: space[4], gap: space[3], paddingBottom: space[2] }}>
        <OwnerHeader
          title="History"
          subtitle={from === to ? formatDayHeader(from) : `${formatDayHeader(from)} - ${formatDayHeader(to)}`}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/(owner)/(tabs)/today"))}
          right={<Button label={exporting ? "Ban raha hai" : "CSV"} variant="soft" size="sm" icon={<Download size={16} color={palette.night} />} onPress={exportCsv} disabled={exporting || !first || first.total === 0} accessibilityLabel="History CSV export karein" />}
        />
        <PaisaSwitch current="history" tone="light" />
      </View>

      {focusOnly && highlight ? (
        <View testID="history-focus-banner" style={{ marginHorizontal: space[4] }}>
          <Banner tone="info" body="Sirf ye booking dikhayi ja rahi hai" action={<Button label="Filter hatayen" variant="soft" size="sm" onPress={clearFocus} accessibilityLabel="Filter hatayen" />} />
        </View>
      ) : null}
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[8], gap: 14 }} keyboardShouldPersistTaps="handled">
        {exportError ? <Banner tone="danger" title="Export nahi hua" body={exportError} /> : null}
        <Input
          label="Search"
          value={text}
          onChangeText={setText}
          placeholder="Naam, phone ya booking ID"
          accessibilityLabel="Search"
          autoCapitalize="none"
          returnKeyType="search"
          trailing={<View style={{ paddingHorizontal: space[3] }}><Search size={18} color={palette.muted} /></View>}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Chip label="Aaj" selected={preset === "aaj"} onPress={() => setPreset("aaj")} />
          <Chip label="Kal" selected={preset === "kal"} onPress={() => setPreset("kal")} />
          <Chip label="Is hafte" selected={preset === "hafta"} onPress={() => setPreset("hafta")} />
          <Chip label="Is mahine" selected={preset === "mahina"} onPress={() => setPreset("mahina")} />
          <Chip label="Custom" selected={preset === "custom"} onPress={() => setPreset("custom")} />
        </View>
        {preset === "custom" ? (
          <View style={{ flexDirection: "row", gap: space[3], flexWrap: "wrap" }}>
            <View style={{ flexGrow: 1, flexBasis: 130 }}>
              <SelectButton label="Se" value={formatDayHeader(from)} onPress={() => setSheet("from")} />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 130 }}>
              <SelectButton label="Tak" value={formatDayHeader(to)} onPress={() => setSheet("to")} />
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel="Jaldi filter">
          <Chip label="Sab" selected={statuses.length === 0} onPress={() => setStatuses([])} />
          {["completed", "short_paid", "cancelled", "status_pending"].map(statusChip)}
        </View>
        <SelectButton label="Courts" value={courtsSummary(courtIds, allCourts)} onPress={() => setSheet("courts")} disabled={allCourts.length === 0} />
        <SelectButton
          label="Status"
          value={statuses.length === 0 ? "Sab status" : statuses.map((s) => STATUS_FILTERS.find((f) => f.key === s)?.label ?? s).join(", ")}
          onPress={() => setSheet("status")}
        />

        {first ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[3], backgroundColor: palette.white, borderRadius: radius.tile, padding: space[4] }}>
            <Total label="Bookings" value={String(first.totals.count)} />
            <Total label="Total" value={formatPKR(first.totals.total)} />
            <Total label="Collected" value={formatPKR(first.totals.collected)} />
            <Total label="Due" value={formatPKR(first.totals.due)} danger={first.totals.due > 0} />
          </View>
        ) : null}

        {venuesLoading || query.isLoading ? (
          <View style={{ gap: space[3] }} accessibilityLabel="Loading">
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : forbidden ? (
          <Banner tone="neutral" body="Aapke paas bookings history dekhne ki ijazat nahi hai." />
        ) : query.isError && !query.data ? (
          <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : items.length === 0 && !(focusOnly && focusDetail.isFetching) ? (
          <EmptyState title="Koi booking nahi mili" body="Tareekh ya filter badal kar dekhein." icon={Search} />
        ) : (
          <View style={{ gap: 14 }} onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
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
              <Text variant="caption" tone="muted" align="center">{`${first?.total ?? items.length} mein se sab dikha diye`}</Text>
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
    </Screen>
  );
}

function Total({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" tone={danger ? "danger" : "primary"}>
        {value}
      </Text>
    </View>
  );
}
