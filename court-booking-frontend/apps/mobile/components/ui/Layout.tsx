import type { ReactNode } from "react";
import { Image, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import { initials as toInitials, palette, radius, size, space, tone as toneTokens, type Tone } from "@court-booking/ui-tokens";
import type { IconComponent } from "./IconButton";
import { Text } from "./Text";
import { useRoleTheme } from "./theme";

/** Section title row: Bricolage title, optional "Sab dekho" link action. */
export function SectionHeader({ title, subtitle, actionLabel, onAction, testID }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" }}>
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="meta" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="link" onPress={onAction} style={{ minHeight: size.tap, justifyContent: "center" }}>
          <Text variant="bodyBold" tone="link">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconComponent;
  /** Leading element instead of an icon (Avatar). */
  leading?: ReactNode;
  /** Right side: value text, badge, switch... Default = chevron when pressable. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Hairline under the row (inside grouped cards). */
  divider?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** Menu / settings row (OwnerMore, OSettings hub, PAccount). Min height 64, wraps long text. */
export function ListRow({ title, subtitle, icon: Icon, leading, trailing, onPress, divider, danger, accessibilityLabel, testID }: ListRowProps) {
  const t = useRoleTheme();
  const content = (
    <>
      {leading ??
        (Icon ? (
          <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: danger ? palette.dangerTint : palette.ground, alignItems: "center", justifyContent: "center" }}>
            <Icon size={20} color={danger ? palette.danger : t.role === "owner" ? palette.teal : palette.night} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyBold" tone={danger ? "danger" : "primary"}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="meta" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? <ChevronRight size={16} color={palette.muted} /> : null)}
    </>
  );
  const style: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
    minHeight: 64,
    borderBottomWidth: divider ? 1 : 0,
    borderBottomColor: palette.divider,
  };
  if (!onPress)
    return (
      <View testID={testID} style={style}>
        {content}
      </View>
    );
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [style, { backgroundColor: pressed ? palette.ground : "transparent" }]}>
      {content}
    </Pressable>
  );
}

/** Initials avatar (PChat inbox) or photo-less person/venue mark. Tone picks a token pair. */
/** Round avatar: the person's photo when `uri` is set (audit 2026-10-28 item 6), else their initials on a tone. */
export function Avatar({ name, size: d = 48, tone = "night", uri }: { name: string; size?: number; tone?: Tone | "teal" | "orange"; uri?: string | null }) {
  if (uri) {
    return <Image source={{ uri }} accessibilityElementsHidden importantForAccessibility="no" style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: palette.mist }} />;
  }
  const look =
    tone === "teal" ? { bg: palette.teal, fg: palette.white } : tone === "orange" ? { bg: palette.orange, fg: palette.night } : { bg: toneTokens[tone].bg, fg: toneTokens[tone].fg };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: look.bg, alignItems: "center", justifyContent: "center" }}>
      <Text variant="bodyStrong" color={look.fg}>
        {toInitials(name)}
      </Text>
    </View>
  );
}

export interface MoneyRow {
  label: string;
  /** Pre-formatted ("PKR 4,000"; formatPkr from ui-tokens). Never truncated. */
  value: string;
  /** Emphasis for the bottom line (Baqi / Total). */
  strong?: boolean;
  tone?: "default" | "open" | "danger" | "waiting";
  note?: string;
}

/** Total / Mila / Baqi block (OSheets, PBookings detail, confirm sheet). Values from the API only. */
export function MoneyRows({ rows, testID, style }: { rows: MoneyRow[]; testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View testID={testID ?? "money-rows"} style={[{ backgroundColor: palette.ground, borderRadius: radius.input, paddingHorizontal: 14, paddingVertical: 6 }, style]}>
      {rows.map((r, i) => (
        <View
          key={r.label}
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space[3], paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.line, flexWrap: "wrap" }}
        >
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text variant={r.strong ? "bodyBold" : "body"} tone={r.strong ? "primary" : "muted"}>
              {r.label}
            </Text>
            {r.note ? (
              <Text variant="caption" tone="muted">
                {r.note}
              </Text>
            ) : null}
          </View>
          <Text variant={r.strong ? "title" : "bodyStrong"} tone={r.tone === "open" ? "open" : r.tone === "danger" ? "danger" : r.tone === "waiting" ? "waiting" : "primary"} align="right" style={{ marginLeft: "auto" }}>
            {r.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Role hero: player = night, owner = teal gradient (expo-linear-gradient, 165deg). Pads the top safe area itself. */
export function Hero({ children, topInset = 0, roundedBottom, style, testID }: { children: ReactNode; topInset?: number; roundedBottom?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const t = useRoleTheme();
  const inner: ViewStyle = { paddingTop: topInset + space[5], paddingBottom: space[8], paddingHorizontal: t.gutter, gap: space[4], borderBottomLeftRadius: roundedBottom ? radius.sheet : 0, borderBottomRightRadius: roundedBottom ? radius.sheet : 0, overflow: "hidden" };
  if (t.hero.stops) {
    // 165deg ~ from top-left to bottom-right, mostly vertical.
    return (
      <LinearGradient testID={testID} colors={t.hero.stops as unknown as [string, string, ...string[]]} locations={[0, 0.55, 1]} start={{ x: 0.37, y: 0 }} end={{ x: 0.63, y: 1 }} style={[inner, style]}>
        {children}
      </LinearGradient>
    );
  }
  return (
    <View testID={testID} style={[inner, { backgroundColor: t.hero.bg }, style]}>
      {children}
    </View>
  );
}
