import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Hourglass, Lock, UserCheck } from "lucide-react-native";
import { radius, slot as slotTokens, slotChipA11y, slotChipCue, slotChipPressable, type SlotChipState } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useLang, useRoleTheme } from "./theme";
import { haptic } from "./haptics";

export interface SlotChipProps {
  /** From slotChipState(slot, ctx) (packages/ui-tokens rules/slot.ts). */
  state: SlotChipState;
  /** Formatted time, e.g. "8:00 PM" (use the shared PKT formatters, never toLocaleTimeString). */
  label: string;
  onPress?: () => void;
  /** SlotOut.reason for a blocked slot (spoken). */
  reason?: string | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * One time slot. Every state is visible without colour (System board): selected = "✓ " + 2px ink outline, inRange = 2px
 * outline, held = dashed amber + hourglass, booked = strikethrough, noRoom = dashed grey, blocked = dashed + lock +
 * strikethrough, mine = 2px green outline + person icon. Only open / selected / inRange / mine are pressable.
 */
export function SlotChip({ state, label, onPress, reason, testID, style }: SlotChipProps) {
  const t = useRoleTheme();
  const lang = useLang();
  const cue = slotChipCue(state);
  const look =
    state === "selected"
      ? { bg: t.slotSelected.bg, fg: t.slotSelected.fg, border: t.slotSelected.border, borderStyle: "solid" as const, borderWidth: 2 }
      : state === "inRange"
        ? { bg: t.slotInRange.bg, fg: t.slotInRange.fg, border: t.slotInRange.border, borderStyle: "solid" as const, borderWidth: 2 }
        : slotTokens[state];
  const pressable = slotChipPressable(state) && !!onPress;
  const Icon = cue.icon === "lock" ? Lock : cue.icon === "hourglass" ? Hourglass : cue.icon === "user" ? UserCheck : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={slotChipA11y(state, label, lang, reason)}
      accessibilityState={{ disabled: !pressable, selected: state === "selected" || state === "inRange" }}
      disabled={!pressable}
      onPress={() => {
        haptic("selection");
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          minHeight: 48,
          minWidth: 44,
          paddingHorizontal: 8,
          borderRadius: radius.md,
          backgroundColor: look.bg,
          borderColor: look.border,
          borderWidth: look.borderWidth,
          borderStyle: look.borderStyle,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          opacity: pressed ? 0.85 : 1,
          boxShadow: state === "selected" ? t.primary.shadow : undefined,
        },
        style,
      ]}
    >
      {Icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no">
          <Icon size={13} color={look.fg} strokeWidth={2.4} />
        </View>
      ) : null}
      <Text variant="bodyBold" color={look.fg} strike={cue.strike} align="center">
        {cue.prefix}
        {label}
      </Text>
    </Pressable>
  );
}
