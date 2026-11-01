import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Pressable } from "./Pressable";
import { palette, radius, size, space } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useRoleTheme } from "./theme";
import { haptic } from "./haptics";

export interface ChipProps {
  label: string;
  /** Selected = role tint + 2px role border + "✓ " prefix (never colour-only). */
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Optional leading icon element. */
  icon?: ReactNode;
  /** Optional trailing count badge (e.g. Amenities [6]). */
  count?: number;
  /** Selected = solid role colour (OPaisa range / court filters) instead of tint + border. Still prefixed "✓ ". */
  solid?: boolean;
  /** "pill" (999 radius, filters) or "tile" (14 radius, courts / durations / payment methods). */
  shape?: "pill" | "tile";
  /** Stretch to fill a grid cell. */
  block?: boolean;
  /** Two-line tile (court name + meta). */
  meta?: string;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Selectable chip / option tile (PSearch filters, Venue courts/days, OWalkin payment method). Height >= 44. */
export function Chip({ label, selected, solid, onPress, disabled, icon, count, shape = "pill", block, meta, accessibilityLabel, testID, style }: ChipProps) {
  const t = useRoleTheme();
  // Boards: a pill (filters) is white with a 1.5 px line when idle; a tile (court, day, duration, payment method) is a
  // calm ground fill with a transparent 2 px border, so selecting it never shifts the layout.
  // Solid: owner = teal + white (OPaisa), player = night + white (PBookings "Sab · 3"), never white on orange.
  const solidLook = t.role === "owner" ? { bg: t.primary.bg, fg: t.primary.fg, border: t.primary.bg } : { bg: palette.night, fg: palette.white, border: palette.night };
  const on = selected ? (solid ? solidLook : t.selected) : null;
  const bg = on ? on.bg : shape === "tile" ? palette.ground : palette.white;
  const fg = on ? on.fg : palette.night;
  const border = on ? on.border : shape === "tile" ? "transparent" : palette.lineStrong;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? (meta ? `${label}, ${meta}` : label)}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled || !onPress}
      onPress={() => {
        haptic("selection");
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          minHeight: meta ? 60 : shape === "tile" ? 52 : size.tap,
          paddingHorizontal: shape === "pill" ? space[4] : space[3],
          paddingVertical: space[2],
          borderRadius: shape === "pill" ? radius.pill : radius.md,
          backgroundColor: bg,
          borderWidth: selected || shape === "tile" ? 2 : 1.5,
          borderColor: border,
          flexDirection: meta ? "column" : "row",
          alignItems: meta ? "flex-start" : "center",
          justifyContent: "center",
          gap: meta ? 1 : space[2],
          alignSelf: block ? "stretch" : "flex-start",
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon ? <View accessibilityElementsHidden importantForAccessibility="no">{icon}</View> : null}
      <Text variant="label" color={fg} style={{ flexShrink: 1 }}>
        {selected ? "✓ " : ""}
        {label}
      </Text>
      {meta ? (
        <Text variant="caption" tone="muted">
          {meta}
        </Text>
      ) : null}
      {count !== undefined ? (
        <View
          style={{
            minWidth: 26,
            height: 26,
            paddingHorizontal: 6,
            borderRadius: 13,
            backgroundColor: palette.tealTint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="caption" weight="black" color={palette.tealDeep}>
            {String(count)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
