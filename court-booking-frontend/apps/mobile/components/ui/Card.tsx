import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";

export interface CardProps {
  children: ReactNode;
  /** "raised" = white + soft shadow (default), "flat" = white with a hairline, "sunken" = ground fill, "night" = dark card. */
  variant?: "raised" | "flat" | "sunken" | "night";
  padding?: 0 | 3 | 4 | 5;
  radiusSize?: "tile" | "card" | "cardL";
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, variant = "raised", padding = 4, radiusSize = "card", onPress, accessibilityLabel, testID, style }: CardProps) {
  const base: ViewStyle = {
    backgroundColor: variant === "sunken" ? palette.ground : variant === "night" ? palette.night : palette.white,
    borderRadius: radius[radiusSize],
    padding: space[padding],
    borderWidth: variant === "flat" ? 1 : 0,
    borderColor: palette.line,
  };
  const shadowStyle = variant === "raised" ? { boxShadow: shadow.card } : null;
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [base, shadowStyle, { opacity: pressed ? 0.92 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[base, shadowStyle, style]}>
      {children}
    </View>
  );
}
