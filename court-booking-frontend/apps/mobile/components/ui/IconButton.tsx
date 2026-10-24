import type { ComponentType } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { alpha, palette, radius, size } from "@court-booking/ui-tokens";
import { useRole, useRoleTheme } from "./theme";
import { haptic } from "./haptics";
import { Text } from "./Text";

export type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export type IconButtonVariant = "plain" | "surface" | "mist" | "onDark" | "onPhoto" | "primary" | "night";

export interface IconButtonProps {
  icon: IconComponent;
  /** REQUIRED: what the button does, in the screen's language ("Wapas", "Band karein", "Demo Arena save karein"). */
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** Visual size of the round button; the touch target is never below 44. */
  diameter?: number;
  iconSize?: number;
  disabled?: boolean;
  /** Pressed/toggle state (e.g. saved heart). */
  selected?: boolean;
  /** Small count badge (notification bell). */
  badge?: number | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** 44 pt round icon button. The label is required by the type: icon-only controls must always be named. */
export function IconButton({
  icon: Icon,
  accessibilityLabel,
  onPress,
  variant = "surface",
  diameter = size.tap,
  iconSize = size.icon,
  disabled,
  selected,
  badge,
  testID,
  style,
}: IconButtonProps) {
  const t = useRoleTheme();
  const owner = useRole() === "owner";
  const d = Math.max(diameter, size.tap);
  const look = {
    plain: { bg: "transparent", fg: palette.night, border: "transparent" },
    surface: { bg: palette.white, fg: palette.night, border: "transparent" },
    mist: { bg: palette.mist, fg: palette.night, border: "transparent" },
    // owner "dark" surfaces are the teal hero: a night-tinted glass keeps white >= 4.5 on its lightest stop
    onDark: owner ? { bg: alpha.glassOnTeal, fg: palette.white, border: alpha.glassOnTealBorder } : { bg: alpha.glassDark, fg: palette.white, border: alpha.glassDarkBorder },
    onPhoto: { bg: alpha.heartOnPhoto, fg: palette.white, border: alpha.onPhotoBorder },
    primary: { bg: t.primary.bg, fg: t.primary.fg, border: t.primary.bg },
    night: { bg: palette.night, fg: palette.white, border: palette.night },
  }[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: selected ?? undefined }}
      disabled={disabled}
      hitSlop={d < size.tap ? (size.tap - d) / 2 : undefined}
      onPress={() => {
        haptic("selection");
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          width: d,
          height: d,
          borderRadius: radius.pill,
          backgroundColor: look.bg,
          borderWidth: look.border === "transparent" ? 0 : 1,
          borderColor: look.border,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Icon size={iconSize} color={look.fg} strokeWidth={2.2} />
      {badge ? (
        <View
          style={{
            position: "absolute",
            top: 2,
            right: 0,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: t.badge.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Text variant="tab" color={t.badge.fg}>
            {badge > 99 ? "99+" : String(badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
