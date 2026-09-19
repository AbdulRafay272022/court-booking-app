import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { openSupportWhatsApp } from "@/lib/support";
import { ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";

function useCountdown(target: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
}

export default function PaymentProofScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const paymentInstructions = useBookingFlowStore((s) => s.paymentInstructionsByBookingId[id]);

  const [picked, setPicked] = useState<{ uri: string; blob?: Blob; name: string; type: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "held" || status === "payment_submitted" ? 4000 : false;
    },
  });
  const booking = bookingQuery.data;
  const secondsLeft = useCountdown(booking?.status === "held" ? booking.held_until : null);
  const expired = booking?.status === "held" && secondsLeft === 0;

  useEffect(() => {
    if (booking?.status === "cancelled" && booking.cancelled_by === "owner" && !rejectionReason) {
      api.payments
        .listForBooking(id)
        .then((payments) => {
          const rejected = payments.find((p) => p.review_verdict === "rejected");
          setRejectionReason(rejected?.rejection_reason ?? booking.cancellation_reason ?? "The venue couldn't confirm your payment.");
        })
        .catch(() => setRejectionReason(booking.cancellation_reason ?? "The venue couldn't confirm your payment."));
    }
  }, [booking, id, rejectionReason]);

  async function pickImage(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Allow access so you can attach your payment screenshot.");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPicked({
      uri: asset.uri,
      blob: asset.file,
      name: asset.fileName ?? "proof.jpg",
      type: asset.mimeType ?? "image/jpeg",
    });
  }

  async function submitProof() {
    if (!picked) return;
    setSubmitting(true);
    setUploadProgress(0);
    try {
      const result = await api.bookings.submitPaymentProof(
        id,
        picked.blob ?? picked.uri,
        picked.name,
        picked.type,
        setUploadProgress,
      );
      queryClient.setQueryData(["booking", id], result.booking);
      if (result.booking.status === "booked") {
        router.replace({ pathname: "/(player)/booking/[id]/done", params: { id } });
      } else if (result.payment.ocr_verdict === "mismatch") {
        Alert.alert(
          "We noticed a mismatch",
          "The amount in your screenshot doesn't quite match — the venue will review this manually, it may take a bit longer.",
        );
      } else if (result.payment.ocr_verdict === "unreadable") {
        Alert.alert("Couldn't read the screenshot", "The venue will review it manually.");
      }
    } catch (e) {
      Alert.alert("Couldn't submit", friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  }

  useEffect(() => {
    if (booking?.status === "booked") {
      router.replace({ pathname: "/(player)/booking/[id]/done", params: { id } });
    }
  }, [booking?.status, id]);

  const minutes = secondsLeft != null ? Math.floor(secondsLeft / 60) : null;
  const seconds = secondsLeft != null ? secondsLeft % 60 : null;

  if (!booking && bookingQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <ErrorState message={friendlyErrorMessage(bookingQuery.error)} onRetry={() => bookingQuery.refetch()} tone="player" />
      </SafeAreaView>
    );
  }

  if (bookingQuery.isLoading || !booking) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg items-center justify-center" edges={["top", "bottom"]}>
        <ActivityIndicator color="#EF5A2C" />
      </SafeAreaView>
    );
  }

  if (booking.status === "cancelled" && booking.cancelled_by === "owner") {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <View className="px-5 py-5 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
          <Pressable onPress={() => router.replace("/")} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <Text className="font-figtree-bold text-player-ink text-[17px]">Payment review</Text>
        </View>
        <ScrollView contentContainerClassName="p-5 gap-4">
          <View className="items-center gap-3 pt-4 pb-2">
            <View className="w-[60px] h-[60px] rounded-full items-center justify-center" style={{ backgroundColor: "#F8E5E0" }}>
              <Text style={{ fontSize: 26 }}>✕</Text>
            </View>
            <Text className="font-figtree-extrabold text-player-ink text-[22px] -tracking-[0.3px] text-center">
              Payment not confirmed
            </Text>
            <Text className="font-figtree-medium text-player-ink-muted text-[15px] text-center leading-[1.5]">
              The venue couldn't match your screenshot.
            </Text>
          </View>
          <View className="bg-player-surface border-[1.5px] rounded-2xl p-4.5 gap-3" style={{ borderColor: "#DDBAB1" }}>
            <Text className="font-figtree-bold text-[11px] tracking-[0.1em]" style={{ color: "#8C3823" }}>
              WHAT THE VENUE SAID
            </Text>
            <Text className="font-figtree-semibold text-player-ink text-[15px] leading-[1.5]">"{rejectionReason ?? "…"}"</Text>
          </View>
          <Text className="font-figtree-medium text-player-ink-muted text-sm text-center leading-[1.5]">
            Your slot is open again — you're welcome to try booking it once more.
          </Text>
        </ScrollView>
        <View className="px-5 pt-4 pb-6 bg-player-surface border-t border-player-border-light">
          <Pressable onPress={() => router.replace("/(player)/search")} className="h-[54px] rounded-2xl bg-player-accent items-center justify-center">
            <Text className="font-figtree-bold text-white text-base">Find another slot</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (booking.status === "cancelled" || expired) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg items-center justify-center px-8 gap-4" edges={["top", "bottom"]}>
        <Text className="font-figtree-extrabold text-player-ink text-xl text-center">
          {expired ? "This hold expired" : "This booking was cancelled"}
        </Text>
        <Text className="font-figtree-medium text-player-ink-muted text-[15px] text-center leading-[1.5]">
          {expired
            ? "You didn't complete payment in time, so the slot was released."
            : "This slot is available for someone else to book now."}
        </Text>
        <Pressable onPress={() => router.replace("/(player)/search")} className="h-12 px-6 rounded-2xl bg-player-accent items-center justify-center">
          <Text className="font-figtree-bold text-white text-[14.5px]">Try again</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isWaitingReview = booking.status === "payment_submitted";

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 py-4.5 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-figtree-bold text-player-ink text-[17px] flex-1">{isWaitingReview ? "Waiting for the venue" : "Pay to hold your slot"}</Text>
        <Pressable
          onPress={() => openSupportWhatsApp(`I need help with a payment for booking ${id}`)}
          accessibilityLabel="Need help? WhatsApp us"
        >
          <Text className="font-figtree-semibold text-player-accent text-[13px]">Need help?</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="p-5 gap-4">
        {booking.status === "held" && secondsLeft != null ? (
          <View
            className="flex-row items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{ backgroundColor: secondsLeft < 120 ? "#F8E5E0" : "#FDF6E9" }}
          >
            <Text className="font-mono-semibold text-[13px]" style={{ color: secondsLeft < 120 ? "#8C3823" : "#8A5A0A" }}>
              Held · {minutes}:{String(seconds).padStart(2, "0")} left
            </Text>
          </View>
        ) : null}

        <View className="bg-player-ink rounded-2xl p-5.5 gap-1.5">
          <Text className="font-figtree-bold text-[11px] tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.6)" }}>
            {isWaitingReview ? "SENT" : "ADVANCE DUE NOW"}
          </Text>
          <Text className="font-mono-semibold text-white text-[38px] -tracking-[0.5px]">
            {formatPKR(booking.advance_amount)}
          </Text>
          <Text className="font-figtree-medium text-[13.5px]" style={{ color: "rgba(255,255,255,0.65)" }}>
            Balance {formatPKR(booking.balance_due)} payable at the venue
          </Text>
        </View>

        {isWaitingReview ? (
          <View className="bg-player-surface border border-player-border-light rounded-2xl p-4.5 flex-row items-center gap-3">
            <ActivityIndicator color="#8A5A0A" />
            <Text className="font-figtree-medium text-player-ink-muted text-sm flex-1 leading-[1.4]">
              The venue is reviewing your screenshot. This page will update automatically.
            </Text>
          </View>
        ) : (
          <>
            {paymentInstructions ? (
              <View className="bg-player-surface border border-player-border-light rounded-2xl p-4.5 gap-3.5">
                <Text className="font-figtree-bold text-[11px] tracking-[0.1em] text-player-ink-fainter">SEND TO</Text>
                {paymentInstructions.bank ? <PayRow label="Bank" value={paymentInstructions.bank} /> : null}
                {paymentInstructions.account_title ? <PayRow label="Account title" value={paymentInstructions.account_title} /> : null}
                {paymentInstructions.account_number ? <PayRow label="Account number" value={paymentInstructions.account_number} mono /> : null}
                {paymentInstructions.iban ? <PayRow label="IBAN" value={paymentInstructions.iban} mono /> : null}
              </View>
            ) : (
              <View className="bg-player-surface border border-player-border-light rounded-2xl p-4.5">
                <Text className="font-figtree-medium text-player-ink-faint text-[13px] leading-[1.5]">
                  Payment details were shown when this hold was created — check your chat with the venue if you need them again.
                </Text>
              </View>
            )}

            {picked ? (
              <View className="bg-player-surface border border-player-border-light rounded-2xl p-3 items-center">
                <Image source={{ uri: picked.uri }} style={{ width: "100%", height: 220, borderRadius: 12 }} resizeMode="contain" />
                <Pressable onPress={() => setPicked(null)} className="mt-2">
                  <Text className="font-figtree-semibold text-player-danger text-[13px]">Remove and choose another</Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-2.5">
                <Pressable
                  onPress={() => pickImage(false)}
                  className="border-2 rounded-2xl p-6.5 items-center gap-2"
                  style={{ borderStyle: "dashed", borderColor: "#E0D9D4" }}
                >
                  <Text className="font-figtree-bold text-player-ink text-[15px]">Attach payment screenshot</Text>
                  <Text className="font-figtree-medium text-player-ink-muted text-[13px] text-center leading-[1.4]">
                    We read the amount automatically, so approval is usually instant
                  </Text>
                </Pressable>
                {Platform.OS !== "web" ? (
                  <Pressable onPress={() => pickImage(true)} className="h-12 rounded-2xl border border-player-border items-center justify-center">
                    <Text className="font-figtree-semibold text-player-ink-muted text-[14px]">Use camera instead</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {!isWaitingReview ? (
        <View className="px-5 pt-4 pb-6 bg-player-surface border-t border-player-border-light gap-2.5">
          {submitting ? (
            <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#F4EFEC" }}>
              <View
                className="h-full rounded-full bg-player-accent"
                style={{ width: `${Math.max(6, Math.round(uploadProgress * 100))}%` }}
              />
            </View>
          ) : null}
          <Pressable
            onPress={submitProof}
            disabled={!picked || submitting}
            className="h-[54px] rounded-2xl bg-player-accent items-center justify-center flex-row gap-2"
            style={{ opacity: !picked || submitting ? 0.5 : 1 }}
          >
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text className="font-figtree-bold text-white text-base">
              {submitting ? `Uploading… ${Math.round(uploadProgress * 100)}%` : "Submit payment proof"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function PayRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-figtree-medium text-player-ink-faint text-[14px]">{label}</Text>
      <Text className={mono ? "font-mono-semibold text-player-ink text-[14px]" : "font-figtree-semibold text-player-ink text-[14px]"}>
        {value}
      </Text>
    </View>
  );
}
