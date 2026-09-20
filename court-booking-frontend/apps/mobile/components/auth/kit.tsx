import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { formatCountdown } from "@court-booking/types";
import { ownerColors, playerColors } from "@/lib/colors";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { recallOtpExpiry, usePendingAuth } from "@/lib/pending-auth";

/**
 * One UI kit for every signup / login / verify / reset screen, so labels, focus and error
 * states are identical everywhere. Two deliberate design systems (never unified): player =
 * orange/Figtree, owner = teal/IBM Plex Sans; screens pick one with `tone`.
 */
export type Tone = "player" | "owner";

export function toneColors(tone: Tone) {
  return tone === "owner" ? ownerColors : playerColors;
}

export const fontFor = (tone: Tone, weight: "medium" | "semibold" | "bold" | "extrabold") =>
  tone === "owner"
    ? { medium: "font-plex-medium", semibold: "font-plex-semibold", bold: "font-plex-bold", extrabold: "font-plex-bold" }[weight]
    : { medium: "font-figtree-medium", semibold: "font-figtree-semibold", bold: "font-figtree-bold", extrabold: "font-figtree-extrabold" }[weight];

/* -------------------------------------------------------------------------- logo */

/** The real Maidan logo (icon + wordmark lockup) from docs/maidan-logo-full-*-v2.svg, rasterized to
 * assets/brand/*.png at 2x (1440x460). `size` is the HEIGHT in px. Light screens use the light lockup;
 * `onDark` selects the white-wordmark variant. `tone` is accepted for call-site compatibility -- the lockup
 * is the same brand mark in both design systems. */
export function Logo({ size = 52, onDark = false }: { tone?: Tone; size?: number; onDark?: boolean }) {
  return (
    <Image
      accessibilityLabel="Maidan"
      source={onDark ? require("../../assets/brand/maidan-logo-full-dark.png") : require("../../assets/brand/maidan-logo-full-light.png")}
      resizeMode="contain"
      style={{ height: size, width: Math.round((size * 720) / 230) }}
    />
  );
}

/* ---------------------------------------------------------------- floating icons */

const ICONS: { name: string; body: ReactNode }[] = [
  {
    name: "ball",
    body: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 3v18M3 12h18" />
        <Path d="M5.6 5.6c3.2 3.2 3.2 9 0 12.8M18.4 5.6c-3.2 3.2-3.2 9 0 12.8" />
      </>
    ),
  },
  {
    name: "trophy",
    body: (
      <>
        <Path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z" />
        <Path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" />
      </>
    ),
  },
  {
    name: "target",
    body: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Circle cx="12" cy="12" r="5" />
        <Circle cx="12" cy="12" r="1" />
      </>
    ),
  },
  {
    name: "runner",
    body: (
      <>
        <Circle cx="15" cy="5" r="2" />
        <Path d="M13 8l-3 4 3 2.5V20M10 12l-3.5 1M13 14.5l4 1.5M16 9l2.5 2.5" />
      </>
    ),
  },
  { name: "star", body: <Path d="M12 2.5l3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z" /> },
  { name: "shuttle", body: <Path d="M9 3l3 8 3-8M8 11h8l-2 6h-4zM10 21h4" /> },
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function FloatingIcon({ body, color, left, top, size, opacity, dx, dy, r0, r1, dur, delay }: {
  body: ReactNode;
  color: string;
  left: number;
  top: number;
  size: number;
  opacity: number;
  dx: number;
  dy: number;
  r0: number;
  r1: number;
  dur: number;
  delay: number;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Own duration and start offset per icon, so none of them ever move in sync.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: dur * 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: dur * 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const start = setTimeout(() => loop.start(), delay * 1000);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [t, dur, delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: `${left}%`,
        top: `${top}%`,
        opacity,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: [`${r0}deg`, `${r1}deg`] }) },
        ],
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {body}
      </Svg>
    </Animated.View>
  );
}

/** Faint sports icons drifting behind the player-facing auth screens. Which icons and where is
 * re-randomized every time the screen mounts (4-6 of them, spread over a 3x3 grid so they don't
 * clump); each floats on its own slow loop. Decoration only: hidden from screen readers, behind
 * the form, low opacity, never touchable. Player tone only -- not spread anywhere else. */
export function FloatingIcons({ color }: { color: string }) {
  const placed = useMemo(() => {
    const count = 4 + Math.floor(Math.random() * 3);
    const cells = shuffle(Array.from({ length: 9 }, (_, i) => i)).slice(0, count);
    const icons = shuffle(ICONS).slice(0, count);
    return cells.map((cell, i) => ({
      key: `${icons[i].name}-${cell}`,
      body: icons[i].body,
      left: (cell % 3) * 33.3 + rand(0, 20),
      top: Math.floor(cell / 3) * 33.3 + rand(0, 20),
      size: Math.round(rand(44, 80)),
      opacity: rand(0.07, 0.14),
      dx: rand(-20, 20),
      dy: rand(-24, 24),
      r0: rand(-14, 14),
      r1: rand(-14, 14),
      dur: rand(7, 15),
      delay: rand(0, 6),
    }));
  }, []);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}
    >
      {placed.map(({ key, ...p }) => (
        <FloatingIcon key={key} color={color} {...p} />
      ))}
    </View>
  );
}

/* --------------------------------------------------------------------- screen */

export function AuthScreen({
  tone = "player",
  title,
  subtitle,
  children,
  footer,
}: {
  tone?: Tone;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const c = toneColors(tone);
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: c.bg }} edges={["top", "bottom"]}>
      {tone === "player" ? <FloatingIcons color={c.accent} /> : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 20, paddingBottom: 28, gap: 26 }}
      >
        <Logo tone={tone} />
        <View style={{ gap: 8 }}>
          <Text className={fontFor(tone, "extrabold")} style={{ fontSize: 27, color: c.ink, letterSpacing: -0.85 }}>
            {title}
          </Text>
          {subtitle ? (
            <Text className={fontFor(tone, "medium")} style={{ fontSize: 15, lineHeight: 22, color: c.inkMuted }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: 18 }}>{children}</View>
        {footer ? <View style={{ alignItems: "center" }}>{footer}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------------- fields */

function boxStyle(tone: Tone, focused: boolean, invalid: boolean) {
  const c = toneColors(tone);
  return {
    backgroundColor: c.surface,
    borderWidth: focused || invalid ? 1.5 : 1,
    borderColor: invalid ? c.danger : focused ? c.ink : c.border,
    borderRadius: 14,
  } as const;
}

function LabelText({ tone, children }: { tone: Tone; children: string }) {
  return (
    <Text className={fontFor(tone, "bold")} style={{ fontSize: 11, letterSpacing: 1.2, color: toneColors(tone).inkFainter }}>
      {children.toUpperCase()}
    </Text>
  );
}

function ErrorText({ tone, message }: { tone: Tone; message?: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className={fontFor(tone, "medium")} style={{ fontSize: 13, color: toneColors(tone).danger }}>
      {message}
    </Text>
  );
}

interface BaseFieldProps {
  label: string;
  tone?: Tone;
  error?: string | null;
  /** "touched": don't show "Enter a valid email" while the user is still typing the first character. */
  showError?: boolean;
}

export function TextField({
  label,
  tone = "player",
  error,
  showError,
  mono,
  prefix,
  ...input
}: BaseFieldProps & { mono?: boolean; prefix?: ReactNode } & TextInputProps) {
  const [focused, setFocused] = useState(false);
  const invalid = !!(showError && error);
  const c = toneColors(tone);
  return (
    <View style={{ gap: 9 }}>
      <LabelText tone={tone}>{label}</LabelText>
      <View style={[{ height: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10 }, boxStyle(tone, focused, invalid)]}>
        {prefix}
        <TextInput
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          placeholderTextColor={c.inkFainter}
          accessibilityLabel={label}
          className={mono ? "font-mono-semibold" : fontFor(tone, "semibold")}
          style={[{ flex: 1, fontSize: 16, color: c.ink, paddingVertical: 0 }, input.style]}
        />
      </View>
      <ErrorText tone={tone} message={invalid ? error : null} />
    </View>
  );
}

export function PasswordField({
  label,
  tone = "player",
  error,
  showError,
  ...input
}: BaseFieldProps & Omit<TextInputProps, "secureTextEntry">) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const invalid = !!(showError && error);
  const c = toneColors(tone);
  return (
    <View style={{ gap: 9 }}>
      <LabelText tone={tone}>{label}</LabelText>
      <View style={[{ height: 56, paddingLeft: 16, paddingRight: 6, flexDirection: "row", alignItems: "center" }, boxStyle(tone, focused, invalid)]}>
        <TextInput
          {...input}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          placeholderTextColor={c.inkFainter}
          accessibilityLabel={label}
          className={fontFor(tone, "semibold")}
          style={{ flex: 1, fontSize: 16, color: c.ink, paddingVertical: 0 }}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide password" : "Show password"}
          style={{ height: 44, paddingHorizontal: 12, justifyContent: "center" }}
        >
          <Text className={fontFor(tone, "bold")} style={{ fontSize: 12.5, color: c.inkMuted }}>
            {visible ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>
      <ErrorText tone={tone} message={invalid ? error : null} />
    </View>
  );
}

/** Inline-expanding dropdown (React Native has no native <select>). */
export function SelectField({
  label,
  tone = "player",
  error,
  showError,
  value,
  onChange,
  placeholder,
  options,
}: BaseFieldProps & {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const c = toneColors(tone);
  const invalid = !!(showError && error);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 9 }}>
      <LabelText tone={tone}>{label}</LabelText>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={[{ height: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, boxStyle(tone, open, invalid)]}
      >
        <Text className={fontFor(tone, "semibold")} style={{ fontSize: 16, color: selected ? c.ink : c.inkFainter }}>
          {selected ? selected.label : placeholder}
        </Text>
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={c.inkFainter} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </Svg>
      </Pressable>
      {open ? (
        <View style={{ maxHeight: 240, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, overflow: "hidden" }}>
          <ScrollView nestedScrollEnabled>
            {options.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{ paddingHorizontal: 16, height: 46, justifyContent: "center", backgroundColor: o.value === value ? c.accentSoft : "transparent" }}
              >
                <Text className={fontFor(tone, o.value === value ? "bold" : "medium")} style={{ fontSize: 15, color: c.ink }}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <ErrorText tone={tone} message={invalid ? error : null} />
    </View>
  );
}

/** Pill-style single choice (gender, signing-up-as). */
export function ChoicePills({
  label,
  tone = "player",
  value,
  onChange,
  options,
  error,
  showError,
}: BaseFieldProps & { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const c = toneColors(tone);
  const invalid = !!(showError && error);
  return (
    <View style={{ gap: 9 }}>
      <LabelText tone={tone}>{label}</LabelText>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(o.value)}
              style={{
                minHeight: 44,
                paddingHorizontal: 16,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? c.ink : c.surface,
                borderWidth: 1,
                borderColor: selected ? c.ink : invalid ? c.danger : c.border,
              }}
            >
              <Text className={fontFor(tone, "bold")} style={{ fontSize: 14, color: selected ? "#FFFFFF" : c.inkMuted }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ErrorText tone={tone} message={invalid ? error : null} />
    </View>
  );
}

export function FormMessage({ kind, tone = "player", children }: { kind: "error" | "success"; tone?: Tone; children: string }) {
  const c = toneColors(tone);
  const p = kind === "error" ? { bg: c.dangerSoft, border: c.dangerSoftBorder, color: c.danger } : { bg: c.successSoft, border: c.successSoftBorder, color: c.success };
  return (
    <View
      accessibilityRole={kind === "error" ? "alert" : undefined}
      style={{ borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.bg, paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <Text className={fontFor(tone, "semibold")} style={{ fontSize: 13.5, lineHeight: 19, color: p.color }}>
        {children}
      </Text>
    </View>
  );
}

/* --------------------------------------------------------------- smart button */

/** The primary button on every auth form: muted grey and inert until every required field is
 * actually VALID (`ready`), then the full brand color. A not-ready button does nothing when
 * pressed (disabled AND guarded), and `busy` blocks a second submit. */
export function SubmitButton({
  ready,
  busy = false,
  label,
  busyLabel = "Please wait…",
  tone = "player",
  onPress,
}: {
  ready: boolean;
  busy?: boolean;
  label: string;
  busyLabel?: string;
  tone?: Tone;
  onPress: () => void;
}) {
  const c = toneColors(tone);
  const active = ready && !busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !active, busy }}
      disabled={!active}
      onPress={() => {
        if (active) onPress();
      }}
      style={{
        height: 56,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: ready ? c.accent : c.border,
        opacity: ready && busy ? 0.7 : 1,
      }}
    >
      <Text className={fontFor(tone, "bold")} style={{ fontSize: 16.5, color: ready ? "#FFFFFF" : c.inkFainter }}>
        {busy ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------- OTP flow */

const RESEND_COOLDOWN_SECONDS = 30;

function useSecondsUntil(targetMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (targetMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [targetMs]);
  return targetMs === null ? null : Math.max(0, Math.ceil((targetMs - now) / 1000));
}

/** Two separate clocks on every OTP screen -- keep both, don't merge them:
 *  1. the code's own expiry (backend `expires_in`, 300s) as MM:SS; at zero the field is
 *     disabled and "Code expired" shows;
 *  2. a short resend cooldown (30s) so "Resend code" can't be hammered. */
export function useOtpFlow(purpose: string, phone: string, requestNewCode: () => Promise<number>) {
  const [expiresAt, setExpiresAt] = useState<number | null>(() => recallOtpExpiry(purpose, phone));
  const secondsLeft = useSecondsUntil(expiresAt);
  const [cooldownEndsAt, setCooldownEndsAt] = useState(() => Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  const resendLeft = useSecondsUntil(cooldownEndsAt) ?? 0;
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  async function resend() {
    if (resending || resendLeft > 0) return;
    setResending(true);
    setResendError(null);
    try {
      const expiresIn = await requestNewCode();
      usePendingAuth.getState().rememberOtpExpiry(purpose, phone, expiresIn);
      setExpiresAt(Date.now() + expiresIn * 1000);
      setCooldownEndsAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch (e) {
      setResendError(friendlyErrorMessage(e));
    } finally {
      setResending(false);
    }
  }

  return { secondsLeft, expired: secondsLeft === 0, resendLeft, resending, resendError, resend };
}

export function OtpControls({ flow, tone = "player" }: { flow: ReturnType<typeof useOtpFlow>; tone?: Tone }) {
  const c = toneColors(tone);
  const { secondsLeft, expired, resendLeft, resending, resendError, resend } = flow;
  const canResend = resendLeft === 0 && !resending;
  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      {secondsLeft === null ? null : expired ? (
        <Text accessibilityRole="alert" className={fontFor(tone, "bold")} style={{ fontSize: 14, color: c.danger }}>
          Code expired
        </Text>
      ) : (
        <Text className={fontFor(tone, "medium")} style={{ fontSize: 14, color: c.inkMuted }}>
          Code expires in{" "}
          <Text className="font-mono-semibold" style={{ color: c.ink }}>
            {formatCountdown(secondsLeft)}
          </Text>
        </Text>
      )}
      {canResend ? (
        <Pressable onPress={resend} style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: "center" }}>
          <Text className={fontFor(tone, "bold")} style={{ fontSize: 14, color: c.accent }}>
            Resend code
          </Text>
        </Pressable>
      ) : (
        <Text className={fontFor(tone, "medium")} style={{ minHeight: 44, textAlignVertical: "center", fontSize: 14, color: c.inkFainter }}>
          {resending ? "Sending…" : "Resend in "}
          {resending ? null : (
            <Text className="font-mono-semibold" style={{ color: c.inkMuted }}>
              {formatCountdown(resendLeft)}
            </Text>
          )}
        </Text>
      )}
      {resendError ? (
        <Text accessibilityRole="alert" className={fontFor(tone, "medium")} style={{ fontSize: 13, color: c.danger }}>
          {resendError}
        </Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------- account screens */

/** Frame for the signed-in Account screens (edit profile, change phone): a back link, a title and a
 * scrolling body. No animated background -- that treatment is for signup/login/OTP only. */
export function AccountScreen({
  tone = "player",
  title,
  onBack,
  children,
}: {
  tone?: Tone;
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const c = toneColors(tone);
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: c.bg }} edges={["top", "bottom"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 32, gap: 22 }}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
          <Text className={fontFor(tone, "semibold")} style={{ fontSize: 14, color: c.inkMuted }}>
            ← Back
          </Text>
        </Pressable>
        <Text className={fontFor(tone, "extrabold")} style={{ fontSize: 26, color: c.ink, letterSpacing: -0.8 }}>
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
