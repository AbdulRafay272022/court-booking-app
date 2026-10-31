import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminIdentityRow } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Header, Input, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

type Filter = "unverified" | "rejected" | "all";

/**
 * audit 2026-10-28 Phase 2 item 4: owner CNIC review on the app. "Approve" or "Not approve" (a reason is required; the owner is
 * notified and can upload again). Opening a row shows the full number and the photos; the server logs every view (as on the web).
 */
export default function AdminIdentitiesScreen() {
  const [filter, setFilter] = useState<Filter>("unverified");
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["admin-identities", filter, 1], queryFn: () => api.admin.ownerIdentities(filter, 1) });
  return (
    <Screen testID="admin-identities-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header title="Owner CNIC" onBack={() => router.back()} />
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        {(["unverified", "rejected", "all"] as Filter[]).map((f) => (
          <Chip key={f} label={f === "unverified" ? "Waiting" : f === "rejected" ? "Not approved" : "All"} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <SkeletonCard />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="Nothing here" body="No CNIC in this list." />
      ) : (
        query.data.items.map((row) => (
          <IdentityRow key={row.user_id} row={row} open={open === row.user_id} onToggle={() => setOpen(open === row.user_id ? null : row.user_id)} />
        ))
      )}
    </Screen>
  );
}

function IdentityRow({ row, open, onToggle }: { row: AdminIdentityRow; open: boolean; onToggle: () => void }) {
  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[2] }} testID="admin-identity-row">
      <Text variant="bodyStrong">{row.owner_name ?? "Owner"}</Text>
      <Text variant="meta" tone="muted">{`${row.masked ?? "no CNIC"} · ${row.status}${row.phone_last4 ? ` · phone …${row.phone_last4}` : ""}`}</Text>
      {row.flags.includes("not_cnic_like") ? <Banner tone="danger" body="This upload does not look like a CNIC card (shape or size). Check it carefully." /> : null}
      {row.flags.includes("duplicate_cnic") ? <Banner tone="waiting" body="The same CNIC number is on another account." /> : null}
      {row.status === "rejected" && row.rejection_reason ? <Text variant="meta" tone="danger">{`Reason: ${row.rejection_reason}`}</Text> : null}
      {row.status !== "missing" ? <Button label={open ? "Close" : "Open (logged)"} variant="soft" size="md" onPress={onToggle} /> : null}
      {open ? <IdentityDetail userId={row.user_id} /> : null}
    </View>
  );
}

function IdentityDetail({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const full = useQuery({ queryKey: ["admin-identity-full", userId], queryFn: () => api.admin.ownerIdentity(userId), gcTime: 0, staleTime: Infinity });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const data = full.data;

  async function decide(kind: "verify" | "reject") {
    setBusy(true);
    setMessage(null);
    try {
      if (kind === "verify") await api.admin.verifyOwnerIdentity(userId);
      else await api.admin.rejectOwnerIdentity(userId, reason.trim());
      setMessage({ ok: true, text: kind === "verify" ? "Approved. The owner was notified." : "Not approved; the owner was told the reason." });
      setRejecting(false);
      await queryClient.invalidateQueries({ queryKey: ["admin-identities"] });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (full.isError) return <ErrorState message={friendlyErrorMessage(full.error)} onRetry={() => full.refetch()} />;
  if (!data) return <SkeletonCard />;
  return (
    <View style={{ gap: space[3] }} testID="admin-identity-detail">
      <Text variant="title" selectable>{data.number}</Text>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        {[data.front_url, data.back_url].map((uri, i) => (
          <Image key={i} source={{ uri }} contentFit="contain" style={{ flex: 1, aspectRatio: 1.6, borderRadius: radius.sm, backgroundColor: palette.ground }} accessibilityLabel={i === 0 ? "CNIC front" : "CNIC back"} />
        ))}
      </View>
      {data.status !== "verified" ? (
        rejecting ? (
          <View style={{ gap: space[2] }}>
            <Input label="Reason (the owner sees it, required)" value={reason} onChangeText={setReason} multiline testID="admin-identity-reason" />
            <Button label="Send with this reason" variant="dangerSolid" block disabled={reason.trim().length < 3} loading={busy} onPress={() => decide("reject")} />
            <Button label="Back" variant="soft" size="md" block onPress={() => setRejecting(false)} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Button label="Approve" size="md" loading={busy} onPress={() => decide("verify")} testID="admin-identity-verify" />
            {data.status !== "rejected" ? <Button label="Not approve" variant="danger" size="md" onPress={() => setRejecting(true)} testID="admin-identity-reject" /> : null}
          </View>
        )
      ) : null}
      {message ? <Banner tone={message.ok ? "open" : "danger"} body={message.text} /> : null}
    </View>
  );
}
