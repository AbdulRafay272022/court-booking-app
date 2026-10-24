import { View } from "react-native";
import { Check, X } from "lucide-react-native";
import { alpha, palette, type JourneyStepState } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useCopy, useRoleTheme } from "./theme";

export interface TimelineStep {
  /** Same shape as journeySteps() output from ui-tokens, so you can pass it straight in. */
  label: string;
  /** Time / amount line ("4:58 PM · PKR 4,000"). Real values only; omit when unknown. */
  sub?: string;
  state: JourneyStepState;
}

/**
 * Vertical step list (Status board: Hold -> Screenshot bheja -> Venue check -> Pakki). Feed it journeySteps(booking) from
 * ui-tokens so "Pakki" can only be done when the backend says booked. done = teal dot + tick, now = amber ring, next =
 * outlined, failed = red cross.
 */
export function Timeline({ steps, testID }: { steps: TimelineStep[]; testID?: string }) {
  const copy = useCopy();
  const stateWord = (s: JourneyStepState) =>
    s === "done" ? copy("ho gaya", "done") : s === "now" ? copy("abhi", "now") : s === "failed" ? copy("ruk gaya", "stopped") : copy("baqi", "next");
  return (
    <View testID={testID ?? "timeline"} accessibilityRole="list">
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        const dot =
          st.state === "done"
            ? { bg: palette.teal, border: palette.teal, borderWidth: 0 }
            : st.state === "now"
              ? { bg: palette.waitingTint, border: palette.amber, borderWidth: 3 }
              : st.state === "failed"
                ? { bg: palette.danger, border: palette.danger, borderWidth: 0 }
                : { bg: palette.white, border: palette.lineStrong, borderWidth: 2 };
        const titleColor = st.state === "now" ? palette.waiting : st.state === "next" ? palette.muted2 : st.state === "failed" ? palette.danger : palette.night;
        return (
          <View key={`${i}-${st.label}`} accessible accessibilityLabel={`${st.label}, ${stateWord(st.state)}${st.sub ? `, ${st.sub}` : ""}`} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ width: 28, alignItems: "center" }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: dot.bg, borderColor: dot.border, borderWidth: dot.borderWidth, alignItems: "center", justifyContent: "center" }}>
                {st.state === "done" ? <Check size={14} color={palette.white} strokeWidth={3.2} /> : st.state === "failed" ? <X size={14} color={palette.white} strokeWidth={3.2} /> : null}
              </View>
              {!last ? <View style={{ flex: 1, width: 2, minHeight: 18, backgroundColor: st.state === "done" ? palette.teal : palette.line }} /> : null}
            </View>
            <View style={{ flex: 1, gap: 2, paddingTop: 3, paddingBottom: last ? 0 : 18 }}>
              <Text variant="bodyBold" color={titleColor} weight={st.state === "next" ? "bold" : "black"}>
                {st.label}
              </Text>
              {st.sub ? (
                <Text variant="meta" tone="muted">
                  {st.sub}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Horizontal 4-segment progress (Pay board hero: Hold · Pay · Venue check · Booked). `current` = index of the active step. */
export function StepBar({ labels, current, tone = "dark", testID }: { labels: string[]; current: number; tone?: "dark" | "light"; testID?: string }) {
  const t = useRoleTheme();
  const dark = tone === "dark";
  return (
    <View testID={testID ?? "step-bar"} accessible accessibilityRole="progressbar" accessibilityLabel={`${labels[current] ?? ""} (${current + 1}/${labels.length})`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {labels.map((l, i) => {
        const done = i < current;
        const now = i === current;
        const bar = done ? (dark ? palette.mint : palette.teal) : now ? (dark ? t.ringOnHero : t.ring) : dark ? alpha.stepIdleOnDark : palette.line;
        const fg = done ? (dark ? palette.mint : palette.open) : now ? (dark ? palette.white : palette.night) : dark ? palette.onDarkMuted : palette.muted;
        return (
          <View key={l} style={{ flexGrow: 1, flexBasis: 64, gap: 6 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: bar }} />
            <Text variant="caption" weight={now || done ? "black" : "bold"} color={fg}>
              {l}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Numbered step marker ("1 PKR 4,000 bhejein", Venue "1 Court 2 Din"). Role primary disc with role primary fg. */
export function StepNumber({ n }: { n: number }) {
  const t = useRoleTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.primary.bg, alignItems: "center", justifyContent: "center" }}>
      <Text variant="label" color={t.primary.fg}>
        {String(n)}
      </Text>
    </View>
  );
}

