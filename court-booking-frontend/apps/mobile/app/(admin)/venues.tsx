import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { venueMissingLabel, type Venue } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, EmptyState, ErrorState, Header, Input, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** audit 2026-10-28 Phase 2 item 4: the pending-venue queue on the app (same endpoints as the web console). Approve is refused
 * by the server while anything is missing (P1.9); the list says what. */
export default function AdminVenuesScreen() {
  const query = useQuery({ queryKey: ["admin-pending-venues"], queryFn: () => api.admin.pendingVenues() });
  return (
    <Screen testID="admin-venues-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header title="Venue approvals" onBack={() => router.back()} />
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <SkeletonCard />
      ) : query.data.length === 0 ? (
        <EmptyState title="Nothing to review" body="No venue is waiting for approval." />
      ) : (
        query.data.map((v) => <VenueCard key={v.id} venue={v} />)
      )}
    </Screen>
  );
}

function VenueCard({ venue }: { venue: Venue }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"changes" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const missing = venue.missing_for_approval ?? [];

  async function act(kind: "approve" | "changes" | "reject") {
    setBusy(true);
    setMessage(null);
    try {
      if (kind === "approve") await api.admin.approveVenue(venue.id);
      else if (kind === "changes") await api.admin.requestVenueChanges(venue.id, reason.trim());
      else await api.admin.rejectVenue(venue.id, reason.trim());
      setMessage({ ok: true, text: kind === "approve" ? "Approved. The owner was notified." : "Sent to the owner." });
      setMode(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin-pending-venues"] });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3] }} testID="admin-venue-card">
      <View style={{ gap: 2 }}>
        <Text variant="title">{venue.name}</Text>
        <Text variant="meta" tone="muted">{[venue.address, venue.area ?? venue.city].filter(Boolean).join(", ")}</Text>
        <Text variant="meta" tone="muted">{`${venue.sports.join(", ")} · ${(venue.courts ?? []).filter((c) => c.is_active).length} court(s)`}</Text>
      </View>
      {missing.length > 0 ? (
        <Banner tone="danger" title="Cannot go live yet. Missing:" body={missing.map((m) => `• ${venueMissingLabel(m, "en")}`).join("\n")} testID="admin-venue-missing" />
      ) : null}
      {mode ? (
        <View style={{ gap: space[2] }}>
          <Input label={mode === "reject" ? "Why are you rejecting this venue?" : "What changes are needed?"} value={reason} onChangeText={setReason} multiline testID="admin-venue-reason" />
          <Button
            label={mode === "reject" ? "Reject with this reason" : "Request these changes"}
            variant={mode === "reject" ? "dangerSolid" : "primary"}
            block
            disabled={reason.trim().length < 3}
            loading={busy}
            onPress={() => act(mode)}
          />
          <Button label="Back" variant="soft" size="md" block onPress={() => setMode(null)} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Button label="Approve" size="md" disabled={missing.length > 0} loading={busy} onPress={() => act("approve")} testID="admin-venue-approve" />
          <Button label="Request changes" variant="soft" size="md" onPress={() => setMode("changes")} />
          <Button label="Reject" variant="danger" size="md" onPress={() => setMode("reject")} />
        </View>
      )}
      {message ? <Banner tone={message.ok ? "open" : "danger"} body={message.text} /> : null}
    </View>
  );
}
