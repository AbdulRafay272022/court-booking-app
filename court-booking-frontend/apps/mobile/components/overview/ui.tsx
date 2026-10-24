import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { palette, radius, size, space, type Tone } from "@court-booking/ui-tokens";
import { Button, Checkbox as FlCheckbox, Chip, FontScaleProvider, LangProvider, Pill as FlPill, RoleProvider, Sheet, Text, useFontScale, useLang, useRole } from "@/components/ui";

/**
 * Owner sheet / control kit, now a thin layer over the Floodlight library (@/components/ui): every owner sheet (booking
 * detail, completion, no-show, refund, pickers, approvals) shares the DS Sheet, Button, Chip and Checkbox. The old
 * IBM Plex / hex look is gone. Kept as a module so the call sites (and their e2e labels) stay the same.
 */

/** A bottom sheet. Mount it only while open (it presents itself on mount; Close / backdrop / swipe call onClose). */
export function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testID,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Kept for old call sites: the DS Sheet sizes itself to the content up to the screen height. */
  tall?: boolean;
  testID?: string;
}) {
  // @gorhom renders the sheet in a portal at the app root, OUTSIDE the owner layout's providers: re-provide the owner
  // role, language and font scale to the content so buttons stay teal (never the player orange) inside sheets.
  const role = useRole();
  const lang = useLang();
  const fs = useFontScale();
  const wrap = (node: ReactNode) => (
    <RoleProvider role={role}>
      <LangProvider lang={lang}>
        <FontScaleProvider scale={fs}>{node}</FontScaleProvider>
      </LangProvider>
    </RoleProvider>
  );
  return (
    <Sheet open onClose={onClose} title={title} subtitle={subtitle} footer={footer ? wrap(footer) : undefined} testID={testID}>
      {wrap(children)}
    </Sheet>
  );
}

/** Filter pill (Sab / Booked / Cancelled ...). Selected = role tint + "✓" (never colour alone). */
export function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void; tone?: "neutral" | "green" | "red" | "amber" }) {
  return <Chip label={label} selected={selected} onPress={onPress} />;
}

/** Looks like a dropdown field; opens a sheet. The value wraps (never "…"). */
export function SelectButton({ label, value, onPress, disabled, compact }: { label?: string; value: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 0 : space[2] }}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${value}` : value}
        accessibilityState={{ disabled: !!disabled }}
        style={{
          minHeight: compact ? size.tap : 52,
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          paddingHorizontal: space[4],
          paddingVertical: space[2],
          borderRadius: radius.input,
          backgroundColor: palette.white,
          borderWidth: 1.5,
          borderColor: palette.lineStrong,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {value}
        </Text>
        <ChevronDown size={18} color={palette.night} />
      </Pressable>
    </View>
  );
}

/** Secondary action in a sheet footer / card. */
export function OutlineButton({ label, onPress, flex, disabled, testID }: { label: string; onPress: () => void; flex?: boolean; disabled?: boolean; testID?: string }) {
  return <Button label={label} onPress={onPress} variant="soft" size="md" disabled={disabled} block={!flex} style={flex ? { flex: 1 } : undefined} testID={testID} />;
}

/** The one main action (owner = teal + white, from the role theme). */
export function PrimaryButton({ label, onPress, flex, disabled, loading, testID }: { label: string; onPress: () => void; flex?: boolean; disabled?: boolean; loading?: boolean; testID?: string }) {
  return <Button label={label} onPress={onPress} variant="primary" size="md" disabled={disabled} loading={loading} block={!flex} style={flex ? { flex: 1 } : undefined} testID={testID} />;
}

/** Destructive confirm (Reject karein / No-show mark karein / Phir bhi approve karein). */
export function DangerButton({ label, onPress, flex, disabled, testID }: { label: string; onPress: () => void; flex?: boolean; disabled?: boolean; testID?: string }) {
  return <Button label={label} onPress={onPress} variant="dangerSolid" size="md" disabled={disabled} block={!flex} style={flex ? { flex: 1 } : undefined} testID={testID} />;
}

/** Small status chip (icon + text, toned by the Floodlight tones). */
export function SmallChip({ label, tone = "neutral", icon, onPress }: { label: string; tone?: Tone; icon?: ReactNode; onPress?: () => void }) {
  const inner = <FlPill label={label} tone={tone} icon={icon} size="sm" />;
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ minHeight: size.tap, justifyContent: "center" }}>
      {inner}
    </Pressable>
  );
}

export function Checkbox({ checked, label, sub, onPress }: { checked: boolean; label: string; sub?: string; onPress: () => void }) {
  return (
    <FlCheckbox checked={checked} onChange={() => onPress()} label={label}>
      <View style={{ gap: 1 }}>
        <Text variant="bodyBold">{label}</Text>
        {sub ? (
          <Text variant="caption" tone="muted">
            {sub}
          </Text>
        ) : null}
      </View>
    </FlCheckbox>
  );
}
