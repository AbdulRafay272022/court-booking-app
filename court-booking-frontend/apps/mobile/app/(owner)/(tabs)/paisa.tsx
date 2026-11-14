import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Redirect, router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Search } from "lucide-react-native";
import {
  MONEY_STATUSES,
  PAISA_DEFAULT_PERIOD,
  PAISA_PERIODS,
  moneyStatusKey,
  boxKey,
  periodKey,
  staffActKey,
  tabKey,
  type MoneyStatus,
  type OwnerRefund,
  type PaisaBox,
  type PaisaBookingRow,
  type PaisaDaybookRow,
  type PaisaPeriod,
  type PaisaPlayer,
  type PaisaTab,
  type PaisaTaskGroup,
} from "@court-booking/types";
import { alpha, palette, radius, size, space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Input, SegmentedToggle, Skeleton, Text, useRoleTheme, useTabBarRoom } from "@/components/ui";

import { api } from "@/lib/api";
import { courtLabel, sportForCourtName } from "@/components/court-label";
import { shareCsv } from "@/lib/export-csv";
import { addDays, formatDayHeader, pktDateString } from "@/lib/format";
import { isPeriod, isTaskKey, parseView, shortRange, type PaisaParams } from "@/lib/paisa-mobile";
import { useLedgerV2 } from "@/lib/use-ledger-v2";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { NoAccess } from "@/components/no-access";
import { DateChooserSheet, MultiSelectSheet, courtsSummary } from "@/components/overview/pickers";
import { BottomSheet, OutlineButton, SelectButton } from "@/components/overview/ui";
import { DueDoneSheet, NoShowReverseSheet } from "@/components/money-sheets";
import { RefundSheet } from "@/components/refund-sheet";
import { usePaisaTasks } from "@/components/owner-tab-bar";
import { PaisaBookingSheet, invalidatePaisa } from "@/components/paisa/booking-sheet";
import { KaamGroupCard, orderedGroups, type KaamOpen } from "@/components/paisa/kaam-view";
import { GlassTile, Line, PaisaCard, moneyError, pkr, usePT } from "@/components/paisa/kit";
import { BookingRowCard, DayHeader, DaybookRow, MoneyInCard, PlayerRow, StatementCard, TakePaymentSheet } from "@/components/paisa/views";
import { HeroLayout } from "../_fl";

type Sheet =
  | null
  | { kind: "booking"; id: string }
  | { kind: "refund"; refund: OwnerRefund }
  | { kind: "noshow"; bookingId: string; replyId: string; subtitle: string; total: number; paid: number }
  | { kind: "due"; due: { id: string; due_pkr: number; player_name: string | null; code: string } }
  | { kind: "take"; player: PaisaPlayer }
  | { kind: "period" }
  | { kind: "from" }
  | { kind: "to" }
  | { kind: "courts" }
  | { kind: "status" };

type Item =
  | { t: "booking"; key: string; r: PaisaBookingRow }
  | { t: "day"; key: string; date: string; total: number }
  | { t: "entry"; key: string; r: PaisaDaybookRow }
  | { t: "player"; key: string; p: PaisaPlayer }
  | { t: "group"; key: string; g: PaisaTaskGroup };

const PAGE = 20;

/**
 * Ledger v2 "Paisa" (docs/design/LEDGER-V2-CONTRACT.md 6.2): Bookings · Len-den · Players · Kaam on ONE screen, every number
 * from GET /owners/paisa/*. Behind the flag ledger_v2; with it off this route sends you to the old Ledger. Lists are one
 * FlashList (the hero and filters are its header).
 */
export default function PaisaScreen() {
  const params = useLocalSearchParams<Record<keyof PaisaParams, string>>();
  const { v2, loaded } = useLedgerV2();
  const t = usePT();
  const theme = useRoleTheme();
  const tabRoom = useTabBarRoom();
  const focused = useIsFocused();
  const qc = useQueryClient();
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const { can, settled } = useMyPermissions();
  const full = can("view_ledger");
  const refundsOnly = !full && can("mark_refunds");

  const [view, setView] = useState<PaisaTab>(refundsOnly ? "kaam" : parseView(params.view));
  const [period, setPeriod] = useState<PaisaPeriod>(isPeriod(params.period) ? params.period : PAISA_DEFAULT_PERIOD);
  const today = pktDateString();
  const [from, setFrom] = useState(params.from || addDays(today, -6));
  const [to, setTo] = useState(params.to || today);
  const [courtIds, setCourtIds] = useState<string[]>(params.courts ? params.courts.split(",").filter(Boolean) : []);
  const [status, setStatus] = useState<MoneyStatus | null>((MONEY_STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as MoneyStatus) : null);
  const [box, setBox] = useState<PaisaBox | null>(null);
  const [text, setText] = useState(params.q ?? "");
  const [q, setQ] = useState(params.q ?? "");
  const [focusBooking, setFocusBooking] = useState<string | null>(params.booking || null);
  const [staffFilter, setStaffFilter] = useState<{ staff: string; act: string; who?: string } | null>(params.staff && params.act ? { staff: params.staff, act: params.act, who: params.who } : null);
  const [show, setShow] = useState<"money" | "with_deductions" | "deductions">("money");
  const [method, setMethod] = useState<"cash" | "transfer" | null>(null);
  const [onlyRefunds, setOnlyRefunds] = useState(false);
  const [playerQ, setPlayerQ] = useState("");
  const [group, setGroup] = useState<string | undefined>(isTaskKey(params.group) ? params.group : undefined);
  const [refundDate, setRefundDate] = useState<string | undefined>(params.date || undefined);
  const [sheet, setSheet] = useState<Sheet>(params.open === "1" && params.booking ? { kind: "booking", id: params.booking } : null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  // a later notification / redirect with new params re-targets the screen
  const seen = useRef(JSON.stringify(params));
  useEffect(() => {
    const now = JSON.stringify(params);
    if (now === seen.current) return;
    seen.current = now;
    if (params.view) setView(refundsOnly ? "kaam" : parseView(params.view));
    if (isPeriod(params.period)) setPeriod(params.period);
    if (params.from) setFrom(params.from);
    if (params.to) setTo(params.to);
    if (params.courts !== undefined) setCourtIds(params.courts ? params.courts.split(",").filter(Boolean) : []);
    if (params.booking) setFocusBooking(params.booking);
    if (params.staff && params.act) setStaffFilter({ staff: params.staff, act: params.act, who: params.who });
    if (isTaskKey(params.group)) setGroup(params.group);
    if (params.date) setRefundDate(params.date);
    if (params.open === "1" && params.booking) setSheet({ kind: "booking", id: params.booking });
  }, [params, refundsOnly]);

  useEffect(() => {
    const h = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(h);
  }, [text]);

  const range = { venueId: activeVenueId, courtIds, period, from, to };
  const enabled = v2 && !!activeVenueId && full;
  const summary = useQuery({ queryKey: ["paisa-summary", activeVenueId, courtIds.join(","), period, from, to], queryFn: () => api.paisa.summary(range), enabled, subscribed: focused });
  const bookings = useInfiniteQuery({
    queryKey: ["paisa-bookings", activeVenueId, courtIds.join(","), period, from, to, q, status, box, focusBooking, staffFilter?.staff, staffFilter?.act],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.paisa.bookings({ ...range, q: q || undefined, moneyStatus: status ?? undefined, box: box ?? undefined, booking: focusBooking ?? undefined, staff: staffFilter?.staff, act: staffFilter?.act, page: pageParam, pageSize: PAGE }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: enabled && view === "bookings",
    subscribed: focused,
  });
  const daybook = useQuery({
    queryKey: ["paisa-daybook", activeVenueId, courtIds.join(","), period, from, to, show, method, onlyRefunds],
    queryFn: () => api.paisa.daybook({ ...range, show, method: method ?? undefined, kind: onlyRefunds ? "refund" : undefined }),
    enabled: enabled && view === "lenden",
    subscribed: focused,
  });
  const players = useQuery({ queryKey: ["paisa-players", activeVenueId, playerQ], queryFn: () => api.paisa.players(activeVenueId, playerQ || undefined), enabled: enabled && view === "players", subscribed: focused });
  const tasks = usePaisaTasks(focused);
  const kaam = useQuery({
    queryKey: ["paisa-tasks", activeVenueId, refundDate ?? "", courtIds.join(",")],
    queryFn: () => api.paisa.tasks(activeVenueId, { date: refundDate, courtIds: refundDate ? courtIds : undefined }),
    enabled: v2 && !!activeVenueId && view === "kaam" && (full || refundsOnly),
    subscribed: focused,
  });

  const courts = activeVenue?.courts ?? [];
  const courtName = (r: OwnerRefund) => courtLabel(r.court_name, r.court_sport ?? sportForCourtName(courts, r.court_name));

  const items: Item[] = useMemo(() => {
    if (view === "bookings") return (bookings.data?.pages.flatMap((p) => p.items) ?? []).map((r) => ({ t: "booking", key: r.booking_id, r }));
    if (view === "lenden") {
      const out: Item[] = [];
      for (const d of daybook.data?.days ?? []) {
        out.push({ t: "day", key: `d${d.date}`, date: d.date, total: d.total });
        for (const r of d.rows) out.push({ t: "entry", key: `${r.type}${r.id}`, r });
      }
      return out;
    }
    if (view === "players") return (players.data?.items ?? []).map((p) => ({ t: "player", key: `${p.key.player_id ?? p.key.phone ?? p.name}`, p }));
    return orderedGroups(kaam.data, group).map((g) => ({ t: "group", key: g.key, g }));
  }, [view, bookings.data, daybook.data, players.data, kaam.data, group]);

  if (loaded && !v2) return <Redirect href="/(owner)/(tabs)/ledger" />;
  if (settled && !full && !refundsOnly) return <NoAccess what="Paisa" withBack={false} />;

  async function exportCsv() {
    setCsvBusy(true);
    setCsvError(null);
    try {
      const csv = await api.paisa.bookingsCsv({ ...range, q: q || undefined, moneyStatus: status ?? undefined, box: box ?? undefined });
      await shareCsv(csv, `paisa_${summary.data?.range.from ?? from}_${summary.data?.range.to ?? to}.csv`);
    } catch (e) {
      setCsvError(moneyError(e, t));
    } finally {
      setCsvBusy(false);
    }
  }

  function openKaam(o: KaamOpen) {
    if (o.kind === "noshow") {
      void api.paisa.booking(o.bookingId, activeVenueId).then((d) =>
        setSheet({ kind: "noshow", bookingId: o.bookingId, replyId: o.replyId, subtitle: o.subtitle, total: d.final_if_noshow_undone, paid: d.calc.received }),
      );
      return;
    }
    if (o.kind === "due") {
      setSheet({ kind: "due", due: { id: o.due.id, due_pkr: o.due.due_pkr, player_name: o.due.player_name, code: o.due.code } });
      return;
    }
    setSheet(o);
  }

  const s = summary.data;
  const now = s?.right_now;
  const views: PaisaTab[] = refundsOnly ? ["kaam"] : ["bookings", "lenden", "players", "kaam"];
  const kaamCount = tasks.data?.total ?? 0;

  const hero = (
    <View style={{ gap: space[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
        <Text variant="h1" tone="hero" accessibilityRole="header">{t("paisa.title")}</Text>
        {full ? (
          <Pressable onPress={exportCsv} disabled={csvBusy} accessibilityRole="button" accessibilityLabel={`${t("paisa.title")} ${t("paisa.csv")}`} testID="paisa-csv"
            style={{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: alpha.glassOnTeal, borderWidth: 1, borderColor: alpha.glassOnTealBorder, opacity: csvBusy ? 0.6 : 1 }}>
            <Download size={16} color={palette.white} />
            <Text variant="bodyBold" tone="hero">{csvBusy ? t("paisa.csvWorking") : t("paisa.csv")}</Text>
          </Pressable>
        ) : null}
      </View>
      {views.length > 1 ? (
        <SegmentedToggle
          testID="paisa-switch"
          accessibilityLabel={t("paisa.title")}
          tone="dark"
          value={view}
          options={views.map((v) => ({ value: v, label: v === "kaam" && kaamCount > 0 ? `${t(tabKey(v))} ${kaamCount > 99 ? "99+" : kaamCount}` : t(tabKey(v)) }))}
          onChange={(v) => setView(v)}
        />
      ) : null}
      {view === "bookings" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} testID="paisa-right-now">
          <GlassTile label={t("paisa.now.due")} value={now ? pkr(now.due) : "—"} sub={now ? t("paisa.now.count", { n: now.due_count }) : undefined} onPress={() => setView("players")} testID="paisa-now-due" />
          <GlassTile label={t("paisa.now.refundDue")} value={now ? pkr(now.refund_due) : "—"} sub={now ? t("paisa.now.count", { n: now.refund_count }) : undefined} onPress={() => { setGroup("refund_due"); setView("kaam"); }} testID="paisa-now-refund" />
          <GlassTile label={t("paisa.now.advance")} value={now ? pkr(now.advance_received) : "—"} sub={now ? t("paisa.now.count", { n: now.advance_count }) : undefined} />
          <GlassTile label={t("paisa.now.credit")} value={now ? pkr(now.player_credit) : "—"} onPress={() => setView("players")} />
        </View>
      ) : view === "lenden" ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodyBold" tone="hero">{t("paisa.lenden.netIn")}</Text>
          <Text variant="display" tone="hero" testID="paisa-net-in">{s ? pkr(s.money_in.net) : "—"}</Text>
          {s ? (
            <Text variant="meta" tone="heroMuted">
              {`${t("paisa.in.cash")} ${pkr(s.money_in.cash)} · ${t("paisa.in.transfer")} ${pkr(s.money_in.transfer)} · ${t("paisa.in.refunds")} ${pkr(s.money_in.refunds_paid.total)}`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const rangeLine = s ? `${shortRange(s.range.from, s.range.to)} · ${t("paisa.counts", { bookings: s.counts.bookings, played: s.counts.played, noshow: s.counts.no_show, cancelled: s.counts.cancelled })}` : "";
  const filters = (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        <View style={{ flexGrow: 1, flexBasis: 150 }}>
          <SelectButton value={`${t("paisa.period")}: ${t(periodKey(period))}`} onPress={() => setSheet({ kind: "period" })} compact />
        </View>
        {courts.length > 1 ? (
          <View style={{ flexGrow: 1, flexBasis: 150 }}>
            <SelectButton value={`${t("paisa.court")}: ${courtIds.length ? courtsSummary(courtIds, courts) : t("paisa.court.all")}`} onPress={() => setSheet({ kind: "courts" })} compact />
          </View>
        ) : null}
      </View>
      {period === "custom" ? (
        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          <View style={{ flexGrow: 1, flexBasis: 130 }}><SelectButton label={t("paisa.from")} value={formatDayHeader(from)} onPress={() => setSheet({ kind: "from" })} /></View>
          <View style={{ flexGrow: 1, flexBasis: 130 }}><SelectButton label={t("paisa.to")} value={formatDayHeader(to)} onPress={() => setSheet({ kind: "to" })} /></View>
        </View>
      ) : null}
      {rangeLine ? <Text variant="caption" tone="muted" testID="paisa-range-line">{rangeLine}</Text> : null}
    </View>
  );

  const loadingList = venuesLoading || (view === "bookings" ? bookings.isLoading : view === "lenden" ? daybook.isLoading : view === "players" ? players.isLoading : kaam.isLoading);
  const listError = view === "bookings" ? bookings.error : view === "lenden" ? daybook.error : view === "players" ? players.error : kaam.error;

  const top = (
    <HeroLayout hero={hero} testID="paisa-hero">
      {csvError ? <Banner tone="danger" body={csvError} /> : null}
      {view === "bookings" ? (
        <>
          {filters}
          {s ? <StatementCard s={s.statement} t={t} onBox={(b) => { setBox(b); setStatus(null); }} /> : <Skeleton height={260} r={radius.card} />}
          {s ? <MoneyInCard m={s.money_in} t={t} /> : null}
          {s && s.by_month.length ? (
            <PaisaCard>
              <Text variant="bodyBold">{t("paisa.months.title")}</Text>
              {s.by_month.map((m) => <Line key={m.month} label={m.month} value={`${pkr(m.final)} · ${t("paisa.st.received")} ${pkr(m.received)}`} />)}
            </PaisaCard>
          ) : null}
          <Input label={t("paisa.search")} labelHidden leading={<Search size={18} color={palette.body} />} value={text} onChangeText={setText} placeholder={t("paisa.search")} autoCapitalize="none" returnKeyType="search" testID="paisa-search" />
          {bookings.data?.pages[0]?.search_all_dates && q ? <Text variant="caption" tone="muted">{t("paisa.searchAllDates")}</Text> : null}
          <SelectButton value={`${t("paisa.status")}: ${status ? t(moneyStatusKey(status)) : t("paisa.status.all")}`} onPress={() => setSheet({ kind: "status" })} compact />
          {staffFilter ? (
            <Banner tone="info" body={t("paisa.staffFilter", { who: staffFilter.who || "Staff", what: staffActKey(staffFilter.act) ? t(staffActKey(staffFilter.act)!) : staffFilter.act })} action={<Button label={t("paisa.clearFilter")} variant="soft" size="sm" onPress={() => setStaffFilter(null)} />} testID="paisa-staff-banner" />
          ) : null}
          {box ? (
            <Banner tone="info" body={t("paisa.boxFilter", { what: t(boxKey(box)) })} action={<Button label={t("paisa.clearFilter")} variant="soft" size="sm" onPress={() => setBox(null)} />} testID="paisa-box-banner" />
          ) : null}
          {focusBooking ? (
            <Banner tone="info" body={t("paisa.focusOnly")} action={<Button label={t("paisa.clearFilter")} variant="soft" size="sm" onPress={() => setFocusBooking(null)} />} testID="paisa-focus-banner" />
          ) : null}
        </>
      ) : view === "lenden" ? (
        <>
          {filters}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel={t("paisa.lenden.show")}>
            {(["money", "with_deductions", "deductions"] as const).map((k) => (
              <Chip key={k} label={t(`paisa.lenden.show.${k}`)} selected={show === k} onPress={() => setShow(k)} />
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel={t("paisa.lenden.method")}>
            <Chip label={t("paisa.lenden.method.all")} selected={method === null} onPress={() => setMethod(null)} />
            <Chip label={t("paisa.in.cash")} selected={method === "cash"} onPress={() => setMethod("cash")} />
            <Chip label={t("paisa.in.transfer")} selected={method === "transfer"} onPress={() => setMethod("transfer")} />
            <Chip label={t("paisa.lenden.onlyRefunds")} selected={onlyRefunds} onPress={() => setOnlyRefunds((v) => !v)} testID="paisa-only-refunds" />
          </View>
        </>
      ) : view === "players" ? (
        <>
          {players.data ? <Text variant="meta" tone="muted" testID="paisa-points">{t("paisa.players.points", { awarded: players.data.points_awarded, used: players.data.points_used })}</Text> : null}
          <Input label={t("paisa.search")} labelHidden leading={<Search size={18} color={palette.body} />} value={playerQ} onChangeText={setPlayerQ} placeholder={t("paisa.search")} autoCapitalize="none" />
        </>
      ) : null}
      {loadingList ? (
        <View style={{ gap: space[2] }} accessibilityLabel={t("paisa.loading")}>
          <Skeleton height={72} r={radius.tile} />
          <Skeleton height={72} r={radius.tile} />
        </View>
      ) : listError && items.length === 0 ? (
        <ErrorState message={moneyError(listError, t)} onRetry={() => void invalidatePaisa(qc)} />
      ) : items.length === 0 ? (
        <EmptyState title={t(view === "bookings" ? "paisa.empty.bookings" : view === "lenden" ? "paisa.empty.lenden" : view === "players" ? "paisa.empty.players" : "paisa.empty.kaam")} />
      ) : null}
    </HeroLayout>
  );

  const footer =
    view === "bookings" && items.length > 0 ? (
      <View style={{ padding: space[4] }}>
        {bookings.hasNextPage ? (
          <OutlineButton label={bookings.isFetchingNextPage ? t("paisa.loading") : t("paisa.more")} onPress={() => void bookings.fetchNextPage()} testID="paisa-more-rows" />
        ) : (
          <Text variant="caption" tone="muted" align="center">{t("paisa.allShown", { n: bookings.data?.pages[0]?.total ?? items.length })}</Text>
        )}
      </View>
    ) : view === "lenden" && daybook.data && items.length > 0 ? (
      <View style={{ padding: space[4], gap: space[2] }}>
        <PaisaCard testID="paisa-lenden-footer">
          <Line label={t("paisa.lenden.in")} value={pkr(daybook.data.footer.in)} />
          <Line label={t("paisa.lenden.out")} value={pkr(-daybook.data.footer.out)} />
          <Line strong label={t("paisa.lenden.net")} value={pkr(daybook.data.footer.net)} />
        </PaisaCard>
        {daybook.data.footer.cash_by.length ? (
          <PaisaCard>
            <Text variant="bodyBold">{t("paisa.lenden.cashBy")}</Text>
            {daybook.data.footer.cash_by.map((c) => <Line key={c.name} label={c.name} value={pkr(c.amount)} />)}
          </PaisaCard>
        ) : null}
      </View>
    ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }} testID="paisa-screen">
      <FlashList
        data={loadingList ? [] : items}
        keyExtractor={(it) => it.key}
        getItemType={(it) => it.t}
        ListHeaderComponent={top}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: tabRoom }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void invalidatePaisa(qc)} tintColor={theme.ring} colors={[theme.ring]} />}
        renderItem={({ item }) => {
          switch (item.t) {
            case "booking":
              return (
                <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
                  <BookingRowCard r={item.r} t={t} highlighted={focusBooking === item.r.booking_id} onPress={() => setSheet({ kind: "booking", id: item.r.booking_id })} />
                </View>
              );
            case "day":
              return <View style={{ paddingHorizontal: space[4] }}><DayHeader date={item.date} total={item.total} t={t} /></View>;
            case "entry":
              return <View style={{ paddingHorizontal: space[4] }}><DaybookRow r={item.r} t={t} onPress={() => setSheet({ kind: "booking", id: item.r.booking_id })} /></View>;
            case "player":
              return (
                <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
                  <PlayerRow p={item.p} t={t} onPress={() => item.p.open_bookings.length ? setSheet({ kind: "take", player: item.p }) : undefined} />
                </View>
              );
            default:
              return (
                <View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
                  <KaamGroupCard group={item.g} t={t} open={openKaam} courtName={courtName} filterDate={refundDate}
                    onClearFilter={() => { setRefundDate(undefined); router.setParams({ date: undefined }); }} />
                </View>
              );
          }
        }}
      />

      {sheet?.kind === "booking" ? <PaisaBookingSheet key={sheet.id} bookingId={sheet.id} onClose={() => { setSheet(null); void invalidatePaisa(qc); }} /> : null}
      {sheet?.kind === "refund" ? (
        <RefundSheet key={sheet.refund.id} v2 refund={sheet.refund} title={`${sheet.refund.player_name ?? sheet.refund.player_phone ?? "Player"} - ${courtName(sheet.refund)}`}
          onClose={() => setSheet(null)} onDone={() => { setSheet(null); void invalidatePaisa(qc); }} />
      ) : null}
      {sheet?.kind === "noshow" ? (
        <NoShowReverseSheet target={{ bookingId: sheet.bookingId, subtitle: sheet.subtitle, total: sheet.total, paid: sheet.paid, replyId: sheet.replyId }}
          onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void invalidatePaisa(qc); }} />
      ) : null}
      {sheet?.kind === "due" ? (
        <DueDoneSheet claimId={sheet.due.id} due={sheet.due.due_pkr} subtitle={`${sheet.due.player_name ?? "Player"} · ${sheet.due.code}`}
          onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void invalidatePaisa(qc); }} />
      ) : null}
      {sheet?.kind === "take" ? (
        <TakePaymentSheet p={sheet.player} t={t} venueName={activeVenue?.name ?? ""} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void invalidatePaisa(qc); }} />
      ) : null}
      {sheet?.kind === "period" ? (
        <BottomSheet title={t("paisa.period")} onClose={() => setSheet(null)} testID="paisa-period-sheet">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {PAISA_PERIODS.map((p) => (
              <Chip key={p} label={t(periodKey(p))} selected={period === p} onPress={() => { setPeriod(p); setSheet(p === "custom" ? { kind: "from" } : null); }} testID={`paisa-period-${p}`} />
            ))}
          </View>
        </BottomSheet>
      ) : null}
      {sheet?.kind === "from" || sheet?.kind === "to" ? (
        <DateChooserSheet
          title={sheet.kind === "from" ? t("paisa.from") : t("paisa.to")}
          value={sheet.kind === "from" ? from : to}
          onClose={() => setSheet(null)}
          onPick={(d) => {
            if (sheet.kind === "from") {
              setFrom(d);
              if (d > to) setTo(d);
              setSheet({ kind: "to" });
            } else {
              setTo(d);
              if (d < from) setFrom(d);
              setSheet(null);
            }
          }}
        />
      ) : null}
      {sheet?.kind === "courts" ? (
        <MultiSelectSheet title={t("paisa.court")} allLabel={t("paisa.court.all")} options={courts.map((c) => ({ id: c.id, label: c.name, sub: c.sport }))} value={courtIds}
          onClose={() => setSheet(null)} onApply={(ids) => { setCourtIds(ids.length === courts.length ? [] : ids); setSheet(null); }} />
      ) : null}
      {sheet?.kind === "status" ? (
        <BottomSheet title={t("paisa.status")} onClose={() => setSheet(null)}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Chip label={t("paisa.status.all")} selected={status === null} onPress={() => { setStatus(null); setBox(null); setSheet(null); }} />
            {MONEY_STATUSES.map((m) => (
              <Chip key={m} label={t(moneyStatusKey(m))} selected={status === m} onPress={() => { setStatus(m); setBox(null); setSheet(null); }} />
            ))}
          </View>
        </BottomSheet>
      ) : null}
    </View>
  );
}
