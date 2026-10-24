import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, size, space } from "@court-booking/ui-tokens";
import { useRoleTheme } from "./theme";

export interface ScreenProps {
  children: ReactNode;
  /** Scrolls by default. false = fixed layout (you handle scrolling, e.g. a FlashList). */
  scroll?: boolean;
  /** Page background: "ground" (default) or "night" (dark full-screen states like 404). */
  background?: "ground" | "night" | "white";
  /** Apply the role gutter (20 player / 16 owner) left + right. Default true. */
  gutter?: boolean;
  /** Content starts under a full-bleed hero, so no top safe-area padding (the hero pads itself). */
  edgeToEdgeTop?: boolean;
  /** Reserve room for a floating tab bar / book bar so the last content is never hidden behind it. */
  floatingBar?: "tabs" | "bar" | null;
  /** Wraps content in KeyboardAvoidingView (forms). */
  keyboard?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Floating element (GlassBar / TabBar) rendered above the scroll view. */
  overlay?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Page shell: safe areas, role gutter, ground background, scroll, keyboard avoidance, pull-to-refresh, floating bar room. */
export function Screen({
  children,
  scroll = true,
  background = "ground",
  gutter = true,
  edgeToEdgeTop,
  floatingBar = null,
  keyboard,
  refreshing,
  onRefresh,
  overlay,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const t = useRoleTheme();
  const bg = background === "night" ? palette.night : background === "white" ? palette.white : palette.ground;
  const barRoom = floatingBar === "tabs" ? size.tabBarOwner + 22 + space[4] : floatingBar === "bar" ? 52 + 34 + space[4] : 0;
  const pad: ViewStyle = {
    paddingTop: edgeToEdgeTop ? 0 : insets.top + space[3],
    paddingBottom: Math.max(insets.bottom, space[4]) + barRoom,
    paddingHorizontal: gutter ? t.gutter : 0,
    gap: space[4],
  };
  const body = scroll ? (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={[pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.ring} colors={[t.ring]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View testID={testID} style={[{ flex: 1, backgroundColor: bg }, pad, contentStyle]}>
      {children}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {keyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
      {overlay}
    </View>
  );
}
