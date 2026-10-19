import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { approvalSummary, type ApprovalQueueItem, type ApproveAcceptMode } from "@court-booking/types";

import { formatPKR } from "@/lib/format";
import { OV } from "@/lib/overview";
import { STATE_CHIP, isGrey, parsePkr, slotWhen } from "@/lib/round2-format";
import { AlertTriangleIcon, BanIcon, CheckIcon, XIcon } from "@/components/icons";
import { AlertCircleIcon } from "@/components/overview/icons";
import { BottomSheet, OrangeButton, OutlineButton } from "@/components/overview/ui";
import { BookingLinks } from "@/components/booking-links";
import { ScreenshotThumb } from "@/components/screenshot-viewer";

export const REJECT_REASONS = ["Amount match nahi karta", "Screenshot parha nahi ja raha", "Duplicate lagta hai", "Kuch aur"];

/** Expected vs screenshot amount, icon + text (colour is never the only signal). */
function AmountChip({ item }: { item: ApprovalQueueItem }) {
  const v = item.ocr_verdict;
  const tone =
    v === "match"
      ? { bg: OV.greenBg, fg: OV.greenDark, icon: <CheckIcon size={13} color={OV.greenDark} strokeWidth={2.6} />, word: "Match" }
      : v === "mismatch"
        ? { bg: OV.redBg, fg: OV.red, icon: <XIcon size={13} color={OV.red} />, word: "Farq hai" }
        : { bg: "#EFF2F3", fg: OV.muted, icon: <AlertCircleIcon size={13} color={OV.muted} />, word: "Parha nahi gaya" };
  const text =
    item.ocr_amount != null
      ? `${tone.word}: screenshot PKR ${formatPKR(item.ocr_amount)} - chahiye PKR ${formatPKR(item.expected_amount)}`
      : `${tone.word}: chahiye PKR ${formatPKR(item.expected_amount)}, screenshot khud dekhein`;
  return (
    <View testID="amount-chip" className="flex-row items-center gap-1.5 self-start rounded-full px-3" style={{ minHeight: 30, backgroundColor: tone.bg }}>
      {tone.icon}
      <Text className="font-plex-semibold text-[12.5px]" style={{ color: tone.fg, flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** Stage 2 (B.a): "this screenshot was already used on N other bookings" (icon + text). */
export function duplicateText(n: number): string {
  return `Ye screenshot pehle bhi ${n} ${n === 1 ? "booking" : "bookings"} par use hua hai`;
}

function DuplicateChip({ n }: { n: number }) {
  return (
    <View testID="duplicate-chip" className="flex-row items-center gap-1.5 self-start rounded-full px-3" style={{ minHeight: 30, backgroundColor: OV.redBg, borderWidth: 1, borderColor: OV.redBorder }}>
      <AlertTriangleIcon size={14} color={OV.red} />
      <Text className="font-plex-bold text-[12.5px]" style={{ color: OV.red, flexShrink: 1 }}>
        {`Duplicate: ${duplicateText(n)}`}
      </Text>
    </View>
  );
}

export function ApprovalCard({
  item,
  courtText,
  busy,
  error,
  locked = false,
  onDetails,
  onApprove,
  onReject,
  onAcknowledge,
}: {
  item: ApprovalQueueItem;
  courtText: string;
  busy: boolean;
  error: string | null;
  /** Staff without the approve permission (known up front from /owners/me/permissions, or after a 403
   * NOT_STAFF_PERMITTED): no action buttons, one clear note. */
  locked?: boolean;
  onDetails: () => void;
  onApprove: () => void;
  onReject: () => void;
  onAcknowledge: (moneyReceived: boolean) => void;
}) {
  const grey = isGrey(item);
  const initials = (item.player_name ?? "?").slice(0, 2).toUpperCase();
  return (
    <View
      testID={grey ? "approval-card-grey" : "approval-card"}
      accessibilityLabel={`${item.player_name ?? "Player"} approval`}
      className="rounded-2xl p-4 gap-3"
      style={{ backgroundColor: grey ? "#F1F3F4" : "#FFFFFF", borderWidth: 1.5, borderColor: grey ? "#D3DADD" : OV.border, opacity: 1 }}
    >
      {grey ? (
        <View className="flex-row items-center gap-1.5 self-start rounded-full px-3" style={{ minHeight: 30, backgroundColor: "#E3E7E9" }}>
          <BanIcon size={13} color={OV.muted} />
          <Text className="font-plex-bold text-[12.5px]" style={{ color: "#3E5058" }}>
            {STATE_CHIP[item.state as Exclude<typeof item.state, "awaiting">]}
          </Text>
        </View>
      ) : null}

      <View className="flex-row items-center gap-3">
        <View className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: grey ? "#8399A1" : OV.accent }}>
          <Text className="font-plex-semibold text-white text-[15px]">{initials}</Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="font-plex-bold text-[16px]" style={{ color: grey ? "#3E5058" : OV.ink }}>
            {item.player_name ?? "Player"}
          </Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[13px]">{courtText}</Text>
          <Text testID="approval-when" className="font-plex-semibold text-[13.5px]" style={{ color: grey ? "#3E5058" : OV.ink }}>
            {slotWhen(item.starts_at, item.ends_at)}
          </Text>
        </View>
      </View>

      {!grey ? <AmountChip item={item} /> : null}
      {!grey && item.duplicate ? <DuplicateChip n={item.duplicate.used_on_bookings} /> : null}
      {item.has_screenshot || item.proof_url ? <ScreenshotThumb paymentId={item.payment_id} url={item.proof_url} alt={`${item.player_name ?? "Player"} ka screenshot`} /> : null}

      <BookingLinks bookingId={item.booking_id} startsAt={item.starts_at} onDetails={onDetails} />

      {error ? <Text className="font-plex-medium text-owner-danger text-[12.5px]">{error}</Text> : null}

      {locked ? (
        <View testID="approval-locked" className="rounded-xl px-3.5 py-3" style={{ backgroundColor: "#F1F3F4", borderWidth: 1, borderColor: "#D3DADD" }}>
          <Text className="font-plex-semibold text-owner-ink text-[13px]">Aap ke paas is kaam ki ijazat nahi. Owner se ijazat mangein.</Text>
        </View>
      ) : grey ? (
        item.has_screenshot ? (
          <View className="gap-2">
            <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">Player ne screenshot bheja tha. Kya paisa aapke account mein aaya?</Text>
            <ActionButton label="Paisa nahi aaya - Theek hai" tone="outline" disabled={busy} onPress={() => onAcknowledge(false)} />
            <ActionButton label="Paisa aa gaya - Refund banayein" tone="teal" disabled={busy} onPress={() => onAcknowledge(true)} />
          </View>
        ) : (
          <ActionButton label="Theek hai" tone="teal" disabled={busy} onPress={() => onAcknowledge(false)} />
        )
      ) : (
        <View className="flex-row gap-2.5">
          <ActionButton flex label="Approve" tone="green" disabled={busy} onPress={onApprove} />
          <ActionButton label="Reject" tone="reject" disabled={busy} onPress={onReject} />
        </View>
      )}
    </View>
  );
}

function ActionButton({
  label,
  tone,
  onPress,
  disabled,
  flex,
}: {
  label: string;
  tone: "green" | "reject" | "teal" | "outline";
  onPress: () => void;
  disabled?: boolean;
  flex?: boolean;
}) {
  const s = {
    green: { bg: "#1F7A52", fg: "#FFFFFF", border: "#1F7A52" },
    reject: { bg: "#FFFFFF", fg: "#A8432C", border: "#DDBAB1" },
    teal: { bg: OV.accent, fg: "#FFFFFF", border: OV.accent },
    outline: { bg: "#FFFFFF", fg: OV.ink, border: OV.ink },
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: flex ? 1 : undefined,
        minWidth: flex ? undefined : 104,
        minHeight: 48,
        paddingHorizontal: 14,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: s.bg,
        borderWidth: 1.5,
        borderColor: s.border,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text className="font-plex-semibold text-[14.5px]" style={{ color: s.fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Approve: confirm the amount really received; when the screenshot shows MORE than the advance, a banner with two choices. */
export function ApproveSheet({
  item,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (amount: number | undefined, mode: ApproveAcceptMode | undefined) => void;
}) {
  const over = item.overpayment;
  const checks = item.checks ?? null;
  const [text, setText] = useState(String(over?.ocr_amount ?? checks?.paid_amount ?? item.expected_amount));
  const [mode, setMode] = useState<ApproveAcceptMode>("advance_only");
  const amount = parsePkr(text);
  const summary = checks && amount !== null && amount > 0 ? approvalSummary(checks, amount, "ru") : null;
  const valid = !checks || (amount !== null && amount > 0);

  return (
    <BottomSheet
      title="Approve karein?"
      subtitle={`${item.player_name ?? "Player"} - ${slotWhen(item.starts_at, item.ends_at)}`}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <OrangeButton
            flex
            label={busy ? "Approve ho raha hai" : "Approve karein"}
            disabled={!valid || busy}
            onPress={() => onConfirm(checks ? (amount ?? undefined) : undefined, over ? mode : undefined)}
          />
        </View>
      }
    >
      {over ? (
        <View testID="overpayment-banner" className="rounded-xl p-3.5 gap-1" style={{ backgroundColor: OV.amberBg, borderWidth: 1, borderColor: OV.amberBorder }}>
          <Text className="font-plex-bold text-[14px]" style={{ color: OV.amberDark }}>
            {`Screenshot mein PKR ${formatPKR(over.ocr_amount)} hain, advance sirf PKR ${formatPKR(over.expected)} chahiye tha.`}
          </Text>
          <Text className="font-plex-medium text-[12.5px]" style={{ color: OV.amberDark }}>
            Screenshot ki parhai sirf ishara hai. Faisla aap karein.
          </Text>
        </View>
      ) : null}
      {over ? (
        <View className="gap-2" accessibilityRole="radiogroup">
          <Choice
            selected={mode === "advance_only"}
            onPress={() => setMode("advance_only")}
            label={`Sirf PKR ${formatPKR(over.expected)} manzoor - baqi PKR ${formatPKR(over.excess)} wapas karna hoga`}
            sub="Baqi raqam Refunds mein chali jayegi."
          />
          <Choice
            selected={mode === "full"}
            onPress={() => setMode("full")}
            label={`Poora PKR ${formatPKR(over.ocr_amount)} manzoor (extra advance)`}
            sub="Poori raqam is booking ki payment mein jama hogi."
          />
        </View>
      ) : null}

      {checks ? (
        <View className="gap-1.5">
          <Text className="font-plex-semibold text-owner-ink text-[13.5px]">Asal mein kitna mila? (PKR)</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
            accessibilityLabel="Asal mein kitna mila, PKR"
            className="font-mono-medium text-owner-ink"
            style={{ minHeight: 48, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1.5, borderColor: valid ? OV.border : OV.red, fontSize: 15 }}
          />
          {summary ? (
            <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">
              {`${summary.text}. Approve ke baad mila PKR ${formatPKR(summary.totalAfter)}, venue par baqi PKR ${formatPKR(summary.balanceAfter)}.`}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Text className="font-plex-medium text-owner-danger text-[13px]">{error}</Text> : null}
    </BottomSheet>
  );
}

function Choice({ selected, onPress, label, sub }: { selected: boolean; onPress: () => void; label: string; sub: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: selected ? 2 : 1.5, borderColor: selected ? OV.accent : OV.border, backgroundColor: selected ? OV.accentSoft : "#FFFFFF" }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? OV.accent : OV.faint, alignItems: "center", justifyContent: "center" }}>
        {selected ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: OV.accent }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text className="font-plex-semibold text-owner-ink text-[14px]">{label}</Text>
        <Text className="font-plex-medium text-owner-ink-faint text-[12px]">{sub}</Text>
      </View>
    </Pressable>
  );
}

/** Stage 2 (B.a): a SEPARATE confirm before approving a screenshot that was already used on other bookings (also opened
 * when the server answers 409 DUPLICATE_PROOF_CONFIRM_REQUIRED). Only "Phir bhi approve karein" sends confirm_duplicate. */
export function DuplicateConfirmSheet({
  item,
  usedOn,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  usedOn: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      title="Duplicate screenshot"
      subtitle={`${item.player_name ?? "Player"} - ${slotWhen(item.starts_at, item.ends_at)}`}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <Pressable
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Phir bhi approve karein"
            style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#8C3823", opacity: busy ? 0.5 : 1 }}
          >
            <Text className="font-plex-bold text-white text-[14px]">{busy ? "Approve ho raha hai" : "Phir bhi approve karein"}</Text>
          </Pressable>
        </View>
      }
    >
      <View testID="duplicate-confirm" className="flex-row items-start gap-2.5 rounded-xl p-3.5" style={{ backgroundColor: OV.redBg, borderWidth: 1, borderColor: OV.redBorder }}>
        <AlertTriangleIcon size={20} color={OV.red} />
        <Text className="flex-1 font-plex-bold text-[14.5px]" style={{ color: OV.red }}>
          {`${duplicateText(usedOn)}. Phir bhi approve karein?`}
        </Text>
      </View>
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">
        Pehle apne account mein check karein ke ye paisa is booking ke liye alag se aaya hai.
      </Text>
      {error ? <Text className="font-plex-medium text-owner-danger text-[13px]">{error}</Text> : null}
    </BottomSheet>
  );
}

/** Reject: pick a reason (or write one); the keyboard's own mic does voice typing (no native module). */
export function RejectSheet({
  item,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const reason = picked === "Kuch aur" ? note.trim() : picked;
  return (
    <BottomSheet
      title="Reject kyun?"
      subtitle={`${item.player_name ?? "Player"} - ${slotWhen(item.starts_at, item.ends_at)}`}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <Pressable
            onPress={() => reason && onConfirm(reason)}
            disabled={!reason || busy}
            accessibilityRole="button"
            accessibilityLabel="Reject karein"
            style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#8C3823", opacity: !reason || busy ? 0.5 : 1 }}
          >
            <Text className="font-plex-bold text-white text-[14px]">{busy ? "Reject ho raha hai" : "Reject karein"}</Text>
          </Pressable>
        </View>
      }
    >
      <View className="flex-row flex-wrap gap-2">
        {REJECT_REASONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => setPicked(r)}
            accessibilityRole="button"
            accessibilityState={{ selected: picked === r }}
            style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 10, justifyContent: "center", backgroundColor: picked === r ? "#8C3823" : "#F4F6F7" }}
          >
            <Text className="font-plex-semibold text-[13px]" style={{ color: picked === r ? "#FFFFFF" : OV.muted }}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={note}
        onChangeText={(t) => {
          setNote(t);
          if (t.trim() && picked !== "Kuch aur") setPicked("Kuch aur");
        }}
        multiline
        textAlignVertical="top"
        placeholder="Apni wajah likhein"
        placeholderTextColor={OV.faint}
        accessibilityLabel="Reject ki wajah"
        className="font-plex-medium text-owner-ink text-[15px]"
        style={{ minHeight: 88, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: OV.border }}
      />
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">Keyboard ke mic se bolein</Text>
      {error ? <Text className="font-plex-medium text-owner-danger text-[13px]">{error}</Text> : null}
    </BottomSheet>
  );
}
