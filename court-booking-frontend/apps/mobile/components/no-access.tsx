import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { BanIcon } from "./icons";

/** The ONE "you can't use this" state for staff (before: a generic "Something went wrong", an editable form that 403s on
 * Save, or inline red text, depending on the screen). Shown when GET /owners/me/permissions says the key is missing, e.g.
 * a deep link or an old notification opening a screen the tab bar and "Aur" no longer offer. */
export function NoAccess({ what, withBack = true }: { what: string; withBack?: boolean }) {
  return (
    <SafeAreaView testID="no-access" className="flex-1 bg-owner-bg" edges={withBack ? ["top", "bottom"] : ["top"]}>
      <View className="flex-1 items-center justify-center gap-3 px-8" accessibilityRole="alert">
        <View className="w-14 h-14 rounded-full items-center justify-center bg-owner-surface border border-owner-border">
          <BanIcon size={24} color="#5B7079" />
        </View>
        <Text className="font-plex-bold text-owner-ink text-base text-center">{what} ki ijazat nahi</Text>
        <Text className="font-plex-medium text-owner-ink-faint text-sm text-center leading-[1.45]">
          Venue owner se yeh permission dene ko kahein. Mil jaye to yeh hissa yahan khud aa jayega.
        </Text>
        {withBack ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(owner)"))}
            accessibilityRole="button"
            className="mt-2 px-6 rounded-xl border border-owner-border items-center justify-center active:opacity-80"
            style={{ minHeight: 48 }}
          >
            <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">Wapas</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
