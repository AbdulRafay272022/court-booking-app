import { forwardRef, useState, type ElementRef } from "react";
import { Pressable as RNPressable, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";

/**
 * Pressable that resolves a function `style={({ pressed }) => ...}` itself and hands React Native a plain style.
 *
 * Why: NativeWind wraps the native Pressable (`cssInterop(Pressable, { className: "style" })`), and on Android that
 * wrapper drops a FUNCTION style completely: background, padding, size and flexDirection were all lost, so the teal
 * Approve button, the "+" tab, quick actions and every 44 pt back button rendered as bare 20 dp text/icons.
 * Object styles were never affected. Use this Pressable (from "@/components/ui") whenever the style depends on `pressed`.
 */
export const Pressable = forwardRef<ElementRef<typeof RNPressable>, PressableProps>(function Pressable({ style, children, onPressIn, onPressOut, ...rest }, ref) {
  const [pressed, setPressed] = useState(false);
  const state = { pressed, hovered: false } as PressableStateCallbackType;
  const resolved: StyleProp<ViewStyle> = typeof style === "function" ? style(state) : style;
  return (
    <RNPressable
      ref={ref}
      {...rest}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={resolved}
    >
      {typeof children === "function" ? children(state) : children}
    </RNPressable>
  );
});
