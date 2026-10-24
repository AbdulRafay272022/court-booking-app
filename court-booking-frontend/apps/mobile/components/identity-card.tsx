import { palette } from "@court-booking/ui-tokens";
import { Text } from "@/components/ui";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { CnicFields, submitCnicDraft, useCnicDraft } from "./cnic-form";
import { IDENTITY_STATUS_TEXT, cnicDraftComplete } from "./cnic-logic";
import { PrimaryButton, SecondaryButton, SectionCard, SectionLabel } from "../app/(owner)/venue-setup/_components";

export const OWNER_IDENTITY_KEY = ["owner-identity"] as const;

/** GET /owners/identity for the signed-in OWNER (staff never see or send the owner's CNIC). */
export function useOwnerIdentity() {
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  return useQuery({
    queryKey: OWNER_IDENTITY_KEY,
    queryFn: () => api.owners.identity(),
    enabled: isOwner,
    retry: false,
    staleTime: 60_000,
  });
}

/** Venue Settings: CNIC status, the masked number (never the full one), and "replace". */
export function IdentityCard() {
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const q = useOwnerIdentity();
  const queryClient = useQueryClient();
  const draft = useCnicDraft();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!isOwner) return null;

  const identity = q.data;
  const open = editing || identity?.status === "missing";

  async function submit() {
    if (!cnicDraftComplete(draft)) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await submitCnicDraft(draft);
      queryClient.setQueryData(OWNER_IDENTITY_KEY, res);
      setEditing(false);
      setMessage({ ok: true, text: "CNIC jama ho gaya." });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Shanakhti card (CNIC)</SectionLabel>
      {q.isLoading ? (
        <ActivityIndicator color={palette.teal} />
      ) : q.isError || !identity ? (
        <Text variant="meta" tone="subtle">CNIC ki maloomat abhi load nahi ho saki.</Text>
      ) : (
        <View className="gap-1" testID="identity-status">
          <Text variant="body" weight="bold">Status: {IDENTITY_STATUS_TEXT[identity.status]}</Text>
          {identity.masked ? (
            <Text testID="identity-masked" variant="body" tone="muted">
              {identity.masked}
            </Text>
          ) : null}
        </View>
      )}
      {identity && open ? (
        <>
          <CnicFields />
          <PrimaryButton
            label={identity.status === "missing" ? "CNIC jama karein" : "Naya CNIC jama karein"}
            onPress={submit}
            disabled={!cnicDraftComplete(draft) || saving}
            loading={saving}
          />
          {identity.status !== "missing" ? (
            <SecondaryButton
              label="Rehne dein"
              onPress={() => {
                draft.clear();
                setEditing(false);
              }}
            />
          ) : null}
        </>
      ) : identity ? (
        <SecondaryButton label="CNIC badlein" onPress={() => setEditing(true)} />
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" testID="identity-message" variant="meta" weight="bold" style={{ color: message.ok ? palette.tealDeep : palette.danger }}>
          {message.text}
        </Text>
      ) : null}
    </SectionCard>
  );
}
