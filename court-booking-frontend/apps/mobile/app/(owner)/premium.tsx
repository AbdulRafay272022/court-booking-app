import { useState } from "react";
import { Image, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { premiumStateText, selectionTotal } from "@court-booking/types";
import type { OwnerInvoice, PlatformPaymentDetails } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { ActionBar, Banner, Button, CopyField, EmptyState, ErrorState, Pill, Screen, SkeletonCard, Switch, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR } from "@/lib/format";
import { NoAccess } from "@/components/no-access";
import { OwnerHeader } from "./_fl";

const INVOICE_STATUS: Record<OwnerInvoice["status"], { label: string; tone: "waiting" | "info" | "open" | "neutral" | "danger" }> = {
  issued: { label: "Aap ki payment baqi", tone: "waiting" },
  proof_submitted: { label: "Payment bheji, check ho rahi hai", tone: "info" },
  paid: { label: "Paid", tone: "open" },
  void: { label: "Cancel", tone: "neutral" },
  expired: { label: "Waqt khatam", tone: "danger" },
};

/** OGrowthTeam frame 4 "Premium": pick only the features you want (PUT /owners/premium/selection), each with the server's
 * own state line (trial, paid through, grace); invoices with bank details to copy and a screenshot upload. Owner only. */
export default function OwnerPremiumScreen() {
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["owner-premium"], queryFn: () => api.premium.get(), enabled: isOwner });
  const data = query.data;

  // The owner's unsaved choices. null = nothing touched yet, so the screen shows what is switched on.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const enabledKeys = new Set((data?.features ?? []).filter((f) => f.enabled).map((f) => f.key));
  const selected = picked ?? enabledKeys;

  const save = useMutation({
    mutationFn: (keys: string[]) => api.premium.setSelection(keys),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["owner-premium"], fresh);
      setPicked(null);
    },
  });

  if (!isOwner) return <NoAccess what="Premium" />;
  const changed = enabledKeys.size !== selected.size || [...selected].some((k) => !enabledKeys.has(k));

  return (
    <Screen
      testID="premium-screen"
      floatingBar={data && data.features.length ? "bar" : null}
      overlay={
        data && data.features.length ? (
          <ActionBar caption="Mahana total" value={`PKR ${formatPKR(selectionTotal(data.features, selected))}`}>
            <Button label={save.isPending ? "Save ho raha hai" : "Choice save karein"} size="md" disabled={!changed || save.isPending} onPress={() => save.mutate([...selected])} />
          </ActionBar>
        ) : undefined
      }
    >
      <OwnerHeader title="Premium" subtitle={data ? `Har feature ka ${data.trial_days} din ka free trial, on karne ke din se. Sirf woh lein jo kaam aaye.` : undefined} />
      {query.isLoading ? (
        <SkeletonCard />
      ) : query.isError || !data ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : (
        <>
          {!data.enforced ? <Banner tone="info" body="Billing abhi shuru nahi hui. Abhi har feature sab ke liye free hai, kuch charge nahi hota." /> : null}
          {save.isError ? <Banner tone="danger" body={friendlyErrorMessage(save.error)} /> : null}
          {data.features.length === 0 ? (
            <EmptyState title="Abhi koi premium feature nahi" body="Naye features aate hi yahan dikhenge." />
          ) : (
            data.features.map((f) => {
              const on = selected.has(f.key);
              const state = premiumStateText(f, data.enforced, data.trial_days);
              return (
                <View key={f.key} testID={`premium-${f.key}`} style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[4], gap: space[2], borderWidth: on ? 2 : 0, borderColor: palette.teal, boxShadow: on ? undefined : shadow.cardSoft }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{f.label}</Text>
                      {f.description ? (
                        <Text variant="meta" tone="muted">
                          {f.description}
                        </Text>
                      ) : null}
                      <Text variant="bodyBold">{`PKR ${formatPKR(f.enabled ? (f.your_price_pkr ?? f.monthly_price_pkr) : f.monthly_price_pkr)} / mahina`}</Text>
                    </View>
                    <Switch
                      label={f.label}
                      showLabel={false}
                      value={on}
                      onChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(f.key);
                        else next.delete(f.key);
                        setPicked(next);
                      }}
                    />
                  </View>
                  {state ? <Pill size="sm" tone={f.entitled || !f.enabled ? "neutral" : "danger"} label={state} /> : null}
                </View>
              );
            })
          )}

          <Text variant="title" accessibilityRole="header" style={{ marginTop: space[2] }}>
            Invoices
          </Text>
          {data.invoices.length === 0 ? (
            <Text variant="body" tone="muted">
              Abhi koi invoice nahi. Pehla invoice free trial khatam hone se taqreeban ek hafta pehle aata hai.
            </Text>
          ) : (
            data.invoices.map((inv) => (
              <View key={inv.id} style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[4], gap: space[2] }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space[2] }}>
                  <Text variant="bodyBold" style={{ flexShrink: 1 }}>{`${formatDateString(inv.period_start)} se ${formatDateString(inv.period_end)}`}</Text>
                  <Text variant="bodyStrong">{`PKR ${formatPKR(inv.total_pkr)}`}</Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
                  <Pill size="sm" tone={INVOICE_STATUS[inv.status].tone} label={INVOICE_STATUS[inv.status].label} />
                  <Text variant="caption" tone="muted">{`Aakhri tareekh ${formatDateString(inv.due_date)}`}</Text>
                </View>
                {inv.lines.map((l) => (
                  <Text key={l.feature_key} variant="caption" tone="muted">{`${l.description ?? l.feature_key}: PKR ${formatPKR(l.amount_pkr)}`}</Text>
                ))}
                {inv.status === "issued" ? <PayBox invoice={inv} instructions={data.payment_instructions} onPaid={(fresh) => queryClient.setQueryData(["owner-premium"], fresh)} /> : null}
              </View>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function PayBox({ invoice, instructions, onPaid }: { invoice: OwnerInvoice; instructions: PlatformPaymentDetails | null; onPaid: (fresh: Awaited<ReturnType<typeof api.premium.get>>) => void }) {
  const [picked, setPicked] = useState<{ uri: string; blob?: Blob; name: string; type: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [permError, setPermError] = useState(false);
  const upload = useMutation({
    mutationFn: (p: { uri: string; blob?: Blob; name: string; type: string }) => api.premium.submitInvoiceProof(invoice.id, p.blob ?? p.uri, p.name, p.type, setProgress),
    onSuccess: (fresh) => {
      setPicked(null);
      onPaid(fresh);
    },
    onSettled: () => setProgress(0),
  });

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setPermError(true);
      return;
    }
    setPermError(false);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPicked({ uri: asset.uri, blob: asset.file, name: asset.fileName ?? "proof.jpg", type: asset.mimeType ?? "image/jpeg" });
  }

  const rows: Array<[string, string]> = instructions
    ? ([
        ["Bank", instructions.bank],
        ["Account title", instructions.account_title],
        ["Account number", instructions.account_number],
        ["IBAN", instructions.iban],
      ] as Array<[string, string]>).filter(([, v]) => !!v)
    : [];

  return (
    <View style={{ gap: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: palette.divider }}>
      {invoice.last_rejection_reason ? <Banner tone="danger" body={`Pichla screenshot qubool nahi hua: ${invoice.last_rejection_reason}. Dobara bhejein.`} /> : null}
      <Text variant="bodyBold">{`PKR ${formatPKR(invoice.total_pkr)} bank transfer karein, phir screenshot bhejein`}</Text>
      {instructions ? rows.map(([label, value]) => <CopyField key={label} label={label} value={value} />) : <Text variant="meta" tone="muted">Payment details abhi nahi. Support se baat karein.</Text>}
      {picked ? <Image source={{ uri: picked.uri }} style={{ width: "100%", height: 160, borderRadius: radius.xs }} resizeMode="contain" /> : null}
      {permError ? <Banner tone="waiting" body="Screenshot lagane ke liye photos ki ijazat dein." /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Button label={picked ? "Doosra chunein" : "Screenshot chunein"} variant="soft" size="sm" onPress={pickImage} />
        <Button label={upload.isPending ? `Bhej rahe hain ${Math.min(100, Math.round(progress * 100))}%` : "Screenshot bhejein"} variant="secondary" size="sm" disabled={!picked || upload.isPending} onPress={() => picked && upload.mutate(picked)} />
      </View>
      {upload.isError ? <Banner tone="danger" body={friendlyErrorMessage(upload.error)} /> : null}
    </View>
  );
}
