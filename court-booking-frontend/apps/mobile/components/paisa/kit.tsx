import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { moneyStatusKey, moneyStatusTone, paisaT, type MoneyStatus, type PaisaKey } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { alpha, palette, radius, space } from "@court-booking/ui-tokens";
import { Pill, Text } from "@/components/ui";

import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useOwnerLang } from "@/lib/owner-lang";

/** Ledger v2 Paisa building blocks (mobile). Every label comes from packages/types paisa-text (ru default, en option). */

export type PT = (key: PaisaKey, vars?: Record<string, string | number>) => string;

export function usePT(): PT {
  const lang = useOwnerLang((s) => s.lang);
  return (key, vars) => paisaT(lang, key, vars);
}

export function pkr(n: number): string {
  return `${n < 0 ? "−" : ""}PKR ${formatPKR(Math.abs(Math.round(n)))}`;
}

export function moneyError(e: unknown, t: PT): string {
  if (e instanceof ApiError && (e.code as string) === "OWNER_ONLY") return t("paisa.err.ownerOnly");
  return friendlyErrorMessage(e);
}

export function MoneyStatusPill({ status, t, size = "sm" }: { status: MoneyStatus; t: PT; size?: "sm" | "md" }) {
  return <Pill size={size} tone={moneyStatusTone(status)} label={t(moneyStatusKey(status))} testID={`ms-${status}`} />;
}

/** White rounded card on the ground. */
export function PaisaCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[2] }, style]}>
      {children}
    </View>
  );
}

/** One line of a money card: label left, value right; values never truncate. */
export function Line({ label, value, strong, tone, indent, testID }: { label: string; value: string; strong?: boolean; tone?: "danger" | "open" | "waiting" | "muted"; indent?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space[3], paddingLeft: indent ? space[3] : 0, flexWrap: "wrap" }}>
      <Text variant={strong ? "bodyBold" : indent ? "meta" : "body"} tone={strong ? "primary" : "muted"} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? "bodyStrong" : indent ? "meta" : "bodyBold"} tone={tone ?? (indent ? "muted" : "primary")} align="right" style={{ marginLeft: "auto" }}>
        {value}
      </Text>
    </View>
  );
}

/** Mutually exclusive choice chips (Cash / Transfer, Player / Venue, refund / credit). Text + check, never colour alone. */
export function Choice<V extends string>({ options, value, onChange, testID }: { options: { value: V; label: string; disabled?: boolean }[]; value: V | null; onChange: (v: V) => void; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => !o.disabled && onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: o.disabled }}
            testID={testID ? `${testID}-${o.value}` : undefined}
            style={{
              minHeight: 48,
              justifyContent: "center",
              paddingHorizontal: space[4],
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: on ? palette.night : palette.line,
              backgroundColor: on ? palette.night : palette.white,
              opacity: o.disabled ? 0.45 : 1,
              flexShrink: 1,
            }}
          >
            <Text variant="bodyBold" tone={on ? "onDark" : "primary"}>
              {on ? `✓ ${o.label}` : o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Glass tile on the teal hero (2×2 grid). */
export function GlassTile({ label, value, sub, onPress, testID }: { label: string; value: string; sub?: string; onPress?: () => void; testID?: string }) {
  const body = (
    <View style={{ borderRadius: radius.input, paddingHorizontal: space[3], paddingVertical: 10, backgroundColor: alpha.glassOnTeal, borderWidth: 1, borderColor: alpha.glassOnTealBorder, gap: 2, minHeight: 64 }}>
      <Text variant="caption" weight="bold" tone="heroMuted">
        {label}
      </Text>
      <Text variant="bodyStrong" tone="hero">
        {value}
      </Text>
      {sub ? (
        <Text variant="caption" tone="heroMuted">
          {sub}
        </Text>
      ) : null}
    </View>
  );
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`${label} ${value}`} style={{ flexGrow: 1, flexBasis: "46%" }}>
      {body}
    </Pressable>
  );
}
