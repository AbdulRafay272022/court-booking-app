import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { glass, radius, shadow, space } from "@court-booking/ui-tokens";
import { useGlassMode } from "./theme";

export interface GlassBarProps {
  children: ReactNode;
  /** "light" (tab bar, book bar) or "dark" (pills on night heroes / photos). */
  tone?: "light" | "dark";
  /** Float at the bottom of the screen above the home indicator (default true). false = render in place. */
  floating?: boolean;
  /** Force the solid fallback (e.g. a bar over money/body text). */
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Glass only on floating chrome (System board). Uses expo-blur, and falls back to SOLID when reduce-transparency is on,
 * on web, and on low-end Android (rules/platform.ts glassMode). Never put money or body text on glass without `solid`.
 */
export function GlassBar({ children, tone = "light", floating = true, solid, style, testID }: GlassBarProps) {
  const mode = useGlassMode();
  const insets = useSafeAreaInsets();
  const g = glass[tone];
  const useBlur = mode === "blur" && !solid;
  const frame: ViewStyle = {
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: useBlur ? g.border : g.solidBorder,
    backgroundColor: useBlur ? g.bg : g.solid,
    boxShadow: shadow.raised,
  };
  const pos: ViewStyle | null = floating ? { position: "absolute", left: space[4], right: space[4], bottom: Math.max(insets.bottom, space[3]) + space[2] } : null;
  return (
    <View testID={testID} style={[pos, frame, style]} accessibilityRole="toolbar">
      {useBlur ? <BlurView intensity={40} tint={tone === "light" ? "light" : "dark"} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.pill }} /> : null}
      {children}
    </View>
  );
}
