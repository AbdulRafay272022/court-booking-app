import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { radius, space, statusPill, tone as toneTokens, type StatusInput, type Tone } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useLang, useRoleTheme } from "./theme";

export interface PillProps {
  label: string;
  tone?: Tone;
  icon?: ReactNode;
  size?: "sm" | "md";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Plain toned pill (not interactive). For booking status use <StatusPill booking={...}/>. */
export function Pill({ label, tone = "neutral", icon, size = "md", testID, style }: PillProps) {
  const c = toneTokens[tone];
  return (
    <View
      testID={testID}
      style={[
        {
          minHeight: size === "sm" ? 26 : 30,
          paddingHorizontal: space[3],
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: c.bg,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      {icon}
      <Text variant={size === "sm" ? "caption" : "label"} weight="black" color={c.fg}>
        {label}
      </Text>
    </View>
  );
}

export interface StatusPillProps {
  /** The booking's REAL status fields. "Pakki ✓" only when status === "booked" (rules/status.ts). */
  booking: StatusInput;
  size?: "sm" | "md";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatusPill({ booking, size, testID, style }: StatusPillProps) {
  const lang = useLang();
  const p = statusPill(booking, lang);
  return <Pill label={p.label} tone={p.tone} size={size} testID={testID ?? `status-${p.key}`} style={style} />;
}

/** Small count badge (orange + ink on both roles; the one orange accent allowed on owner screens). */
export function Badge({ count, testID }: { count: number; testID?: string }) {
  const t = useRoleTheme();
  if (!count) return null;
  return (
    <View
      testID={testID}
      style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: t.badge.bg, alignItems: "center", justifyContent: "center" }}
    >
      <Text variant="tab" color={t.badge.fg}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}
