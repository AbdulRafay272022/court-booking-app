import { useRef, useState } from "react";
import { Platform, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery } from "@tanstack/react-query";
import { isPlausibleRefundReference, refundAmountError, refundBreakdown, type OwnerRefund, type RefundBreakdown } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";
import { space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, Input, MoneyRows, Text } from "@/components/ui";
import { parsePkr } from "@/lib/round2-format";
import { BottomSheet, OutlineButton, PrimaryButton } from "@/components/overview/ui";
import { ScreenshotThumb } from "@/components/screenshot-viewer";
import { useAuthStore } from "@/lib/auth-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { Choice, usePT } from "@/components/paisa/kit";

/** The four numbers, top to bottom, so "more than owed" is never shown without them. */
export function RefundBreakdownCard({ b }: { b: RefundBreakdown }) {
  return (
    <MoneyRows
      testID="refund-breakdown"
      rows={[
        { label: "Player ne bheje", value: b.playerSent != null ? `PKR ${formatPKR(b.playerSent)}` : "-" },
        { label: "Refund banta hai (policy)", value: `PKR ${formatPKR(b.refundDue)}` },
        { label: "Pehle wapas kiye", value: `PKR ${formatPKR(b.alreadyRefunded)}` },
        { label: "Ab baqi wapas dena", value: `PKR ${formatPKR(b.remaining)}`, strong: true },
      ]}
    />
  );
}

type Picked = { uri: string; blob?: Blob; name: string; type: string };

/** Round 2 (A10): record a refund the owner sent outside the app. Amount prefilled with what is still owed (max), a
 * "Poora PKR X" chip, reference required, screenshot optional, one submit only, then a summary. */
export function RefundSheet({ refund, title, onClose, onDone, v2 = false }: { refund: OwnerRefund; title: string; onClose: () => void; onDone: () => void; v2?: boolean }) {
  // ledger v2 (contract 2.6): "Kaise bheja?" Transfer (reference required) or Cash (note required); the owner may keep it as
  // the player's credit instead ("Jama rakhein").
  const pt = usePT();
  const isStaff = useAuthStore((s) => s.user?.role) === "staff";
  const { activeVenueId } = useOwnerVenues();
  const [how, setHow] = useState<"transfer" | "cash">("transfer");
  const [note, setNote] = useState("");
  const b = refundBreakdown(refund);
  const remaining = Math.round(b.remaining);
  const [amountText, setAmountText] = useState(String(remaining));
  const [reference, setReference] = useState("");
  const [touchedRef, setTouchedRef] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<OwnerRefund | null>(null);
  const inFlight = useRef(false);

  // The player's own screenshot, for reference (the refund row carries no payment id; the booking detail does).
  const detail = useQuery({ queryKey: ["owner-booking-detail", refund.booking_id], queryFn: () => api.owners.bookingDetail(refund.booking_id) });
  const paymentId = detail.data?.payment_id ?? null;

  const typed = parsePkr(amountText);
  const amountProblem = typed === null ? "empty" : refundAmountError(typed, remaining);
  const amountMessage =
    amountProblem === "exceeds"
      ? `Aap ne ${formatPKR(typed as number)} likha, lekin sirf PKR ${formatPKR(remaining)} wapas banta hai.`
      : amountProblem === "not_positive"
        ? "0 se zyada raqam likhein."
        : amountProblem === "empty" && amountText.trim() !== ""
          ? "Sirf poore rupay likhein (jaise 2000)."
          : null;
  const refOk = v2 && how === "cash" ? note.trim().length > 0 : isPlausibleRefundReference(reference);
  const canSubmit = !amountProblem && refOk && !busy;

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setServerError("Screenshot lagane ke liye photos ki ijazat dein (ye zaroori nahi hai).");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setPicked({ uri: a.uri, blob: a.file ?? undefined, name: a.fileName ?? "refund.jpg", type: a.mimeType ?? "image/jpeg" });
  }

  async function submit() {
    setTouchedRef(true);
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setServerError(null);
    try {
      const shot = picked ? (Platform.OS === "web" && picked.blob ? picked.blob : picked.uri) : undefined;
      const saved = v2
        ? await api.owners.markRefundPaid(refund.id, how === "cash" ? "" : reference.trim(), typed as number, shot, picked?.name, picked?.type, { method: how, note: note.trim() || undefined })
        : await api.owners.markRefundPaid(refund.id, reference.trim(), typed as number, shot, picked?.name, picked?.type);
      setDone(saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "REFUND_EXCEEDS_OWED_AMOUNT") {
        const d = (e.details ?? {}) as { remaining?: number; typed?: number };
        setServerError(`Aap ne ${formatPKR(d.typed ?? (typed as number))} likha, lekin sirf PKR ${formatPKR(d.remaining ?? remaining)} wapas banta hai.`);
      } else if (e instanceof ApiError && e.code === "REFUND_ALREADY_MARKED") {
        setServerError("Ye refund pehle hi record ho chuka hai.");
      } else {
        setServerError(friendlyErrorMessage(e));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (done) {
    const after = refundBreakdown(done);
    return (
      <BottomSheet title="Refund record ho gaya" subtitle={title} onClose={onDone} footer={<PrimaryButton label="Theek hai" onPress={onDone} />}>
        <View testID="refund-success">
          <Banner
            tone="open"
            title={`PKR ${formatPKR(typed as number)} wapas record ho gaya.`}
            body={`Reference: ${reference.trim()}${picked ? " - screenshot ke saath" : ""}. ${after.remaining > 0 ? `Hissa wapas: abhi PKR ${formatPKR(after.remaining)} baqi hai.` : "Poora refund ho gaya."}`}
          />
        </View>
        <RefundBreakdownCard b={after} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      title="Refund bhej diya?"
      subtitle={title}
      onClose={onClose}
      footer={
        remaining > 0 ? (
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <OutlineButton flex label="Cancel" onPress={onClose} />
            <PrimaryButton flex label={busy ? "Save ho raha hai" : "Refund record karein"} disabled={!canSubmit} onPress={submit} />
          </View>
        ) : (
          <OutlineButton label="Band karein" onPress={onClose} />
        )
      }
    >
      <RefundBreakdownCard b={b} />
      {paymentId ? <ScreenshotThumb paymentId={paymentId} alt="Player ka payment screenshot" /> : null}

      {remaining <= 0 ? (
        <View testID="refund-none">
          <Banner
            tone="info"
            title="Koi refund baqi nahi"
            body={
              b.status === "done" || b.alreadyRefunded > 0
                ? `Poora refund (PKR ${formatPKR(b.alreadyRefunded)}) pehle hi bheja ja chuka hai${refund.refunded_at ? `, ${formatWhen(refund.refunded_at)}` : ""}.`
                : "Policy ke hisaab se is booking par koi paisa wapas nahi banta."
            }
          />
        </View>
      ) : (
        <>
          <Chip label={`Poora PKR ${formatPKR(remaining)}`} onPress={() => setAmountText(String(remaining))} accessibilityLabel={`Poora PKR ${formatPKR(remaining)}`} />
          <Input
            label="Kitna wapas bheja? (PKR)"
            value={amountText}
            onChangeText={(t) => {
              setAmountText(t);
              setServerError(null);
            }}
            keyboardType="number-pad"
            accessibilityLabel="Kitna wapas bheja, PKR"
            help={`Zyada se zyada PKR ${formatPKR(remaining)}. Kam bhejein to "Hissa wapas" rahega.`}
            error={amountMessage}
          />
          {amountMessage ? <View testID="refund-amount-error" /> : null}
          {v2 ? (
            <View style={{ gap: space[2] }}>
              <Text variant="label">{pt("paisa.refund.how")}</Text>
              <Choice testID="refund-how" value={how} onChange={setHow} options={[{ value: "transfer", label: pt("paisa.rec.transfer") }, { value: "cash", label: pt("paisa.rec.cash") }]} />
            </View>
          ) : null}
          {v2 && how === "cash" ? (
            <Input label={pt("paisa.rec.note")} value={note} onChangeText={setNote} onBlur={() => setTouchedRef(true)}
              error={touchedRef && !note.trim() ? pt("paisa.refund.noteNeeded") : null} testID="refund-note" />
          ) : (
          <Input
            label="Reference (zaroori)"
            value={reference}
            onChangeText={setReference}
            onBlur={() => setTouchedRef(true)}
            placeholder="JazzCash TXN 12345 ya bank ref"
            accessibilityLabel="Reference"
            autoCapitalize="characters"
            error={touchedRef && !refOk ? "Transaction ka reference likhein (kam az kam 4 harf ya number)." : null}
          />
          )}
          <View style={{ gap: space[2] }}>
            <Text variant="label">Screenshot (zaroori nahi)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] }}>
              <Button label={picked ? "Screenshot badlein" : "Screenshot lagayein"} variant="soft" size="sm" onPress={pickImage} />
              {picked ? (
                <Text variant="meta" tone="muted" style={{ flexShrink: 1 }}>
                  {picked.name}
                </Text>
              ) : null}
            </View>
          </View>
          {serverError ? (
            <Text variant="meta" weight="bold" tone="danger">
              {serverError}
            </Text>
          ) : null}
          {v2 && !isStaff && typed !== null && !amountProblem ? (
            <Button
              label={pt("paisa.act.credit")}
              variant="soft"
              size="sm"
              testID="refund-keep-credit"
              onPress={async () => {
                setBusy(true);
                setServerError(null);
                try {
                  await api.paisa.keepRefundAsCredit(refund.id, typed as number, activeVenueId);
                  onDone();
                } catch (e) {
                  setServerError(friendlyErrorMessage(e));
                  setBusy(false);
                }
              }}
            />
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}
