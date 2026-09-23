import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDayHeader, formatPKR, formatTime } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { openSupportWhatsApp } from "@/lib/support";
import { confirmLogout } from "@/lib/logout";
import { BellIcon, PlusIcon, CalendarIcon, BarsIcon, TrendingUpIcon, WhatsAppIcon, SettingsIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { RecordPaymentSheet } from "@/components/record-payment-sheet";
import { EmptyState, StatTile, Tab, VenueSwitcher, VenueStatusBanner, IconButton } from "./_dashboard-components";
import { useVenueSetupStore } from "@/lib/venue-setup-store";

const STATUS_STYLE: Record<string, { border: string; bg: string }> = {
  booked: { border: "#1F7A52", bg: "#FFFFFF" },
  payment_submitted: { border: "#9C5C0A", bg: "#FBF0DD" },
  held: { border: "#5B7079", bg: "#FFFFFF" },
  available: { border: "#C6D2D7", bg: "#FFFFFF" },
  blocked: { border: "#DCE3E6", bg: "#EFF2F3" },
};

export default function OwnerTodayScreen() {
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();
  const [activeCourt, setActiveCourt] = useState<string | "all">("all");
  const [recording, setRecording] = useState<{ bookingId: string; playerLabel: string; balanceDue: number } | null>(null);
  const queryClient = useQueryClient();

  const todayQuery = useQuery({
    queryKey: ["owner-today", activeVenueId],
    queryFn: () => api.owners.today({ venue_id: activeVenueId }),
    enabled: !!activeVenueId,
    refetchInterval: (query) => pollInterval(query, 15_000),
  });

  const data = todayQuery.data;
  const courts = data?.courts ?? [];
  const courtId = activeCourt === "all" ? undefined : activeCourt;
  const rows = courts
    .filter((c) => !courtId || c.court_id === courtId)
    .flatMap((c) => c.slots.map((s) => ({ ...s, courtName: c.name })))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 pt-5 pb-4 bg-owner-surface border-b border-owner-border gap-4">
        <View className="flex-row items-center justify-between">
          <View className="gap-0.5">
            <Text className="font-plex-semibold text-owner-ink-faint text-[11px] tracking-[1.5px]">
              {data ? formatDayHeader(data.date) : "TODAY"}
            </Text>
            <Text className="font-plex-bold text-owner-ink text-[19px] -tracking-[0.3px]">
              {activeVenue?.name ?? "Your venue"}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => openSupportWhatsApp()}
              accessibilityLabel="Need help? WhatsApp us"
              className="w-[42px] h-[42px] rounded-[11px] bg-owner-bg items-center justify-center"
            >
              <WhatsAppIcon size={18} color="#0E6274" />
            </Pressable>
            <Pressable
              onPress={() => router.push("/(owner)/notifications")}
              accessibilityLabel="Notifications"
              className="w-[42px] h-[42px] rounded-[11px] bg-owner-bg items-center justify-center"
            >
              <BellIcon />
            </Pressable>
            <Pressable
              onPress={() => router.push("/(owner)/account")}
              accessibilityLabel="Account"
              accessibilityRole="button"
              className="h-[42px] px-3 rounded-[11px] bg-owner-bg items-center justify-center"
            >
              <Text className="font-plex-semibold text-owner-ink-muted text-[12.5px]">Account</Text>
            </Pressable>
          </View>
        </View>

        <VenueSwitcher
          venues={venues}
          activeVenueId={activeVenueId}
          onSelect={setVenueId}
          onAdd={() => {
            // Reuses the existing setup wizard, from a clean draft (not whatever was left half-done).
            useVenueSetupStore.getState().reset();
            router.push("/(owner)/venue-setup/register");
          }}
        />
        {activeVenue ? (
          <VenueStatusBanner
            venue={activeVenue}
            onView={() =>
              router.push({
                pathname: activeVenue.status === "rejected" ? "/(owner)/venue-setup/rejected" : "/(owner)/venue-setup/pending",
                params: { venueId: activeVenue.id },
              })
            }
          />
        ) : null}

        <View className="flex-row gap-2.5">
          <StatTile
            label="Booked"
            value={data ? `${rows.filter((r) => r.status === "booked" || r.status === "payment_submitted").length}/${rows.length}` : "—"}
          />
          <StatTile label="Today" value={data ? formatPKR(data.summary.total_revenue) : "—"} />
          <Pressable className="flex-1" onPress={() => router.push("/(owner)/approvals")}>
            <StatTile label="Pending" value={data ? String(data.summary.pending_approvals) : "—"} tone="warn" />
          </Pressable>
        </View>
      </View>

      {courts.length > 1 ? (
        <View className="px-4.5 py-3 bg-owner-surface border-b border-owner-border flex-row gap-1.5">
          {courts.map((c) => (
            <Tab key={c.court_id} label={c.name} selected={activeCourt === c.court_id} onPress={() => setActiveCourt(c.court_id)} />
          ))}
          <View className="flex-1" />
          <Tab label="All" selected={activeCourt === "all"} onPress={() => setActiveCourt("all")} />
        </View>
      ) : null}

      {venuesLoading || todayQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : todayQuery.isError && !data ? (
        <ErrorState message={friendlyErrorMessage(todayQuery.error)} onRetry={() => todayQuery.refetch()} tone="owner" />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing scheduled" subtitle="No courts set up yet, or nothing on the books for today." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-3.5 pb-4 gap-1.5">
          {rows.map((slot) => {
            const style = STATUS_STYLE[slot.status] ?? STATUS_STYLE.available;
            const isOpen = slot.status === "available";
            const isDashed = isOpen;
            return (
              <View
                key={`${slot.courtName}-${slot.starts_at}`}
                className="flex-row items-center gap-3 px-3.5 rounded-[9px]"
                style={{
                  minHeight: 60,
                  backgroundColor: style.bg,
                  borderWidth: 1,
                  borderColor: isDashed ? "#C6D2D7" : "#DCE3E6",
                  borderStyle: isDashed ? "dashed" : "solid",
                  borderLeftWidth: isDashed || slot.status === "blocked" ? 1 : 3,
                  borderLeftColor: style.border,
                }}
              >
                <Text
                  className="font-mono-semibold text-[13.5px]"
                  style={{ minWidth: 66, color: slot.status === "payment_submitted" ? "#9C5C0A" : slot.status === "available" || slot.status === "blocked" ? "#8399A1" : "#101C21" }}
                >
                  {formatTime(slot.starts_at)}
                </Text>
                <View className="flex-1 gap-0.5">
                  <Text
                    className="font-plex-semibold text-sm"
                    style={{ color: slot.status === "available" || slot.status === "blocked" ? "#8399A1" : "#101C21" }}
                  >
                    {courtId ? slot.player_name ?? statusLabel(slot.status) : `${slot.courtName} · ${slot.player_name ?? statusLabel(slot.status)}`}
                  </Text>
                  <Text
                    className="font-plex-medium text-xs"
                    style={{ color: slot.status === "payment_submitted" ? "#9C5C0A" : "#8399A1" }}
                  >
                    {statusSubtitle(slot.status)}
                  </Text>
                </View>
                {slot.status === "payment_submitted" ? (
                  <Pressable
                    onPress={() => router.push("/(owner)/approvals")}
                    className="px-3.5 rounded-lg items-center justify-center"
                    style={{ minHeight: 44, backgroundColor: "#9C5C0A" }}
                  >
                    <Text className="font-plex-semibold text-white text-[12.5px]">Review</Text>
                  </Pressable>
                ) : slot.status === "available" ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(owner)/walkin",
                        params: { courtId: courts.find((c) => c.name === slot.courtName)?.court_id, startsAt: slot.starts_at },
                      })
                    }
                    className="px-3 rounded-lg border border-owner-border items-center justify-center"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="font-plex-semibold text-owner-accent text-[12.5px]">Add booking</Text>
                  </Pressable>
                ) : slot.status === "booked" && slot.balance_due != null && slot.balance_due > 0 && slot.booking_id ? (
                  <Pressable
                    onPress={() =>
                      setRecording({
                        bookingId: slot.booking_id!,
                        playerLabel: slot.player_name ?? "Player",
                        balanceDue: slot.balance_due!,
                      })
                    }
                    className="items-end"
                  >
                    <Text className="font-mono-semibold text-[13.5px] text-owner-ink">PKR {formatPKR(slot.amount_paid ?? 0)}</Text>
                    <View className="px-2.5 h-7 rounded-full items-center justify-center flex-row" style={{ backgroundColor: "#FBF0DD" }}>
                      <Text className="font-plex-bold text-[10.5px]" style={{ color: "#9C5C0A" }}>
                        RECORD PKR {formatPKR(slot.balance_due)}
                      </Text>
                    </View>
                  </Pressable>
                ) : slot.amount_paid != null ? (
                  <View className="items-end">
                    <Text className="font-mono-semibold text-[13.5px] text-owner-ink">PKR {formatPKR(slot.amount_paid)}</Text>
                    {slot.status === "booked" && slot.balance_due != null ? (
                      <Text className="font-plex-semibold text-[11px]" style={{ color: slot.balance_due > 0 ? "#9C5C0A" : "#1F7A52" }}>
                        {slot.balance_due > 0 ? `PKR ${formatPKR(slot.balance_due)} due at venue` : "Fully paid"}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      <View className="px-4.5 pt-3.5 pb-6 bg-owner-surface border-t border-owner-border flex-row gap-2.5">
        <Pressable
          onPress={() => router.push("/(owner)/walkin")}
          className="flex-1 h-12 rounded-[10px] bg-owner-accent flex-row items-center justify-center gap-2"
        >
          <PlusIcon />
          <Text className="font-plex-semibold text-white text-[14.5px]">Walk-in</Text>
        </Pressable>
        <IconButton onPress={() => Alert.alert("Coming soon", "Browsing other days from Today isn't built yet — use the ledger for a date range.")}>
          <CalendarIcon />
        </IconButton>
        <IconButton onPress={() => router.push("/(owner)/ledger")}>
          <BarsIcon />
        </IconButton>
        <IconButton onPress={() => router.push("/(owner)/growth")}>
          <TrendingUpIcon size={18} color="#5B7079" />
        </IconButton>
        <IconButton onPress={() => router.push("/(owner)/venue-settings")}>
          <SettingsIcon />
        </IconButton>
      </View>

      {recording ? (
        <RecordPaymentSheet
          bookingId={recording.bookingId}
          playerLabel={recording.playerLabel}
          balanceDue={recording.balanceDue}
          onClose={() => setRecording(null)}
          onRecorded={() => {
            setRecording(null);
            queryClient.invalidateQueries({ queryKey: ["owner-today"] });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "held":
      return "Held";
    case "available":
      return "Open";
    case "blocked":
      return "Closed";
    default:
      return "Booking";
  }
}

function statusSubtitle(status: string): string {
  switch (status) {
    case "booked":
      return "Confirmed booking";
    case "payment_submitted":
      return "Screenshot waiting for review";
    case "held":
      return "Player is paying now";
    case "available":
      return "No booking yet";
    case "blocked":
      return "Blocked by venue";
    default:
      return "";
  }
}
