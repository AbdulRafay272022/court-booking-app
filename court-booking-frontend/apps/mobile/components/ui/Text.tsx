import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { mobileFontFor, text as textTokens, type as typeScale, type FontWeightKey, type TypeVariant } from "@court-booking/ui-tokens";
import { useFontScale, useRoleTheme } from "./theme";

export type TextTone = keyof typeof textTokens | "link" | "accent" | "hero" | "heroMuted" | "inherit";

export interface FlTextProps extends TextProps {
  /** Type scale entry (tokens `type`). Default "body". */
  variant?: TypeVariant;
  /** Colour from the text tokens. Default "primary". "link"/"accent"/"hero"/"heroMuted" follow the role (use hero* inside <Hero>). "inherit" leaves colour unset. */
  tone?: TextTone;
  /** Explicit token colour (only for colours handed out by a component, e.g. a tone's fg). Prefer `tone`. */
  color?: string;
  weight?: FontWeightKey;
  align?: TextStyle["textAlign"];
  /** Strikethrough (booked slots). */
  strike?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * The ONLY text primitive in components/ui. Bricolage for display variants, Plus Jakarta for everything else, tabular
 * numbers always. Never pass numberOfLines for money, time, names or phones (wrap instead).
 */
export function Text({ variant = "body", tone = "primary", color, weight, align, strike, style, ...rest }: FlTextProps) {
  const scale = useFontScale();
  const roleTheme = useRoleTheme();
  const t = typeScale[variant];
  const c =
    color ??
    (tone === "inherit"
      ? undefined
      : tone === "link"
        ? roleTheme.link
        : tone === "accent"
          ? roleTheme.accentText
          : tone === "hero"
            ? roleTheme.hero.fg
            : tone === "heroMuted"
              ? roleTheme.hero.fgMuted
              : textTokens[tone]);
  const s: TextStyle = {
    fontFamily: mobileFontFor(variant, weight),
    fontSize: t.size * scale,
    lineHeight: t.lineHeight * scale,
    letterSpacing: t.letterSpacing,
    fontVariant: ["tabular-nums"],
    textAlign: align,
    textDecorationLine: strike ? "line-through" : undefined,
  };
  if (c) s.color = c;
  return <RNText {...rest} style={[s, style]} />;
}
