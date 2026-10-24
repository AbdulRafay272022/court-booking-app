import { useEffect, useRef } from "react";
import { Animated, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { motion, palette, radius, space } from "@court-booking/ui-tokens";
import { useReduceMotion } from "./theme";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Block radius; default 8. */
  r?: number;
  /** "strong" = palette.line (titles), "soft" = palette.mist (lines), "photo" = palette.bookedBg. */
  shade?: "strong" | "soft" | "photo";
  style?: StyleProp<ViewStyle>;
}

/** Grey placeholder block. Gentle pulse (off with reduce-motion). Loading never shows "0" (PStates board). */
export function Skeleton({ width = "100%", height = 14, r = 8, shade = "soft", style }: SkeletonProps) {
  const reduce = useReduceMotion();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) {
      o.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 0.55, duration: motion.slow * 3, useNativeDriver: true }),
        Animated.timing(o, { toValue: 1, duration: motion.slow * 3, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, o]);
  const bg = shade === "strong" ? palette.line : shade === "photo" ? palette.bookedBg : palette.mist;
  return (
    <Animated.View style={{ opacity: o }}>
      <View style={[{ width, height, borderRadius: r, backgroundColor: bg }, style]} />
    </Animated.View>
  );
}

/** The PStates loading frame: title, search bar and N venue-card skeletons. Announced as busy. */
export function SkeletonList({ cards = 2, testID }: { cards?: number; testID?: string }) {
  return (
    <View testID={testID ?? "skeleton-list"} accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessibilityLabel="Loading" style={{ gap: space[4] }}>
      <Skeleton width="60%" height={30} r={10} shade="strong" />
      <Skeleton height={56} r={radius.button} shade="strong" />
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

export function SkeletonCard() {
  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radius.card, overflow: "hidden" }}>
      <Skeleton height={140} r={0} shade="photo" />
      <View style={{ padding: space[4], gap: 10 }}>
        <Skeleton width="55%" height={20} shade="strong" />
        <Skeleton width="80%" height={14} r={6} />
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Skeleton width={76} height={40} r={radius.sm} />
          <Skeleton width={76} height={40} r={radius.sm} />
          <Skeleton width={76} height={40} r={radius.sm} />
        </View>
      </View>
    </View>
  );
}
