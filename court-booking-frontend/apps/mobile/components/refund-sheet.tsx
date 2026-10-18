import { useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery } from "@tanstack/react-query";
import { isPlausibleRefundReference, refundAmountError, refundBreakdown, type OwnerRefund, type RefundBreakdown } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";
import { OV } from "@/lib/overview";
import { parsePkr } from "@/lib/round2-format";
import { BottomSheet, OrangeButton, OutlineButton } from "@/components/overview/ui";
import { ScreenshotThumb } from "@/components/screenshot-viewer";

/** The four numbers, top to bottom, so "more than owed" is never shown without them. */
export function RefundBreakdownCard({ b }: { b: RefundBreakdown }) {
  const rows: [string, string, boolean][] = [
    ["Player ne bheje", b.playerSent != null ? `PKR ${formatPKR(b.playerSent)}` : "-", false],
    ["Refund banta hai (policy)", `PKR ${formatPKR(b.refundDue)}`, false],
    ["Pehle wapas kiye", `PKR ${formatPKR(b.alreadyRefunded)}`, false],
    ["Ab baqi wapas dena", `PKR ${formatPKR(b.remaining)}`, true],
  ];
  return (
    <View testID="refund-breakdown" className="rounded-2xl px-4 py-2" style={{ backgroundColor: "#F4F6F7" }}>
      {rows.map(([label, value, strong], i) => (
        <View
          key={label}
          className="flex-row items-center justify-between py-2"
          style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#E3E9EB" }}
        >
          <Text className={`${strong ? "font-plex-bold" : "font-plex-medium"} text-owner-ink text-[13.5px]`}>{label}</Text>
          <Text className={`${strong ? "font-mono-semibold" : "font-mono-medium"} text-owner-ink text-[14px]`}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

type Picked = { uri: string; blob?: Blob; name: string; type: string };

/** Round 2 (A10): record a refund the owner sent outside the app. Amount prefilled with what is still owed (max), a
 * "Poora PKR X" chip, reference required, screenshot optional, one submit only, then a summary. */
export function RefundSheet({ refund, title, onClose, onDone }: { refund: OwnerRefund; title: string; onClose: () => void; onDone: () => void }) {
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
  const refOk = isPlausibleRefundReference(reference);
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
      const saved = await api.owners.markRefundPaid(refund.id, reference.trim(), typed as number, shot, picked?.name, picked?.type);
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
      <BottomSheet title="Refund record ho gaya" subtitle={title} onClose={onDone} footer={<OrangeButton label="Theek hai" onPress={onDone} />}>
        <View testID="refund-success" className="rounded-xl p-3.5 gap-1" style={{ backgroundColor: OV.greenBg }}>
          <Text className="font-plex-bold text-[15px]" style={{ color: OV.greenDark }}>
            {`PKR ${formatPKR(typed as number)} wapas record ho gaya.`}
          </Text>
          <Text className="font-plex-medium text-[13px]" style={{ color: OV.greenDark }}>
            {`Reference: ${reference.trim()}${picked ? " - screenshot ke saath" : ""}`}
          </Text>
          <Text className="font-plex-medium text-[13px]" style={{ color: OV.greenDark }}>
            {after.remaining > 0 ? `Hissa wapas: abhi PKR ${formatPKR(after.remaining)} baqi hai.` : "Poora refund ho gaya."}
          </Text>
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
          <View className="flex-row gap-3">
            <OutlineButton flex label="Cancel" onPress={onClose} />
            <OrangeButton flex label={busy ? "Save ho raha hai" : "Refund record karein"} disabled={!canSubmit} onPress={submit} />
          </View>
        ) : (
          <OutlineButton label="Band karein" onPress={onClose} />
        )
      }
    >
      <RefundBreakdownCard b={b} />
      {paymentId ? <ScreenshotThumb paymentId={paymentId} alt="Player ka payment screenshot" /> : null}

      {remaining <= 0 ? (
        <View testID="refund-none" className="rounded-xl p-3.5 gap-1" style={{ backgroundColor: OV.accentSoft }}>
          <Text className="font-plex-bold text-owner-ink text-[15px]">Koi refund baqi nahi</Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[13px]">
            {b.status === "done" || b.alreadyRefunded > 0
              ? `Poora refund (PKR ${formatPKR(b.alreadyRefunded)}) pehle hi bheja ja chuka hai${refund.refunded_at ? `, ${formatWhen(refund.refunded_at)}` : ""}.`
              : "Policy ke hisaab se is booking par koi paisa wapas nahi banta."}
          </Text>
        </View>
      ) : (
        <>
          <View className="flex-row items-center justify-between gap-3 mt-1">
            <Text className="font-plex-bold text-owner-ink text-[14px]">Kitna wapas bheja? (PKR)</Text>
            <Pressable
              onPress={() => setAmountText(String(remaining))}
              accessibilityRole="button"
              accessibilityLabel={`Poora PKR ${formatPKR(remaining)}`}
              style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: "center", backgroundColor: OV.accentSoft }}
            >
              <Text className="font-plex-semibold text-owner-accent text-[12.5px]">{`Poora PKR ${formatPKR(remaining)}`}</Text>
            </Pressable>
          </View>
          <TextInput
            value={amountText}
            onChangeText={(t) => {
              setAmountText(t);
              setServerError(null);
            }}
            keyboardType="number-pad"
            accessibilityLabel="Kitna wapas bheja, PKR"
            className="rounded-xl px-4 font-mono-medium text-owner-ink text-[16px]"
            style={{ minHeight: 50, borderWidth: 1.5, borderColor: amountMessage ? OV.red : OV.border }}
          />
          <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{`Zyada se zyada PKR ${formatPKR(remaining)}. Kam bhejein to "Hissa wapas" rahega.`}</Text>
          {amountMessage ? <Text testID="refund-amount-error" className="font-plex-semibold text-owner-danger text-[13px]">{amountMessage}</Text> : null}

          <Text className="font-plex-bold text-owner-ink text-[14px] mt-1">Reference (zaroori)</Text>
          <TextInput
            value={reference}
            onChangeText={setReference}
            onBlur={() => setTouchedRef(true)}
            placeholder="JazzCash TXN 12345 ya bank ref"
            placeholderTextColor={OV.faint}
            accessibilityLabel="Reference"
            autoCapitalize="characters"
            className="rounded-xl px-4 font-plex-medium text-owner-ink text-[15px]"
            style={{ minHeight: 50, borderWidth: 1.5, borderColor: touchedRef && !refOk ? OV.red : OV.border }}
          />
          {touchedRef && !refOk ? (
            <Text className="font-plex-semibold text-owner-danger text-[12.5px]">Transaction ka reference likhein (kam az kam 4 harf ya number).</Text>
          ) : null}

          <Text className="font-plex-bold text-owner-ink text-[14px] mt-1">Screenshot (zaroori nahi)</Text>
          <View className="flex-row items-center gap-3">
            <OutlineButton label={picked ? "Screenshot badlein" : "Screenshot lagayein"} onPress={pickImage} />
            {picked ? <Text className="flex-1 font-plex-medium text-owner-ink-muted text-[12.5px]" numberOfLines={1}>{picked.name}</Text> : null}
          </View>
          {serverError ? <Text className="font-plex-semibold text-owner-danger text-[13px]">{serverError}</Text> : null}
        </>
      )}
    </BottomSheet>
  );
}
