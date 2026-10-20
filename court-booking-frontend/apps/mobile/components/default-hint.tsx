import { Pressable, Text, View } from "react-native";
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
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1" testID={id}>
      <Text className="font-plex-medium text-owner-ink-faint text-[12px]">{text ?? defaultHintText(settingKey, "ru")}</Text>
      {running ? (
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: "#EEF6F7" }}>
          <Text testID={`${id}-running`} className="font-plex-semibold text-owner-accent text-[11px]">
            {copy.running}
          </Text>
        </View>
      ) : null}
      {!running && canReset && onReset ? (
        <Pressable
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel={copy.reset}
          testID={`${id}-reset`}
          hitSlop={8}
          style={{ minHeight: 28, justifyContent: "center" }}
        >
          <Text className="font-plex-semibold text-owner-accent text-[12px] underline">{copy.reset}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
