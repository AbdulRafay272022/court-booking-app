import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { shareCsv } from "@/lib/export-csv";
import { addDays, formatPKR, formatShortDate, formatTime, pktDateString } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { filterLedgerByCourt, ledgerRowsToCsv } from "@court-booking/api-client";
import { ChevronLeftIcon, DownloadIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { EmptyState, Tab } from "./_dashboard-components";

type RangeKey = "7d" | "30d" | "month";

function rangeFor(key: RangeKey): { start: string; end: string } {
  // Pakistan calendar dates (`toISOString().slice(0, 10)` is the UTC date: yesterday until 5 AM in Karachi).
  const end = pktDateString();
  const start = key === "7d" ? addDays(end, -6) : key === "30d" ? addDays(end, -29) : `${end.slice(0, 8)}01`;
  return { start, end };
}

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  booked: { label: "PAID", bg: "#E4F0EA", fg: "#14563A" },
  completed: { label: "PAID", bg: "#E4F0EA", fg: "#14563A" },
  payment_submitted: { label: "REVIEW", bg: "#FBF0DD", fg: "#9C5C0A" },
  cancelled: { label: "CANCELLED", bg: "#F8E5E0", fg: "#8C3823" },
  no_show: { label: "NO-SHOW", bg: "#F8E5E0", fg: "#8C3823" },
  held: { label: "HELD", bg: "#F4F6F7", fg: "#5B7079" },
};

const SOURCE_LABEL: Record<string, string> = { app: "APP", whatsapp: "WHATSAPP", walkin: "WALK-IN", phone: "PHONE" };

export default function LedgerScreen() {
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const { start, end } = useMemo(() => rangeFor(rangeKey), [rangeKey]);

  // Scoped to the SELECTED VENUE (the court filter is client-side -- see filterLedgerByCourt).
  const query = useQuery({
    queryKey: ["owner-ledger", activeVenueId, start, end],
    queryFn: () => api.owners.ledger(start, end, activeVenueId),
    enabled: !!activeVenueId,
  });

  const courts = activeVenue?.courts ?? [];
  const courtName = courts.find((c) => c.id === courtId)?.name;
  const ledger = query.data && courtName ? filterLedgerByCourt(query.data, courtName, start, end) : query.data;

  async function handleExport() {
    setExporting(true);
    try {
      const csv = courtName && ledger ? ledgerRowsToCsv(ledger.bookings) : await api.owners.ledgerExportCsv(start, end, activeVenueId);
      await shareCsv(csv, `ledger_${start}_${end}.csv`);
    } catch (e) {
      Alert.alert("Couldn't export", friendlyErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 pt-5 pb-4 bg-owner-surface border-b border-owner-border gap-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
              <ChevronLeftIcon />
            </Pressable>
            <Text className="font-plex-bold text-owner-ink text-[19px] -tracking-[0.3px]">Ledger</Text>
          </View>
          <Pressable
            onPress={handleExport}
            disabled={exporting || !ledger || ledger.bookings.length === 0}
            className="flex-row items-center gap-1.5 px-3 rounded-lg border border-owner-border"
            style={{ minHeight: 44, opacity: exporting ? 0.6 : 1 }}
          >
            <DownloadIcon />
            <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">{exporting ? "Exporting…" : "CSV"}</Text>
          </Pressable>
        </View>

        <View className="gap-2.5">
          <View className="flex-row items-baseline justify-between">
            <Text className="font-plex-semibold text-owner-ink-faint text-[11px] tracking-[1.2px]">
              {rangeKey === "month" ? "THIS MONTH" : rangeKey === "7d" ? "LAST 7 DAYS" : "LAST 30 DAYS"}
            </Text>
          </View>
          <Text className="font-mono-semibold text-owner-ink text-[33px] -tracking-[0.6px]">
            PKR {ledger ? formatPKR(ledger.summary.total_revenue) : "—"}
          </Text>
          <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
            {ledger ? `${ledger.summary.total_bookings} bookings · PKR ${formatPKR(ledger.summary.avg_revenue_per_day)}/day avg` : ""}
          </Text>
        </View>

        <View className="flex-row gap-1.5">
          <Tab label="7 days" selected={rangeKey === "7d"} onPress={() => setRangeKey("7d")} />
          <Tab label="30 days" selected={rangeKey === "30d"} onPress={() => setRangeKey("30d")} />
          <Tab label="This month" selected={rangeKey === "month"} onPress={() => setRangeKey("month")} />
        </View>
      </View>

      {courts.length > 1 ? (
        <View className="px-4.5 py-3 bg-owner-surface border-b border-owner-border flex-row gap-1.5">
          <Tab label="All courts" selected={!courtId} onPress={() => setCourtId(undefined)} />
          {courts.map((c) => (
            <Tab key={c.id} label={c.name} selected={courtId === c.id} onPress={() => setCourtId(c.id)} />
          ))}
        </View>
      ) : null}

      {venuesLoading || query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : query.isError && !ledger ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : !ledger || ledger.bookings.length === 0 ? (
        <EmptyState title="No bookings in this range" subtitle="Try a longer date range or a different court." />
      ) : (
        <ScrollView className="flex-1 bg-owner-surface">
          {ledger.bookings
            .slice()
            .reverse()
            .map((row) => {
              const statusStyle = STATUS_LABEL[row.status] ?? STATUS_LABEL.held;
              return (
                <View key={row.booking_id} className="flex-row items-center gap-3 px-4.5 py-3.5 border-b border-owner-border-light">
                  <View className="gap-0.5" style={{ minWidth: 52 }}>
                    <Text className="font-mono-semibold text-owner-ink text-[13px]">{formatShortDate(row.date)}</Text>
                    <Text className="font-mono-medium text-owner-ink-faint text-xs">{formatTime(row.date)}</Text>
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="font-plex-semibold text-owner-ink text-sm">{row.player ?? "Walk-in"}</Text>
                    <View className="flex-row gap-1.5">
                      <Badge label={statusStyle.label} bg={statusStyle.bg} fg={statusStyle.fg} />
                      <Badge label={SOURCE_LABEL[row.source] ?? row.source.toUpperCase()} bg="#F4F6F7" fg="#5B7079" />
                    </View>
                  </View>
                  <View className="items-end gap-0.5">
                    <Text className="font-mono-semibold text-owner-ink text-sm">{formatPKR(row.amount_paid)}</Text>
                    {row.refund_amount ? (
                      <Text className="font-mono-semibold text-[12px]" style={{ color: "#A8432C" }}>
                        -{formatPKR(Math.abs(row.refund_amount))} refunded
                      </Text>
                    ) : row.balance_due > 0 ? (
                      <Text className="font-mono-medium text-[12px]" style={{ color: "#9C5C0A" }}>
                        +{formatPKR(row.balance_due)} due
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: bg }}>
      <Text className="font-plex-semibold text-[10.5px]" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}
