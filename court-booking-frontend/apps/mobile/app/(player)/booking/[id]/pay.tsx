import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, Check, CircleHelp, Hourglass, ImagePlus, Landmark } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { formatDate, formatTimeRange } from "@court-booking/types";
import { formatPkr, palette, radius, space, windowMs } from "@court-booking/ui-tokens";

import {
  Banner,
  Button,
  Card,
  CopyField,
  CountdownRing,
  EmptyState,
  ErrorState,
  Header,
  Hero,
  IconButton,
  Screen,
  Sheet,
  Skeleton,
  StepBar,
  Text,
  useCopy,
  useLang,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { safeBack } from "@/lib/safe-back";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { hasPayableDetails } from "@/lib/booking-flow-rules";
import { prepareProofImage, type PreparedProof } from "@/lib/proof-image";
import { isRetryableUploadError } from "@/lib/proof-image-rules";
import { openSupportWhatsApp } from "@/lib/support";
import { cancelErrorCopy, cancelPolicyShort } from "@/lib/player-flow";
import { PlayerOfflineBanner, StepHeading, useBookingPlace, useLightStatusBar, useNow } from "../../_components";

/**
 * Pay board: countdown ring from the REAL hold expiry (booking.held_until), the bank details saved from the hold response
 * (lib/booking-flow-store, persisted: no endpoint returns them again, contract B5), Copy + haptic, a compressed screenshot
 * (lib/proof-image) with an upload bar capped at 100% and an honest retry after a timeout. Anything that is not an open
 * hold goes to the Status screen (done.tsx), which owns the waiting / booked / rejected / expired states.
 */
export default function PayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const copy = useCopy();
  const lang = useLang();
  const toast = useToast();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const now = useNow(1000);
  const insets = useSafeAreaInsets();
  useLightStatusBar();

  const paymentInstructions = useBookingFlowStore((s) => s.paymentInstructionsByBookingId[id]);
  // Persisted store: wait for it before saying "no payment details", or a reopened pay screen flashes the fallback.
  const [instructionsReady, setInstructionsReady] = useState(() => useBookingFlowStore.persist.hasHydrated());
  useEffect(() => {
    if (instructionsReady) return;
    return useBookingFlowStore.persist.onFinishHydration(() => setInstructionsReady(true));
  }, [instructionsReady]);

  const [picked, setPicked] = useState<PreparedProof | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "held" || status === "payment_submitted" ? 4000 : false;
    },
    subscribed: focused,
  });
  const booking = bookingQuery.data;
  const place = useBookingPlace(booking);
  const expired = booking?.status === "held" && !!booking.held_until && Date.parse(booking.held_until) <= now;

  // Not an open hold any more (screenshot sent, booked, cancelled, rejected): the Status screen tells the honest story.
  useEffect(() => {
    if (booking && booking.status !== "held") router.replace({ pathname: "/(player)/booking/[id]/done", params: { id } });
  }, [booking?.status, id]);

  async function pickImage(fromCamera: boolean) {
    setPermissionNote(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setPermissionNote(copy("Screenshot lagane ke liye photos ki ijazat dein (phone Settings).", "Allow photo access in your phone Settings to attach the screenshot."));
      return;
    }
    const result = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    // Long side <= 1600 px, JPEG 0.7: a few hundred KB instead of 3-8 MB, so it finishes on slow 3G (P0-4).
    setPreparing(true);
    setUploadError(null);
    try {
      setPicked(await prepareProofImage(result.assets[0]));
    } finally {
      setPreparing(false);
    }
  }

  async function submitProof() {
    if (!picked || submitting) return;
    const isRetry = !!uploadError?.retryable;
    setSubmitting(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      // A timed-out upload may still have reached the server: check before sending the same screenshot twice.
      if (isRetry) {
        const fresh = await api.bookings.get(id);
        queryClient.setQueryData(["booking", id], fresh);
        if (fresh.status !== "held") return;
      }
      const result = await api.bookings.submitPaymentProof(id, picked.blob ?? picked.uri, picked.name, picked.type, setUploadProgress);
      queryClient.setQueryData(["booking", id], result.booking);
      void queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
      if (result.payment.ocr_verdict === "mismatch") {
        toast.show({ message: copy("Screenshot ki raqam thori mukhtalif lagi. Venue khud check karega, thora waqt lag sakta hai.", "The amount looks different. The venue will check it by hand; it may take a bit longer."), duration: 6000 });
      } else if (result.payment.ocr_verdict === "unreadable") {
        toast.show({ message: copy("Screenshot parha nahi gaya. Venue khud check karega.", "Couldn't read the screenshot. The venue will check it by hand."), duration: 6000 });
      }
      router.replace({ pathname: "/(player)/booking/[id]/done", params: { id } });
    } catch (e) {
      const retryable = isRetryableUploadError(e);
      setUploadError({
        retryable,
        message: retryable
          ? copy("Upload poora nahi hua, internet slow ho sakta hai. Screenshot yahin hai: Dobara bhejein dabayein.", "The upload didn't finish; your connection may be slow. Your screenshot is still here: tap Send again.")
          : friendlyErrorMessage(e),
      });
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  }

  async function cancelHold() {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const { booking: b } = await api.bookings.cancel(id);
      queryClient.setQueryData(["booking", id], b);
      void queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
      setCancelOpen(false);
    } catch (e) {
      setCancelError(cancelErrorCopy(e instanceof ApiError ? e.code : null, lang, friendlyErrorMessage(e)));
    } finally {
      setCancelling(false);
    }
  }

  if (!booking && bookingQuery.isError) {
    return (
      <Screen>
        <ErrorState
          showTopBack
          title={copy("Booking load nahi hui", "Couldn't load the booking")}
          message={friendlyErrorMessage(bookingQuery.error)}
          onRetry={() => bookingQuery.refetch()}
          onBack={() => safeBack()}
          backLabel={copy("Meri bookings", "My bookings")}
        />
      </Screen>
    );
  }

  if (!booking || booking.status !== "held") {
    return (
      <Screen gutter={false} edgeToEdgeTop>
        <Hero topInset={insets.top} roundedBottom>
          <View style={{ alignItems: "center", gap: space[4], paddingTop: space[8] }} accessibilityLabel={copy("Load ho raha hai", "Loading")}>
            <Skeleton width={150} height={150} r={75} />
            <Skeleton width={160} height={30} />
          </View>
        </Hero>
        <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
          <Skeleton height={220} r={radius.cardL} />
        </View>
      </Screen>
    );
  }

  if (expired) {
    return (
      <Screen>
        <Header title={copy("Hold ka waqt khatam", "The hold expired")} onBack={() => safeBack()} />
        <EmptyState
          icon={Hourglass}
          title={copy("Ye slot ab aap ke liye hold nahi", "This slot is no longer held for you")}
          body={copy(
            "Waqt par screenshot nahi aaya, is liye slot dobara khul gaya hai. Agar paisa bhej diya tha to venue se baat karein.",
            "The screenshot didn't arrive in time, so the slot opened again. If you already sent money, talk to the venue.",
          )}
          actionLabel={copy("Naya slot dhoondein", "Find another slot")}
          onAction={() => router.replace("/(player)/search")}
        />
        <Button label={copy("Venue se baat", "Talk to the venue")} variant="soft" size="md" block onPress={() => router.push({ pathname: "/(player)/booking/[id]/chat", params: { id } })} />
      </Screen>
    );
  }

  const venueName = place.venue?.name;
  const courtName = place.court?.name;
  const amount = formatPkr(booking.advance_amount);
  const pct = Math.min(100, Math.max(6, Math.round(uploadProgress * 100)));

  return (
    <Screen gutter={false} edgeToEdgeTop testID="pay-screen">
      <Hero topInset={insets.top} roundedBottom>
        <Header
          size="compact"
          tone="dark"
          title={copy("Slot aap ke liye hold hai", "Your slot is on hold")}
          onBack={() => safeBack()}
          right={
            <IconButton
              icon={CircleHelp}
              variant="onDark"
              accessibilityLabel={copy("Madad (WhatsApp)", "Help (WhatsApp)")}
              onPress={() => openSupportWhatsApp(`I need help with a payment for booking ${id}`)}
            />
          }
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[4], flexWrap: "wrap", justifyContent: "center" }}>
          <CountdownRing
            expiresAt={booking.held_until}
            totalMs={windowMs(booking.created_at, booking.held_until)}
            caption={copy("pay karne ke liye", "left to pay")}
            diameter={140}
            testID="pay-countdown"
          />
          <View style={{ flex: 1, minWidth: 150, gap: 4 }}>
            <Text variant="h2" tone="hero" testID="pay-amount">
              {amount}
            </Text>
            <Text variant="meta" tone="heroMuted">
              {[venueName, courtName].filter(Boolean).join(" · ")}
            </Text>
            <Text variant="meta" tone="heroMuted">
              {`${formatDate(booking.starts_at, new Date(), lang)} · ${formatTimeRange(booking.starts_at, booking.ends_at, lang)}`}
            </Text>
          </View>
        </View>
        <StepBar labels={[copy("Hold", "Hold"), copy("Pay", "Pay"), copy("Venue check", "Venue check"), copy("Booked", "Booked")]} current={1} />
      </Hero>

      <View style={{ paddingHorizontal: space[5], gap: space[4] }}>
        <PlayerOfflineBanner />
        <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }} testID="pay-bank">
          <StepHeading n={1} label={copy(`${amount} bhejein`, `Send ${amount}`)} />
          {!instructionsReady ? (
            <Skeleton height={120} r={radius.input} />
          ) : hasPayableDetails(paymentInstructions) ? (
            <>
              {paymentInstructions.bank || paymentInstructions.account_title ? (
                <View style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
                  <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: palette.tealTint, alignItems: "center", justifyContent: "center" }}>
                    <Landmark size={20} color={palette.tealDeep} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    {paymentInstructions.bank ? <Text variant="bodyStrong">{paymentInstructions.bank}</Text> : null}
                    {paymentInstructions.account_title ? (
                      <Text variant="meta" tone="muted">
                        {copy(`Account ka naam: ${paymentInstructions.account_title}`, `Account name: ${paymentInstructions.account_title}`)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {paymentInstructions.account_number ? (
                <CopyField label={copy("Account number", "Account number")} value={paymentInstructions.account_number} copyLabel={copy("Account number copy karein", "Copy account number")} testID="pay-account" />
              ) : null}
              {paymentInstructions.iban ? <CopyField label="IBAN" value={paymentInstructions.iban} copyLabel={copy("IBAN copy karein", "Copy IBAN")} testID="pay-iban" /> : null}
              <Text variant="meta" tone="muted">
                {[
                  copy("JazzCash, Easypaisa ya kisi bhi bank app se bhejein, phir yahan wapas aayein.", "Send it from JazzCash, Easypaisa or any bank app, then come back here."),
                  booking.balance_due > 0 ? copy(`Venue par baqi: ${formatPkr(booking.balance_due)}.`, `Due at the venue: ${formatPkr(booking.balance_due)}.`) : null,
                  place.venue && cancelPolicyShort(place.venue, lang) ? `${copy("Cancel", "Cancel")}: ${cancelPolicyShort(place.venue, lang)}.` : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Text>
            </>
          ) : (
            <>
              <Banner
                tone="waiting"
                title={copy("Bank details is phone par nahi", "No bank details on this phone")}
                body={copy(
                  "Ye hold shayad WhatsApp ya kisi aur device se bana tha. Details aap ki chat mein hain, ya hum bhej dete hain.",
                  "This hold may have been made on WhatsApp or another device. The details are in your chat, or we can send them.",
                )}
              />
              <Button label={copy("Details WhatsApp par mangwayein", "Get the details on WhatsApp")} variant="soft" size="md" block onPress={() => openSupportWhatsApp(`Please send me the payment details for booking ${id}`)} />
            </>
          )}
        </Card>

        <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }} testID="pay-proof">
          <StepHeading n={2} label={copy("Payment ka screenshot lagayein", "Attach the payment screenshot")} />
          {preparing ? (
            <View style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
              <Skeleton width={64} height={84} r={radius.sm} />
              <Text variant="meta" tone="muted">
                {copy("Screenshot tayyar ho raha hai…", "Preparing your screenshot…")}
              </Text>
            </View>
          ) : picked ? (
            <View style={{ flexDirection: "row", gap: space[3], alignItems: "center", flexWrap: "wrap" }} testID="pay-picked">
              <Image source={{ uri: picked.uri }} style={{ width: 64, height: 84, borderRadius: radius.sm, backgroundColor: palette.mist }} contentFit="cover" accessibilityLabel={copy("Lagaya hua screenshot", "Attached screenshot")} />
              <View style={{ flex: 1, minWidth: 140, gap: 2 }}>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Check size={16} color={palette.open} strokeWidth={3} />
                  <Text variant="bodyBold" tone="open">
                    {copy("Screenshot lag gaya", "Screenshot attached")}
                  </Text>
                </View>
                <Text variant="caption" tone="muted">
                  {copy("Chhota kar diya, jaldi upload hoga", "Made smaller so it uploads fast")}
                </Text>
              </View>
              <Button
                label={copy("Badlein", "Change")}
                variant="soft"
                size="sm"
                disabled={submitting}
                onPress={() => {
                  setPicked(null);
                  setUploadError(null);
                }}
              />
            </View>
          ) : (
            <View style={{ gap: space[2] }}>
              <Pressable
                testID="pay-pick"
                accessibilityRole="button"
                accessibilityLabel={copy("Gallery se screenshot chunein", "Choose the screenshot from your gallery")}
                onPress={() => pickImage(false)}
                style={({ pressed }) => ({ minHeight: 112, borderRadius: radius.tile, borderWidth: 2, borderStyle: "dashed", borderColor: palette.lineStrong, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4], opacity: pressed ? 0.8 : 1 })}
              >
                <ImagePlus size={26} color={palette.night} />
                <Text variant="bodyBold" align="center">
                  {copy("Screenshot chunein", "Choose screenshot")}
                </Text>
                <Text variant="caption" tone="muted" align="center">
                  {copy("Raqam khud parh li jati hai, approve aksar jaldi hota hai", "We read the amount automatically, so approval is usually quick")}
                </Text>
              </Pressable>
              {Platform.OS !== "web" ? <Button label={copy("Camera se lein", "Use the camera")} variant="soft" size="md" block icon={<Camera size={16} color={palette.night} />} onPress={() => pickImage(true)} /> : null}
            </View>
          )}
          {permissionNote ? <Banner tone="waiting" body={permissionNote} /> : null}
        </Card>

        {uploadError ? <Banner tone="danger" body={uploadError.message} testID="pay-upload-error" /> : null}
        {submitting ? (
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 8, borderRadius: 4, backgroundColor: palette.mist, overflow: "hidden" }}>
            <View style={{ width: `${pct}%`, height: "100%", borderRadius: 4, backgroundColor: palette.orange }} />
          </View>
        ) : null}
        <Button
          testID="pay-submit"
          label={submitting ? copy(`Bhej rahe hain… ${pct}%`, `Sending… ${pct}%`) : uploadError?.retryable ? copy("Dobara bhejein", "Send again") : copy("Venue ko bhejein", "Send to the venue")}
          block
          loading={submitting}
          disabled={!picked || preparing}
          onPress={submitProof}
        />
        <View style={{ flexDirection: "row", gap: space[3], justifyContent: "center", flexWrap: "wrap" }}>
          <Button label={copy("Venue se baat", "Talk to the venue")} variant="soft" size="sm" onPress={() => router.push({ pathname: "/(player)/booking/[id]/chat", params: { id } })} />
          <Button label={copy("Booking cancel", "Cancel booking")} variant="danger" size="sm" onPress={() => setCancelOpen(true)} testID="pay-cancel" />
        </View>
      </View>

      <Sheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={copy("Hold cancel karein?", "Cancel this hold?")}
        footer={
          <View style={{ gap: space[3] }}>
            <Button label={copy("Haan, cancel karein", "Yes, cancel")} variant="dangerSolid" block loading={cancelling} onPress={cancelHold} testID="pay-cancel-confirm" />
            <Button label={copy("Nahi, booking rakhein", "No, keep it")} variant="soft" size="md" block onPress={() => setCancelOpen(false)} />
          </View>
        }
      >
        {cancelError ? <Banner tone="danger" body={cancelError} /> : null}
        <Text variant="body">
          {copy(
            "Slot chhor diya jayega aur doosre log book kar sakenge. Agar aap paisa bhej chuke hain to pehle venue se baat karein.",
            "The slot will be released for others. If you already sent money, talk to the venue first.",
          )}
        </Text>
      </Sheet>
    </Screen>
  );
}

