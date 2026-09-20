import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useAuthStore } from "@/lib/auth-store";
import { BellIcon, SearchIcon } from "@/components/icons";
import { Logo } from "@/components/auth/kit";
import { SportChip } from "../_components";

const SPORTS = ["Padel", "Futsal", "Cricket", "Tennis"];

export default function PlayerHomeScreen() {
  const user = useAuthStore((s) => s.user);
  const initials = (user?.name ?? "?").slice(0, 2).toUpperCase();

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-6 pb-4.5 bg-player-surface gap-4.5">
        <View className="flex-row items-center justify-between">
          <Logo size={36} />
          <View className="flex-row items-center gap-2.5">
            <Pressable
              onPress={() => router.push("/(player)/notifications")}
              accessibilityLabel="Notifications"
              className="w-[38px] h-[38px] rounded-full bg-player-surface-2 items-center justify-center"
            >
              <BellIcon size={18} color="#141A1D" />
            </Pressable>
            <View className="w-[38px] h-[38px] rounded-full bg-player-ink items-center justify-center">
              <Text className="font-figtree-bold text-white text-sm">{initials}</Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => router.push("/(player)/search")}
          className="flex-row items-center gap-2.5 h-[52px] px-4 rounded-[14px] bg-player-surface-2"
        >
          <SearchIcon />
          <Text className="font-figtree-medium text-player-ink-faint text-[14.5px]">
            Find a court to play at{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </Text>
        </Pressable>

        <View className="flex-row flex-wrap gap-2.5">
          {SPORTS.map((sport) => (
            <SportChip
              key={sport}
              label={sport}
              selected={false}
              onPress={() => router.push({ pathname: "/(player)/search", params: { sport: sport.toLowerCase() } })}
            />
          ))}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-5 pb-8 gap-4">
        <Pressable
          onPress={() => router.push("/(player)/search")}
          className="rounded-[18px] p-5 flex-row items-center gap-4"
          style={{ backgroundColor: "#141A1D" }}
        >
          <View className="flex-1 gap-1">
            <Text className="font-figtree-bold text-[11px] tracking-[0.1em]" style={{ color: "#EF5A2C" }}>
              GET STARTED
            </Text>
            <Text className="font-figtree-bold text-white text-[19px] -tracking-[0.2px] leading-[1.25]">
              Browse courts near you
            </Text>
          </View>
          <View className="w-[46px] h-[46px] rounded-full bg-player-accent items-center justify-center">
            <Text className="font-figtree-bold text-white text-lg">→</Text>
          </View>
        </Pressable>

        <Text className="font-figtree-medium text-player-ink-faint text-[13.5px] text-center px-4">
          Live in DHA and Clifton, Karachi. Search by sport, area, and time to see real availability.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
