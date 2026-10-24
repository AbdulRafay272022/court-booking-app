import { useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { fontFamily, palette, radius, shadow, size, space } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useCopy, useFontScale, useRoleTheme } from "./theme";
import { haptic } from "./haptics";

/* ---------------- SegmentedToggle ---------------- */

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  /** Optional count shown after the label ("Aane wali · 3"). Real counts only. */
  count?: number;
}

export interface SegmentedToggleProps<V extends string> {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Spoken group name ("Dikhao", "Language"). */
  accessibilityLabel: string;
  /** "light" = white pill on ground track (default); "dark" = on a night/teal hero; "role" = active segment uses the role primary. */
  tone?: "light" | "dark" | "role";
  testID?: string;
}

/** List/Naqsha, Player/Owner, Aane wali/Purani, Roman Urdu/English. Each segment >= 44pt; active is bold + raised (not colour-only). */
export function SegmentedToggle<V extends string>({ options, value, onChange, accessibilityLabel, tone = "light", testID }: SegmentedToggleProps<V>) {
  const t = useRoleTheme();
  const dark = tone === "dark";
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", padding: 4, gap: 4, borderRadius: radius.md, backgroundColor: dark ? palette.night : palette.mist }}
    >
      {options.map((o) => {
        const on = o.value === value;
        const bg = on ? (tone === "role" ? t.primary.bg : palette.white) : "transparent";
        const fg = on ? (tone === "role" ? t.primary.fg : palette.night) : dark ? palette.white : palette.muted;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.count !== undefined ? `${o.label}, ${o.count}` : o.label}
            onPress={() => {
              haptic("selection");
              onChange(o.value);
            }}
            style={{ flex: 1, minHeight: size.tap, borderRadius: radius.sm, backgroundColor: bg, alignItems: "center", justifyContent: "center", paddingHorizontal: space[3], boxShadow: on && tone !== "role" ? shadow.segment : undefined }}
          >
            <Text variant="bodyBold" weight={on ? "black" : "bold"} color={fg} align="center">
              {o.label}
              {o.count !== undefined ? ` · ${o.count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------- Checkbox / Radio / Switch ---------------- */

export interface CheckboxProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** The whole label row is the 44pt target. Pass rich content (links) as children instead of `label` if needed. */
  label?: string;
  children?: ReactNode;
  disabled?: boolean;
  testID?: string;
}

export function Checkbox({ checked, onChange, label, children, disabled, testID }: CheckboxProps) {
  const t = useRoleTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptic("selection");
        onChange(!checked);
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: radius.xs,
          backgroundColor: checked ? t.control.onBg : palette.white,
          borderWidth: checked ? 0 : 2,
          borderColor: palette.muted2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Check size={16} color={t.control.onFg} strokeWidth={3.2} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children ?? <Text variant="body">{label}</Text>}</View>
    </Pressable>
  );
}

export interface RadioOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

/** Reason radios (OSheets reject sheet). `danger` colours the selected dot red (reject reasons). */
export function RadioGroup<V extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  danger,
  testID,
}: {
  options: RadioOption<V>[];
  value: V | null;
  onChange: (v: V) => void;
  accessibilityLabel: string;
  danger?: boolean;
  testID?: string;
}) {
  const t = useRoleTheme();
  const onColor = danger ? palette.danger : t.control.onBg;
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={{ gap: space[2] }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            onPress={() => {
              haptic("selection");
              onChange(o.value);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space[3],
              minHeight: 52,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              backgroundColor: on ? (danger ? palette.dangerTint : t.selected.bg) : palette.ground,
              borderWidth: 2,
              borderColor: on ? (danger ? palette.danger : t.selected.border) : "transparent",
            }}
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

export interface SwitchProps {
  value: boolean;
  onChange: (v: boolean) => void;
  /** REQUIRED: the setting name, spoken with its state. */
  label: string;
  /** Visible label row (default true). false = only the 52x32 switch (label still spoken). */
  showLabel?: boolean;
  hint?: string;
  disabled?: boolean;
  testID?: string;
}

/** OGrowthTeam permission switch: 52x32 track (role on colour), white knob; whole row is the 44pt target. No animation. */
export function Switch({ value, onChange, label, showLabel = true, hint, disabled, testID }: SwitchProps) {
  const t = useRoleTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => {
        haptic("selection");
        onChange(!value);
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, opacity: disabled ? 0.5 : 1 }}
    >
      {showLabel ? (
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyBold">{label}</Text>
          {hint ? (
            <Text variant="caption" tone="muted">
              {hint}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: value ? t.switchOn : palette.lineStrong }}>
        <View style={{ position: "absolute", top: 3, left: value ? 23 : 3, width: 26, height: 26, borderRadius: 13, backgroundColor: palette.white, boxShadow: shadow.knob }} />
      </View>
    </Pressable>
  );
}

/* ---------------- OTP boxes ---------------- */

export interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  /** Error state: red borders (show the message in a <Banner tone="waiting|danger"> under it). */
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** 6 boxes backed by ONE hidden TextInput (paste + SMS autofill work; e2e types into it with keyboard.type). */
export function OtpInput({ value, onChange, length = 6, error, disabled, autoFocus, accessibilityLabel, testID }: OtpInputProps) {
  const t = useRoleTheme();
  const copy = useCopy();
  const scale = useFontScale();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, "").slice(0, length);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false} style={{ position: "relative" }}>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        {Array.from({ length }, (_, i) => {
          const filled = i < digits.length;
          const active = focused && i === Math.min(digits.length, length - 1);
          const border = error ? palette.danger : active ? t.focusBorder : filled ? palette.night : palette.lineStrong;
          return (
            <View
              key={i}
              style={{ flex: 1, height: 58 * Math.min(scale, 1.4), borderRadius: radius.md, backgroundColor: palette.white, borderWidth: active || error ? 2 : 1.5, borderColor: border, alignItems: "center", justifyContent: "center" }}
            >
              <Text variant="h3">{digits[i] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        testID={testID ?? "otp-input"}
        value={digits}
        onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
        maxLength={length}
        editable={!disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={accessibilityLabel ?? copy(`${length} hindson ka code`, `${length}-digit code`)}
        caretHidden
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, fontFamily: fontFamily.mobile.body, color: palette.night }}
      />
    </Pressable>
  );
}

/* ---------------- CopyField ---------------- */

export interface CopyFieldProps {
  label: string;
  /** The exact text copied (account number / IBAN). Shown wrapped, never truncated. */
  value: string;
  /** Spoken name for the button ("Account number copy karein"). */
  copyLabel?: string;
  onCopied?: () => void;
  testID?: string;
}

/** Pay board bank row: label + value + "Copy" (night) that turns into "Copy ho gaya" (teal) with a success haptic. */
export function CopyField({ label, value, copyLabel, onCopied, testID }: CopyFieldProps) {
  const copy = useCopy();
  const [done, setDone] = useState(false);
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.ground, borderRadius: radius.input, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 140, gap: 2 }}>
        <Text variant="caption" weight="bold" tone="subtle">
          {label}
        </Text>
        <Text variant="cta" selectable>
          {value}
        </Text>
      </View>
      <Pressable
        testID={testID ? `${testID}-copy` : undefined}
        accessibilityRole="button"
        accessibilityLabel={done ? copy(`${label} copy ho gaya`, `${label} copied`) : copyLabel ?? copy(`${label} copy karein`, `Copy ${label}`)}
        onPress={async () => {
          try {
            await Clipboard.setStringAsync(value);
            haptic("success");
            setDone(true);
            onCopied?.();
            setTimeout(() => setDone(false), 2500);
          } catch {
            haptic("error");
          }
        }}
        style={{ minHeight: size.tap, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: done ? palette.teal : palette.night, flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        {done ? <Check size={16} color={palette.white} strokeWidth={2.8} /> : <Copy size={16} color={palette.white} />}
        <Text variant="bodyBold" tone="onDark">
          {done ? copy("Copy ho gaya", "Copied") : copy("Copy", "Copy")}
        </Text>
      </Pressable>
    </View>
  );
}
