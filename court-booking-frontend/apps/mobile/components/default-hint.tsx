import { Pressable, View } from "react-native";
import { palette, radius, size, space } from "@court-booking/ui-tokens";
import { Text } from "@/components/ui";
import {
  DEFAULT_HINT_COPY,
  defaultHintState,
  defaultHintText,
  type SettingDefaultKey,
  type SettingDefaultValue,
} from "@court-booking/types";

/**
 * Round 2 Stage 2 (spec A.2): the small line under every owner setting that has a default (Venue Settings and the
 * wizard). Always "Default: 15 minute"; plus "Abhi default chal raha hai" when nothing is set (or the value equals the
 * default), or a "Default par wapas" link when the owner's value differs. Text comes from the shared table
 * (packages/types settings-defaults.ts) so web and mobile say the same thing.
 *
 * Pass `settingKey` + `value` to let the shared table decide, or `text` / `isDefault` / `onReset` to override (e.g. the
 * advance line, whose wording depends on the split_payments flag).
 */
export function DefaultHint({
  settingKey,
  value,
  text,
  isDefault,
  onReset,
  testID,
}: {
  settingKey: SettingDefaultKey;
  /** The current value; null/undefined = nothing set. */
  value?: SettingDefaultValue;
  text?: string;
  isDefault?: boolean;
  /** Puts the default back. The link only shows when the value differs from the default. */
  onReset?: () => void;
  testID?: string;
}) {
  const state = defaultHintState(value, settingKey);
  const running = isDefault ?? state.isDefault;
  const canReset = isDefault === undefined ? state.canReset : !isDefault;
  const copy = DEFAULT_HINT_COPY.ru;
  const id = testID ?? `default-${settingKey}`;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[2], rowGap: space[1] }} testID={id}>
      <Text variant="caption" tone="muted">
        {text ?? defaultHintText(settingKey, "ru")}
      </Text>
      {running ? (
        <View style={{ borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 2, backgroundColor: palette.tealTint }}>
          <Text testID={`${id}-running`} variant="caption" weight="bold" tone="info">
            {copy.running}
          </Text>
        </View>
      ) : null}
      {!running && canReset && onReset ? (
        <Pressable onPress={onReset} accessibilityRole="button" accessibilityLabel={copy.reset} testID={`${id}-reset`} style={{ minHeight: size.tap, justifyContent: "center", paddingHorizontal: space[1] }}>
          <Text variant="label" tone="link" style={{ textDecorationLine: "underline" }}>
            {copy.reset}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
