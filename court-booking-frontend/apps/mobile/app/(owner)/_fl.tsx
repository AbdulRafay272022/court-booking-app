import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { alpha, palette, radius, size, space } from "@court-booking/ui-tokens";
import { Header, Hero, SegmentedToggle, Text, type IconComponent } from "@/components/ui";

import { useMyPermissions } from "@/lib/use-my-permissions";
import { paisaSegments, type PaisaSegment } from "@/lib/owner-floodlight";

/**
 * Owner-only Floodlight building blocks (boards OwnerToday / Approvals / OPaisa). Built ONLY from @/components/ui + tokens.
 * Candidates for promotion to components/ui (listed in the M2 report): HeroLayout, HeroChip, OwnerHeader, PaisaSwitch.
 */

/** Back for an owner stack screen: back if possible, else the owner's first screen (a deep link has nothing under it). */
export function ownerBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/(owner)");
}

/**
 * Board layout used by Aaj / Approvals / Paisa: full-bleed teal hero, then the ground "sheet" that overlaps it by 28 with a
 * 30 radius. The caller puts it inside a scroll (Screen edgeToEdgeTop gutter={false}).
 */
export function HeroLayout({ hero, children, testID }: { hero: ReactNode; children: ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID}>
      <Hero topInset={insets.top} style={{ paddingBottom: space[8] + 28 }}>
        {hero}
      </Hero>
      <View style={{ marginTop: -28, minHeight: 36, backgroundColor: palette.ground, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: space[5], paddingHorizontal: space[4], gap: 14 }}>
        {children}
      </View>
    </View>
  );
}

/** Glass chip on the teal hero ("6 bookings", "PKR 1,250 baqi"). Text is white on the dark glass (passes on the gradient). */
export function HeroChip({ label, onPress, accessibilityLabel, testID }: { label: string; onPress?: () => void; accessibilityLabel?: string; testID?: string }) {
  const body = (
    <View style={{ minHeight: 34, paddingHorizontal: space[3], paddingVertical: 6, borderRadius: radius.pill, backgroundColor: alpha.glassDark, borderWidth: 1, borderColor: alpha.glassDarkBorder, justifyContent: "center" }}>
      <Text variant="label" tone="hero">
        {label}
      </Text>
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={{ minHeight: size.tap, justifyContent: "center" }}>
      {body}
    </Pressable>
  );
}

/** A plain owner stack header (Floodlight Header, 44pt "Wapas"). */
export function OwnerHeader({ title, subtitle, eyebrow, right, onBack = ownerBack, testID }: { title: string; subtitle?: string; eyebrow?: string; right?: ReactNode; onBack?: (() => void) | null; testID?: string }) {
  return <Header title={title} subtitle={subtitle} eyebrow={eyebrow} right={right} onBack={onBack ?? undefined} testID={testID} />;
}

const SEGMENT_LABEL: Record<PaisaSegment, string> = { ledger: "Ledger", refunds: "Refunds", history: "History" };
const SEGMENT_HREF = {
  ledger: "/(owner)/(tabs)/ledger",
  refunds: "/(owner)/(tabs)/refunds",
  history: "/(owner)/history",
} as const;

/**
 * OPaisa: Ledger / Refunds / History grouped under the "Paisa" tab. Each segment opens its EXISTING route (deep links and
 * notification paths keep working); only the segments this account may open are shown.
 */
export function PaisaSwitch({ current, tone = "dark" }: { current: PaisaSegment; tone?: "dark" | "light" }) {
  const { can } = useMyPermissions();
  const segs = paisaSegments(can);
  if (segs.length < 2) return null;
  return (
    <SegmentedToggle
      testID="paisa-switch"
      accessibilityLabel="Paisa"
      tone={tone}
      value={current}
      options={segs.map((s) => ({ value: s, label: SEGMENT_LABEL[s] }))}
      onChange={(v) => {
        if (v === current) return;
        if (v === "history") router.push(SEGMENT_HREF.history);
        else router.navigate(SEGMENT_HREF[v]);
      }}
    />
  );
}

/** Small icon tile used on menu rows (OwnerMore / OSettings hub): teal on teal tint, or a status tone. */
export function IconTile({ icon: Icon, tone = "teal" }: { icon: IconComponent; tone?: "teal" | "open" | "waiting" | "danger" | "neutral" }) {
  const look = {
    teal: { bg: palette.tealTint, fg: palette.teal },
    open: { bg: palette.openTint, fg: palette.open },
    waiting: { bg: palette.waitingTint, fg: palette.waiting },
    danger: { bg: palette.dangerTint, fg: palette.danger },
    neutral: { bg: palette.mist, fg: palette.night },
  }[tone];
  return (
    <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: look.bg, alignItems: "center", justifyContent: "center" }}>
      <Icon size={20} color={look.fg} />
    </View>
  );
}

/** Uppercase group label above a card of rows ("BOOKINGS", "PAISA"). */
export function GroupLabel({ children }: { children: string }) {
  return (
    <Text variant="eyebrow" tone="muted" style={{ paddingHorizontal: space[1], letterSpacing: 1.2 }}>
      {children.toUpperCase()}
    </Text>
  );
}

/** A white grouped card holding ListRows (dividers between). */
export function GroupCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[{ backgroundColor: palette.white, borderRadius: radius.tile, overflow: "hidden" }, style]}>
      {children}
    </View>
  );
}

/** Key / value line (booking detail, settings summaries). Value wraps, never truncated. */
export function KeyValue({ label, value, valueTone, last }: { label: string; value: string; valueTone?: "danger" | "open" | "waiting"; last?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space[3], paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.bookedBg, flexWrap: "wrap" }}>
      <Text variant="body" tone="muted" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant="bodyBold" tone={valueTone ?? "primary"} align="right" style={{ flexShrink: 1, marginLeft: "auto" }}>
        {value}
      </Text>
    </View>
  );
}

export function KeyValueBlock({ children }: { children: ReactNode }) {
  return <View style={{ backgroundColor: palette.ground, borderRadius: 18, paddingHorizontal: 14, paddingVertical: space[1] }}>{children}</View>;
}

/** Big Bricolage money figure (hero / tiles). */
export function BigMoney({ value, tone = "primary", testID }: { value: string; tone?: "primary" | "hero"; testID?: string }) {
  return (
    <Text testID={testID} variant="displayXL" tone={tone} align="center">
      {value}
    </Text>
  );
}

export interface OwnerRadioOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

/**
 * Reason / choice radios (OSheets reject sheet, approve overpayment choice). Same look as the DS RadioGroup, plus
 * `aria-checked` so the checked state also reaches the web accessibility tree (the DS RadioGroup only sets
 * accessibilityState, which react-native-web does not map for radios: listed for promotion).
 */
export function OwnerRadioGroup<V extends string>({ options, value, onChange, accessibilityLabel, danger, testID }: { options: OwnerRadioOption<V>[]; value: V | null; onChange: (v: V) => void; accessibilityLabel: string; danger?: boolean; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={{ gap: space[2] }}>
      {options.map((o) => {
        const on = o.value === value;
        const onColor = danger ? palette.danger : palette.teal;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            onPress={() => onChange(o.value)}
            style={{ flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, paddingHorizontal: 14, paddingVertical: space[2], borderRadius: radius.md, backgroundColor: on ? (danger ? palette.dangerTint : palette.tealTint) : palette.ground, borderWidth: 2, borderColor: on ? onColor : "transparent" }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: on ? 6 : 2, borderColor: on ? onColor : palette.muted2, backgroundColor: palette.white }} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="bodyBold">{o.label}</Text>
              {o.hint ? (
                <Text variant="caption" tone="muted">
                  {o.hint}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
