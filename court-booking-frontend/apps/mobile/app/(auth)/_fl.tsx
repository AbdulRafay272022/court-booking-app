/**
 * Floodlight building blocks for the auth screens (PAuth board) and the player's change-phone screen. Not a route (leading
 * underscore). Built only from @/components/ui; the OTP timers reuse the tested `useOtpFlow` hook from components/auth/kit
 * (logic only). Promotion candidates for components/ui: AuthShell, OtpStatus, SelectSheetField.
 */
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown } from "lucide-react-native";
import { palette, radius, size, space } from "@court-booking/ui-tokens";

import { Banner, Button, Header, Hero, RadioGroup, Screen, Sheet, Text, useCopy } from "@/components/ui";
import { Logo, type useOtpFlow } from "@/components/auth/kit";

/** Login = night hero with the logo (board frame 1); other auth screens = back header + big title (frames 2-3). */
export function AuthShell({
  title,
  subtitle,
  onBack,
  hero,
  footer,
  children,
  testID,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  hero?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  if (hero) {
    return (
      <Screen keyboard gutter={false} edgeToEdgeTop testID={testID}>
        <Hero topInset={insets.top} roundedBottom>
          <Logo size={40} onDark />
          <View style={{ gap: space[2] }}>
            <Text variant="h1" tone="hero" accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text variant="bodyL" tone="heroMuted">
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Hero>
        <View style={{ paddingHorizontal: space[5], gap: space[4] }}>
          {children}
          {footer ? <View style={{ alignItems: "center", gap: space[3], paddingTop: space[2] }}>{footer}</View> : null}
        </View>
      </Screen>
    );
  }
  return (
    <Screen keyboard testID={testID}>
      {onBack ? <Header title="" onBack={onBack} /> : null}
      <View style={{ gap: space[2] }}>
        <Text variant="h1" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodyL" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
      {footer ? <View style={{ alignItems: "center", gap: space[3], paddingTop: space[2] }}>{footer}</View> : null}
    </Screen>
  );
}

/** Inline text link with a 44pt row (Login "Password bhool gaye?", "Sign up karein"). */
export function TextLink({ label, onPress, before, testID }: { label: string; onPress: () => void; before?: string; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={before ? `${before} ${label}` : label} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "center" }} testID={testID}>
      <Text variant="body" tone="muted" align="center">
        {before ? `${before} ` : ""}
        <Text variant="bodyBold" tone="link">
          {label}
        </Text>
      </Text>
    </Pressable>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The two OTP clocks (code expiry + resend cooldown) from useOtpFlow, Floodlight style. */
export function OtpStatus({ flow }: { flow: ReturnType<typeof useOtpFlow> }) {
  const copy = useCopy();
  const { secondsLeft, expired, resendLeft, resendLockSeconds, resending, resendError, resend } = flow;
  const canResend = resendLeft === 0 && resendLockSeconds === 0 && !resending;
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
        {secondsLeft === null ? (
          <View />
        ) : expired ? (
          <Text variant="bodyBold" tone="danger" accessibilityRole="alert">
            {copy("Code ka waqt khatam", "Code expired")}
          </Text>
        ) : (
          <Text variant="meta" tone="muted">
            {copy(`Code ${mmss(secondsLeft)} min tak chalega`, `Code works for ${mmss(secondsLeft)}`)}
          </Text>
        )}
        {canResend ? (
          <Button label={copy("Dobara bhejein", "Resend code")} variant="soft" size="sm" onPress={resend} testID="otp-resend" />
        ) : resendLockSeconds > 0 ? (
          <Text variant="meta" tone="danger" accessibilityRole="alert">
            {copy(`Bohat zyada codes. ${mmss(resendLockSeconds)} baad`, `Too many codes. Wait ${mmss(resendLockSeconds)}`)}
          </Text>
        ) : (
          <Text variant="meta" tone="muted">
            {resending ? copy("Bhej rahe hain…", "Sending…") : copy(`Dobara bhejein ${mmss(resendLeft)}`, `Resend in ${mmss(resendLeft)}`)}
          </Text>
        )}
      </View>
      {resendError ? <Banner tone="danger" body={resendError} /> : null}
    </View>
  );
}

/** A labelled field that opens a radio sheet (Shehar / City). The label is always visible. */
export function SelectSheetField<V extends string>({
  label,
  value,
  options,
  placeholder,
  error,
  onChange,
  testID,
}: {
  label: string;
  value: V | "";
  options: { value: V; label: string }[];
  placeholder: string;
  error?: string | null;
  onChange: (v: V) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="label">{label}</Text>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        style={({ pressed }) => ({ minHeight: size.input, borderRadius: radius.input, backgroundColor: palette.white, borderWidth: error ? 2 : 1.5, borderColor: error ? palette.danger : palette.lineStrong, paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[2], opacity: pressed ? 0.85 : 1 })}
      >
        <Text variant="bodyL" tone={current ? "primary" : "muted"} style={{ flex: 1 }}>
          {current?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={palette.night} />
      </Pressable>
      {error ? (
        <Text variant="caption" weight="bold" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <RadioGroup
          accessibilityLabel={label}
          options={options}
          value={value || null}
          onChange={(v) => {
            onChange(v);
            setOpen(false);
          }}
          testID={testID ? `${testID}-options` : undefined}
        />
      </Sheet>
    </View>
  );
}
