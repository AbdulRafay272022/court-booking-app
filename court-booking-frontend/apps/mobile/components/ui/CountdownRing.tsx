import { useEffect, useState } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { alpha, countdown, palette, ringDash } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useCopy, useRoleTheme } from "./theme";

export interface CountdownRingProps {
  /** REAL expiry, e.g. booking.held_until (ISO). Never a locally invented deadline. */
  expiresAt: string | null;
  /** Whole window in ms (windowMs(created_at, held_until)); default 15 min. */
  totalMs?: number;
  /** Caption under the time ("pay karne ke liye"). */
  caption?: string;
  /** "dark" on a night hero (Pay board), "light" on white. */
  tone?: "dark" | "light";
  diameter?: number;
  /** Called once when it reaches 0. */
  onExpire?: () => void;
  /** Injected clock for tests / dev page. */
  now?: () => number;
  testID?: string;
}

/**
 * Pay board ring: role colour progress (player orange, owner teal) on a translucent track, mm:ss in Bricolage. Updates once
 * a second (no animation, so reduce-motion needs nothing extra). Announces minutes, not every second.
 */
export function CountdownRing({ expiresAt, totalMs, caption, tone = "dark", diameter = 150, onExpire, now = Date.now, testID }: CountdownRingProps) {
  const t = useRoleTheme();
  const copy = useCopy();
  const [tick, setTick] = useState(now());
  const c = countdown(expiresAt, tick, totalMs);
  useEffect(() => {
    if (c.expired) return;
    const id = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(id);
  }, [c.expired, now]);
  useEffect(() => {
    if (c.expired && expiresAt) onExpire?.();
  }, [c.expired, expiresAt, onExpire]);
  const dark = tone === "dark";
  const stroke = 8;
  const r = diameter / 2 - stroke;
  const { circumference, offset } = ringDash(r, c.fraction);
  const minutes = Math.ceil(c.msLeft / 60000);
  return (
    <View
      testID={testID ?? "countdown-ring"}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={c.expired ? copy("Waqt khatam", "Time is up") : copy(`${minutes} minute baqi`, `${minutes} minutes left`)}
      style={{ width: diameter, height: diameter }}
    >
      <Svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`}>
        <Circle cx={diameter / 2} cy={diameter / 2} r={r} fill="none" stroke={dark ? alpha.ringTrackOnDark : alpha.ringTrackOnLight} strokeWidth={stroke} />
        <Circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={r}
          fill="none"
          stroke={c.expired ? palette.danger : dark ? t.ringOnHero : t.ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${diameter / 2} ${diameter / 2})`}
        />
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <Text variant="h1" tone={dark ? "onDark" : "primary"} style={{ fontSize: diameter < 120 ? 24 : 34 }}>
          {c.label}
        </Text>
        {caption ? (
          <Text variant="caption" weight="bold" tone={dark ? "onDarkMuted" : "muted"} align="center">
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
