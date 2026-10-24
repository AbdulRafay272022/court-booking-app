import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, CircleAlert, Inbox, WifiOff } from "lucide-react-native";
import { palette, radius, space, tone as toneTokens } from "@court-booking/ui-tokens";
import { Button } from "./Button";
import { IconButton, type IconComponent } from "./IconButton";
import { Text } from "./Text";
import { useCopy } from "./theme";

export interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: IconComponent;
  /** One optional action (e.g. "Filters hatao"). Uses the role primary unless `actionVariant` says otherwise. */
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: "primary" | "soft" | "secondary";
  testID?: string;
}

/** Honest empty state: says what is missing and the next step. Never fake data. */
export function EmptyState({ title, body, icon: Icon = Inbox, actionLabel, onAction, actionVariant = "primary", testID }: EmptyStateProps) {
  return (
    <View testID={testID ?? "empty-state"} style={{ alignItems: "center", gap: space[3], paddingVertical: space[8], paddingHorizontal: space[4] }}>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: palette.tealTint, alignItems: "center", justifyContent: "center" }}>
        <Icon size={32} color={palette.tealDeep} />
      </View>
      <Text variant="title" align="center" accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="muted" align="center">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant={actionVariant} size="md" style={{ alignSelf: "center" }} /> : null}
    </View>
  );
}

export interface ErrorStateProps {
  /** Override the title. Default "Kuch gadbad ho gayi" / "Something went wrong". */
  title?: string;
  /** What failed, plain words (e.g. lib/error-messages friendlyErrorMessage). */
  message?: string;
  onRetry: () => void;
  /** Back / home action (required on full screens: never trap the user). */
  onBack?: () => void;
  backLabel?: string;
  /** Reassurance line, e.g. "Aap ki booking aur paisa mehfooz hain." Only say it when it is true for this screen. */
  reassurance?: string;
  /** Error code for support ("VEN-500"). */
  code?: string;
  /** Show the 44pt back arrow at the top-left too. */
  showTopBack?: boolean;
  testID?: string;
}

/** PStates frame 2: icon, title, message, "Dobara koshish" (role primary) + back, optional code line. */
export function ErrorState({ title, message, onRetry, onBack, backLabel, reassurance, code, showTopBack, testID }: ErrorStateProps) {
  const copy = useCopy();
  const d = toneTokens.danger;
  return (
    <View testID={testID ?? "error-state"} style={{ gap: space[5] }}>
      {showTopBack && onBack ? <IconButton icon={ArrowLeft} accessibilityLabel={copy("Wapas", "Back")} onPress={onBack} /> : null}
      <View style={{ alignItems: "center", gap: 14, paddingTop: showTopBack ? space[8] : space[4] }}>
        <View style={{ width: 88, height: 88, borderRadius: radius.cardL, backgroundColor: d.bg, alignItems: "center", justifyContent: "center" }}>
          <CircleAlert size={40} color={d.icon} />
        </View>
        <Text variant="h2" align="center" accessibilityRole="header">
          {title ?? copy("Kuch gadbad ho gayi", "Something went wrong")}
        </Text>
        {message || reassurance ? (
          <Text variant="bodyL" tone="muted" align="center">
            {[message, reassurance].filter(Boolean).join(" ")}
          </Text>
        ) : null}
        <Button label={copy("Dobara koshish", "Try again")} onPress={onRetry} block testID="error-retry" />
        {onBack ? <Button label={backLabel ?? copy("Wapas jayein", "Go back")} onPress={onBack} variant="soft" size="md" block testID="error-back" /> : null}
        {code ? (
          <Text variant="caption" tone="subtle" align="center">
            {copy(`Code: ${code} · WhatsApp madad mein batayein`, `Code: ${code} · mention it on WhatsApp support`)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface NotFoundProps {
  onHome: () => void;
  title?: string;
  body?: string;
  testID?: string;
}

/** PStates frame 4 ("Out!"): full night screen. */
export function NotFound({ onHome, title, body, testID }: NotFoundProps) {
  const copy = useCopy();
  return (
    <View testID={testID ?? "not-found"} style={{ flex: 1, backgroundColor: palette.night, justifyContent: "center", paddingHorizontal: 28, gap: 14, alignItems: "center" }}>
      <Text variant="displayXL" color={palette.orange} align="center" style={{ fontSize: 90, lineHeight: 92, letterSpacing: -4 }}>
        Out!
      </Text>
      <Text variant="h2" tone="onDark" align="center" accessibilityRole="header">
        {title ?? copy("Ye page court se bahar chala gaya", "This page went out of court")}
      </Text>
      <Text variant="bodyL" tone="onDarkMuted" align="center">
        {body ?? copy("Link purana ho sakta hai ya venue band ho gaya hai.", "The link may be old or the venue may have closed.")}
      </Text>
      <Button label={copy("Home par jayein", "Go home")} onPress={onHome} block />
    </View>
  );
}

export interface OfflineBannerProps {
  /** Show it (wire to lib/network-status useNetworkStatus() === false). */
  visible: boolean;
  onRetry?: () => void;
  /** Sits over content (absolute, top safe area) by default; "inline" renders in the flow. */
  placement?: "overlay" | "inline";
  testID?: string;
}

/** PStates frame 3: night banner, amber wifi-off icon, "Retry" (role primary). */
export function OfflineBanner({ visible, onRetry, placement = "overlay", testID }: OfflineBannerProps) {
  const copy = useCopy();
  if (!visible) return null;
  const bar = (
    <View
      testID={testID ?? "offline-banner"}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.night, borderRadius: radius.input, paddingVertical: space[3], paddingHorizontal: 14 }}
    >
      <WifiOff size={20} color={palette.amber} />
      <Text variant="body" tone="onDark" style={{ flex: 1 }}>
        {copy("Internet nahi hai. Purani info dikh rahi hai.", "No internet. You're seeing saved info.")}
      </Text>
      {onRetry ? <Button label={copy("Retry", "Retry")} onPress={onRetry} size="sm" /> : null}
    </View>
  );
  if (placement === "inline") return bar;
  return (
    <SafeAreaView edges={["top"]} pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 999, paddingHorizontal: space[3], paddingTop: space[2] }}>
      {bar}
    </SafeAreaView>
  );
}

export interface BannerProps {
  tone?: "info" | "waiting" | "danger" | "open" | "neutral";
  title?: string;
  body: string;
  icon?: IconComponent;
  action?: ReactNode;
  testID?: string;
}

/** Inline notice (OTP error, CNIC nudge, push-off, duplicate warning). Text on tint always passes 4.5:1. */
export function Banner({ tone = "info", title, body, icon: Icon = CircleAlert, action, testID }: BannerProps) {
  const c = toneTokens[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start", backgroundColor: c.bg, borderRadius: radius.input, paddingVertical: space[3], paddingHorizontal: 14 }}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon size={18} color={c.icon} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="bodyBold" color={c.fg}>
            {title}
          </Text>
        ) : null}
        <Text variant="meta" color={c.fg}>
          {body}
        </Text>
        {action ? <View style={{ paddingTop: space[2], alignSelf: "flex-start" }}>{action}</View> : null}
      </View>
    </View>
  );
}
