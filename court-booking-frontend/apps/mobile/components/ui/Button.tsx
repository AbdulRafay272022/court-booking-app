import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { buttonVariant, radius, size, space } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useRoleTheme } from "./theme";
import { haptic, type HapticKind } from "./haptics";

export type ButtonVariant = "primary" | "secondary" | "soft" | "danger" | "dangerSolid";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /** primary = the role's ONE main action (player orange + ink, owner teal + white). Use at most one per screen. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Shows a spinner, keeps the label for screen readers, ignores presses. */
  loading?: boolean;
  /** Haptic on press (default "light"; pass false to turn off). */
  haptic?: HapticKind | false;
  /** Optional leading icon (a lucide icon element; colour it with `useButtonColors().fg` or leave currentColor). */
  icon?: ReactNode;
  /** Stretch to the parent width. */
  block?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT: Record<ButtonSize, number> = { sm: size.ctaS, md: size.ctaM, lg: size.cta };
const RADIUS: Record<ButtonSize, number> = { sm: radius.md, md: radius.button, lg: radius.button };

export function useButtonColors(variant: ButtonVariant, disabled = false): { bg: string; fg: string; border: string } {
  const t = useRoleTheme();
  if (disabled) return buttonVariant.disabled;
  if (variant === "primary") return { bg: t.primary.bg, fg: t.primary.fg, border: t.primary.border };
  return buttonVariant[variant];
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size: sz = "lg",
  disabled,
  loading,
  haptic: hapticKind = "light",
  icon,
  block,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const t = useRoleTheme();
  const inert = !!disabled || !!loading;
  const c = useButtonColors(variant, !!disabled);
  const shadowStyle = variant === "primary" && !inert ? { boxShadow: t.primary.shadow } : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: !!loading }}
      disabled={inert}
      onPress={() => {
        if (inert) return;
        if (hapticKind) haptic(hapticKind);
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          minHeight: HEIGHT[sz],
          paddingHorizontal: sz === "sm" ? space[4] : space[6],
          paddingVertical: space[2],
          borderRadius: RADIUS[sz],
          backgroundColor: c.bg,
          borderWidth: variant === "soft" || variant === "danger" ? 1.5 : 0,
          borderColor: c.border,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space[2],
          alignSelf: block ? "stretch" : "flex-start",
          opacity: pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        shadowStyle,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={c.fg} size="small" /> : icon ? <View accessibilityElementsHidden importantForAccessibility="no">{icon}</View> : null}
      <Text variant={sz === "sm" ? "bodyBold" : sz === "md" ? "button" : "cta"} color={c.fg} align="center" style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
