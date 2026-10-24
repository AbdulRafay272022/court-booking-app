import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Plus } from "lucide-react-native";
import { radius, size, space, type as typeScale } from "@court-booking/ui-tokens";
import { GlassBar } from "./GlassBar";
import type { IconComponent } from "./IconButton";
import { Text } from "./Text";
import { useFontScale, useRoleTheme } from "./theme";
import { haptic } from "./haptics";

export interface TabItem {
  key: string;
  label: string;
  icon: IconComponent;
  active?: boolean;
  /** Count badge (orange + ink). Include it in the spoken label yourself ("Approvals, 3 naye"). */
  badge?: number | null;
  accessibilityLabel?: string;
  onPress: () => void;
  testID?: string;
}

export interface TabBarProps {
  items: TabItem[];
  /** Owner only: the teal "+" walk-in button placed in the middle of the bar. */
  fab?: { accessibilityLabel: string; onPress: () => void; icon?: IconComponent; testID?: string };
  /** Float at the bottom of the screen (default). false renders in place (dev page, previews). */
  floating?: boolean;
  testID?: string;
}

/**
 * Floating glass tab bar (Main / OwnerToday boards). Active tab = role pill (player orange + ink, owner teal + white).
 * Presentational: wire it to expo-router Tabs via the `tabBar` prop, mapping state.routes -> items.
 * Height 70 (player) / 72 (owner); every target >= 44.
 */
export function TabBar({ items, fab, floating = true, testID }: TabBarProps) {
  const t = useRoleTheme();
  const cells: ReactNode[] = items.map((it) => <TabCell key={it.key} item={it} />);
  if (fab) {
    const FabIcon = fab.icon ?? Plus;
    const f = t.fab ?? { bg: t.primary.bg, fg: t.primary.fg, shadow: t.primary.shadow };
    cells.splice(
      Math.floor(cells.length / 2),
      0,
      <View key="__fab" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Pressable
          testID={fab.testID ?? "tabbar-fab"}
          accessibilityRole="button"
          accessibilityLabel={fab.accessibilityLabel}
          onPress={() => {
            haptic("medium");
            fab.onPress();
          }}
          style={({ pressed }) => ({
            width: size.fab,
            height: size.fab,
            borderRadius: radius.button,
            backgroundColor: f.bg,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: f.shadow,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <FabIcon size={24} color={f.fg} strokeWidth={2.6} />
        </Pressable>
      </View>,
    );
  }
  return (
    <GlassBar floating={floating} testID={testID ?? "tabbar"} style={{ minHeight: t.role === "owner" ? size.tabBarOwner : size.tabBar }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 6, gap: 2 }}>
        {cells}
      </View>
    </GlassBar>
  );
}

function TabCell({ item }: { item: TabItem }) {
  const t = useRoleTheme();
  const scale = useFontScale();
  const [w, setW] = useState(0);
  const Icon = item.icon;
  // Tab labels are short nav words: shrink to fit the cell (320 pt + large font) instead of clipping or "…".
  const base = typeScale.tab.size * Math.min(scale, 1.3);
  const fit = w > 0 ? (w - 4) / Math.max(item.label.length * 0.62, 1) : base;
  const fontSize = Math.max(8, Math.min(base, fit));
  const fg = item.active ? t.tabActive.fg : t.tabIdle.fg;
  return (
    <Pressable
      testID={item.testID ?? `tab-${item.key}`}
      accessibilityRole="tab"
      accessibilityLabel={item.accessibilityLabel ?? item.label}
      accessibilityState={{ selected: !!item.active }}
      onPress={() => {
        haptic("selection");
        item.onPress();
      }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{
        flex: 1,
        minHeight: 56,
        borderRadius: 20,
        backgroundColor: item.active ? t.tabActive.bg : "transparent",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        paddingHorizontal: 2,
      }}
    >
      <View>
        <Icon size={22} color={fg} strokeWidth={2.1} />
        {item.badge ? (
          <View
            style={{ position: "absolute", top: -5, right: -10, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: t.badge.bg, alignItems: "center", justifyContent: "center" }}
          >
            <Text variant="tab" color={t.badge.fg}>
              {item.badge > 99 ? "99+" : String(item.badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="tab" color={fg} weight={item.active ? "black" : "bold"} align="center" style={{ fontSize, lineHeight: fontSize * 1.3 }}>
        {item.label}
      </Text>
    </Pressable>
  );
}

export interface ActionBarProps {
  /** Left side: small label + big value ("Total" / "PKR 4,000"); wraps, never truncated. */
  caption?: string;
  value?: string;
  /** Right side: buttons (IconButton + Button). */
  children: ReactNode;
  floating?: boolean;
  testID?: string;
}

/** Floating book / pay / approve bar (Venue board): glass light, total on the left, actions on the right. Money is on a SOLID bar. */
export function ActionBar({ caption, value, children, floating = true, testID }: ActionBarProps) {
  return (
    <GlassBar solid floating={floating} testID={testID ?? "action-bar"}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], paddingLeft: space[4], flexWrap: "wrap" }}>
        {caption || value ? (
          <View style={{ flex: 1, minWidth: 110, gap: 1 }}>
            {caption ? (
              <Text variant="caption" weight="bold" tone="muted">
                {caption}
              </Text>
            ) : null}
            {value ? <Text variant="title">{value}</Text> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: space[2], alignItems: "center", marginLeft: "auto" }}>{children}</View>
      </View>
    </GlassBar>
  );
}
