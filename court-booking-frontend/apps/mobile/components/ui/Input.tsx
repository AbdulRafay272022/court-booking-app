import { forwardRef, useId, useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import { fontFamily, palette, radius, size, space, type as typeScale } from "@court-booking/ui-tokens";
import { Text } from "./Text";
import { useCopy, useFontScale, useRoleTheme } from "./theme";

export interface InputProps extends Omit<TextInputProps, "style" | "placeholderTextColor"> {
  /** ALWAYS visible above the field (never placeholder-only). */
  label: string;
  /** Helper line under the field. */
  help?: string;
  /** Error line (replaces help, red border, announced). */
  error?: string | null;
  /** Fixed prefix box, e.g. "+92". */
  prefix?: string;
  /** Trailing element (e.g. "Dikhao" toggle). Use `secureToggle` for passwords. */
  trailing?: ReactNode;
  /** Password field with a "Dikhao / Chhupao" toggle. */
  secureToggle?: boolean;
  /** Multi-line text area. */
  multiline?: boolean;
  testID?: string;
}

/**
 * Text field (PAuth board): label always visible, 56pt, 1.5px line border, role focus border (2px), error text below.
 * Keyboard-aware: inside a <Screen keyboard> or a Sheet the content moves above the keyboard; this component only sets
 * sensible returnKeyType / autoCorrect defaults.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, help, error, prefix, trailing, secureToggle, multiline, testID, onFocus, onBlur, secureTextEntry, ...rest },
  ref,
) {
  const t = useRoleTheme();
  const copy = useCopy();
  const scale = useFontScale();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const borderColor = error ? palette.danger : focused ? t.focusBorder : palette.lineStrong;
  const body = typeScale.bodyL;
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="label" nativeID={`${id}-label`}>
        {label}
      </Text>
      <View
        style={{
          minHeight: multiline ? 112 : size.input,
          borderRadius: radius.input,
          backgroundColor: palette.white,
          borderWidth: focused || error ? 2 : 1.5,
          borderColor,
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          overflow: "hidden",
        }}
      >
        {prefix ? (
          <View style={{ alignSelf: "stretch", justifyContent: "center", paddingHorizontal: space[4], borderRightWidth: 1.5, borderRightColor: palette.line }}>
            <Text variant="bodyStrong">{prefix}</Text>
          </View>
        ) : null}
        <TextInput
          ref={ref}
          testID={testID}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${id}-label`}
          aria-invalid={!!error}
          placeholderTextColor={palette.muted2}
          multiline={multiline}
          secureTextEntry={secureToggle ? !shown : secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: multiline ? 108 : size.input - 4,
            paddingHorizontal: space[4],
            paddingVertical: multiline ? space[3] : 0,
            fontFamily: fontFamily.mobile.body,
            fontSize: body.size * scale,
            color: palette.night,
            textAlignVertical: multiline ? "top" : "center",
            outlineStyle: "none",
          } as never}
          {...rest}
        />
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? copy("Password chhupao", "Hide password") : copy("Password dikhao", "Show password")}
            onPress={() => setShown((s) => !s)}
            style={{ minHeight: size.tap, minWidth: size.tap, paddingHorizontal: space[4], alignItems: "center", justifyContent: "center" }}
          >
            <Text variant="bodyBold">{shown ? copy("Chhupao", "Hide") : copy("Dikhao", "Show")}</Text>
          </Pressable>
        ) : (
          trailing
        )}
      </View>
      {error ? (
        <Text variant="caption" weight="bold" tone="danger" accessibilityLiveRegion="polite" role="alert">
          {error}
        </Text>
      ) : help ? (
        <Text variant="caption" tone="muted">
          {help}
        </Text>
      ) : null}
    </View>
  );
});
