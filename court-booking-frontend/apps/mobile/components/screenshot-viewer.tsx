import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Modal, PanResponder, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { CloseIcon } from "@/components/overview/icons";

const MIN_SCALE = 1; // 1 = the whole screenshot fits the screen
const MAX_SCALE = 4;
const STEP = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fetches the short-lived signed URL (or uses one already in hand) and refetches it ONCE when the image fails to load
 * (an expired URL). Returns the URL to show and an onError handler for the Image. */
function useProofUrl(paymentId: string, initialUrl?: string | null) {
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    queryKey: ["owner-proof-url", paymentId],
    queryFn: () => api.payments.proofUrl(paymentId),
    enabled: !initialUrl || retried,
    staleTime: 4 * 60_000,
  });
  const url = retried || !initialUrl ? query.data?.url ?? null : initialUrl;
  function onError() {
    if (!retried) {
      setRetried(true);
      query.refetch();
      return;
    }
    setFailed(true);
  }
  function retry() {
    setFailed(false);
    query.refetch();
  }
  return { url, loading: !url && (query.isLoading || query.isFetching), error: query.error, failed, onError, retry };
}

/** Inline screenshot: max ~160 px high, contain, rounded, caption "Bara karke dekhein". Tapping opens the full-screen viewer. */
export function ScreenshotThumb({ paymentId, url: initialUrl, alt = "Payment screenshot" }: { paymentId: string; url?: string | null; alt?: string }) {
  const [open, setOpen] = useState(false);
  const proof = useProofUrl(paymentId, initialUrl);
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${alt}: bara karke dekhein`}
        testID="screenshot-thumb"
        style={{ height: 160, borderRadius: 12, overflow: "hidden", backgroundColor: "#F4F6F7", borderWidth: 1, borderColor: "#DCE3E6", alignItems: "center", justifyContent: "center" }}
      >
        {proof.url && !proof.failed ? (
          <Image source={{ uri: proof.url }} onError={proof.onError} resizeMode="contain" accessibilityLabel={alt} style={{ width: "100%", height: 160 }} />
        ) : proof.loading ? (
          <ActivityIndicator color="#0E6274" />
        ) : (
          <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">Screenshot load nahi hua. Dabayein.</Text>
        )}
      </Pressable>
      <Text className="font-plex-semibold text-owner-accent text-[12.5px]">Bara karke dekhein</Text>
      {open ? <ScreenshotViewer paymentId={paymentId} initialUrl={proof.url ?? initialUrl} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** Full-screen viewer: opens fit-to-screen; "-", "+", "Fit"; pinch zoom and drag-to-pan (PanResponder + Animated, so
 * iOS, Android and web behave the same); mouse wheel zooms on web; min = fit, max 4x. */
export function ScreenshotViewer({ paymentId, initialUrl, onClose }: { paymentId: string; initialUrl?: string | null; onClose: () => void }) {
  const proof = useProofUrl(paymentId, initialUrl);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, x: 0, y: 0 });
  const gesture = useRef<{ s0: number; x0: number; y0: number; d0: number | null }>({ s0: 1, x0: 0, y0: 0, d0: null });
  const boxRef = useRef(box);
  boxRef.current = box;
  const stageRef = useRef<View>(null);

  function apply(s: number, x: number, y: number) {
    const ns = clamp(s, MIN_SCALE, MAX_SCALE);
    const { w, h } = boxRef.current;
    const mx = Math.max(0, (w * ns - w) / 2);
    const my = Math.max(0, (h * ns - h) / 2);
    const nx = clamp(x, -mx, mx);
    const ny = clamp(y, -my, my);
    cur.current = { s: ns, x: nx, y: ny };
    scale.setValue(ns);
    tx.setValue(nx);
    ty.setValue(ny);
    setZoom(ns);
  }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gesture.current = { s0: cur.current.s, x0: cur.current.x, y0: cur.current.y, d0: null };
        },
        onPanResponderMove: (evt, g) => {
          const touches = (evt.nativeEvent as { touches?: { pageX: number; pageY: number }[] }).touches ?? [];
          if (touches.length >= 2) {
            const d = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
            if (gesture.current.d0 == null) gesture.current = { s0: cur.current.s, x0: cur.current.x, y0: cur.current.y, d0: d };
            const base = gesture.current;
            apply(base.s0 * (d / (base.d0 || d)), base.x0, base.y0);
            return;
          }
          if (gesture.current.d0 != null) {
            // A finger lifted after a pinch: continue as a pan from here.
            gesture.current = { s0: cur.current.s, x0: cur.current.x - g.dx, y0: cur.current.y - g.dy, d0: null };
          }
          const base = gesture.current;
          apply(cur.current.s, base.x0 + g.dx, base.y0 + g.dy);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Web: the mouse wheel zooms (the node behind a View ref is a DOM element on react-native-web).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = stageRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      apply(cur.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cur.current.x, cur.current.y);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proof.url]);

  const zoomBy = (f: number) => apply(cur.current.s * f, cur.current.x * f, cur.current.y * f);

  return (
    <Modal transparent={false} animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1214" }} edges={["top", "bottom"]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 15 }} className="font-plex-semibold">
            Payment screenshot
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityLabel="Band karein"
            accessibilityRole="button"
            testID="viewer-close"
            style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" }}
          >
            <CloseIcon color="#FFFFFF" />
          </Pressable>
        </View>

        <View
          ref={stageRef}
          style={{ flex: 1, overflow: "hidden" }}
          onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          {...responder.panHandlers}
        >
          {proof.url && !proof.failed && box.w > 0 ? (
            <Animated.View
              testID="viewer-stage"
              style={{ width: box.w, height: box.h, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}
            >
              <Image
                source={{ uri: proof.url }}
                onError={proof.onError}
                resizeMode="contain"
                accessibilityLabel="Payment screenshot, poori screen par"
                style={{ width: box.w, height: box.h }}
              />
            </Animated.View>
          ) : proof.failed || (proof.error && !proof.url) ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 }}>
              <Text style={{ color: "#FFFFFF", textAlign: "center" }} className="font-plex-medium text-[14px]">
                {proof.error ? friendlyErrorMessage(proof.error) : "Screenshot load nahi ho saka."}
              </Text>
              <Pressable onPress={proof.retry} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" }}>
                <Text style={{ color: "#FFFFFF" }} className="font-plex-semibold text-[14px]">Dobara koshish karein</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 10 }}>
          <ZoomButton label="-" a11y="Chhota karein" testID="viewer-zoom-out" disabled={zoom <= MIN_SCALE + 0.001} onPress={() => zoomBy(1 / STEP)} />
          <Text testID="viewer-zoom-level" accessibilityLabel={`Zoom ${Math.round(zoom * 100)}%`} style={{ color: "#FFFFFF", minWidth: 56, textAlign: "center" }} className="font-mono-semibold text-[14px]">
            {`${Math.round(zoom * 100)}%`}
          </Text>
          <ZoomButton label="+" a11y="Bara karein" testID="viewer-zoom-in" disabled={zoom >= MAX_SCALE - 0.001} onPress={() => zoomBy(STEP)} />
          <ZoomButton label="Fit" a11y="Poori screen mein fit karein" testID="viewer-fit" onPress={() => apply(1, 0, 0)} />
        </View>
        <Text style={{ color: "rgba(255,255,255,0.7)", textAlign: "center", paddingBottom: 8 }} className="font-plex-medium text-[12px]">
          Do ungliyon se zoom karein, zoom par ungli se khiskayein.
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

function ZoomButton({ label, a11y, testID, onPress, disabled }: { label: string; a11y: string; testID: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={{ minWidth: 52, height: 44, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)", opacity: disabled ? 0.45 : 1 }}
    >
      <Text style={{ color: "#FFFFFF" }} className="font-plex-bold text-[17px]">
        {label}
      </Text>
    </Pressable>
  );
}
