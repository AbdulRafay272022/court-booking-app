import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, CircleAlert, Info } from "lucide-react-native";
import { motion, palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useReduceMotion } from "./theme";
import { haptic } from "./haptics";

export type ToastTone = "neutral" | "success" | "danger";
export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** ms; default 3000 (danger 5000). */
  duration?: number;
}

interface ToastCtx {
  show: (o: ToastOptions | string) => void;
}
const Ctx = createContext<ToastCtx>({ show: () => undefined });

/** `const toast = useToast(); toast.show({ message: "Copy ho gaya", tone: "success" })`. Needs <ToastProvider> (mounted in the role layouts). */
export function useToast(): ToastCtx {
  return useContext(Ctx);
}

/** Mounted once per role layout. Shows one toast at a time above the floating bars, announced politely. */
export function ToastProvider({ children, bottomOffset = 110 }: { children: ReactNode; bottomOffset?: number }) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const idRef = useRef(0);
  const show = useCallback((o: ToastOptions | string) => {
    const opts = typeof o === "string" ? { message: o } : o;
    idRef.current += 1;
    if (opts.tone === "success") haptic("success");
    if (opts.tone === "danger") haptic("error");
    setCurrent({ ...opts, id: idRef.current });
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {current ? <ToastView key={current.id} toast={current} bottomOffset={bottomOffset} onDone={() => setCurrent(null)} /> : null}
    </Ctx.Provider>
  );
}

export function ToastView({ toast, bottomOffset, onDone }: { toast: ToastOptions; bottomOffset: number; onDone?: () => void }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const o = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (!reduce) Animated.timing(o, { toValue: 1, duration: motion.base, useNativeDriver: true }).start();
    const ms = toast.duration ?? (toast.tone === "danger" ? 5000 : 3000);
    const t = setTimeout(() => {
      if (reduce) onDone?.();
      else Animated.timing(o, { toValue: 0, duration: motion.fast, useNativeDriver: true }).start(() => onDone?.());
    }, ms);
    return () => clearTimeout(t);
  }, [o, reduce, toast, onDone]);
  const Icon = toast.tone === "success" ? Check : toast.tone === "danger" ? CircleAlert : Info;
  const iconColor = toast.tone === "success" ? palette.mint : toast.tone === "danger" ? palette.amber : palette.onDarkMuted;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: space[4], right: space[4], bottom: insets.bottom + bottomOffset, opacity: o, alignItems: "center" }}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.night, borderRadius: radius.input, paddingVertical: space[3], paddingHorizontal: space[4], boxShadow: shadow.raised, maxWidth: 480 }}
      >
        <Icon size={18} color={iconColor} />
        <Text variant="body" weight="semi" tone="onDark" style={{ flexShrink: 1 }}>
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
}
