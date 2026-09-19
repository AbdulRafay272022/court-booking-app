import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { BuildingIcon, ChevronRightIcon, WhatsAppIcon } from "@/components/icons";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export default function LoginScreen() {
  const [phoneDigits, setPhoneDigits] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pakistani mobile numbers: 10 digits after +92, e.g. 3004408817.
  const isValid = phoneDigits.length === 10 && phoneDigits.startsWith("3");
  const e164Phone = `+92${phoneDigits}`;

  async function handleContinue() {
    if (!isValid || loading) return;
    setError(null);
    setLoading(true);
    try {
      await api.auth.requestOtp({ phone: e164Phone });
      router.push({ pathname: "/(auth)/otp", params: { phone: e164Phone } });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function handleOwnerTap() {
    Alert.alert(
      "Owner sign-up coming soon",
      "Self-serve venue registration isn't live yet — message us and we'll get your venue set up by hand.",
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="flex-1 px-[26px] pt-8 gap-[34px]">
        <View className="gap-3.5">
          <Text className="font-figtree-extrabold text-player-ink text-[30px] tracking-tight">
            Maidan
          </Text>
          <Text className="font-figtree-medium text-player-ink-muted text-[19px] leading-[27px]">
            Find a court near you and book it in a minute.
          </Text>
        </View>

        <View className="gap-[13px]">
          <Text className="font-figtree-bold text-player-ink-fainter text-[11px] tracking-[1.5px]">
            MOBILE NUMBER
          </Text>
          <View className="flex-row gap-[9px]">
            <View className="min-w-[88px] h-[58px] px-[15px] rounded-2xl bg-player-surface border border-player-border flex-row items-center gap-2">
              <Text className="font-mono-semibold text-player-ink-fainter text-[13px]">PK</Text>
              <Text className="font-mono-semibold text-player-ink text-base">+92</Text>
            </View>
            <View className="flex-1 h-[58px] px-4 rounded-2xl bg-player-surface border-[1.5px] border-player-ink flex-row items-center">
              <TextInput
                value={phoneDigits}
                onChangeText={(v) => setPhoneDigits(digitsOnly(v).slice(0, 10))}
                placeholder="300 4408817"
                placeholderTextColor="#9A9791"
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
                className="font-mono-semibold text-player-ink text-[17px] tracking-[0.3px] flex-1"
              />
            </View>
          </View>
          <View className="flex-row items-center gap-2 pl-0.5">
            <WhatsAppIcon size={16} color="#1F7A52" />
            <Text className="font-figtree-medium text-player-ink-muted text-[13.5px]">
              We'll send your code on WhatsApp
            </Text>
          </View>
          {error ? (
            <Text className="font-figtree-medium text-player-danger text-[13px]">{error}</Text>
          ) : null}
        </View>

        <Pressable
          onPress={handleContinue}
          disabled={!isValid || loading}
          className="h-[58px] rounded-2xl bg-player-accent items-center justify-center active:opacity-90"
          style={{ opacity: !isValid || loading ? 0.5 : 1 }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="font-figtree-bold text-white text-[16.5px]">Continue</Text>
          )}
        </Pressable>

        <View className="flex-row items-center gap-3.5">
          <View className="flex-1 h-px bg-player-border" />
          <Text className="font-figtree-semibold text-player-ink-fainter text-[12.5px]">or</Text>
          <View className="flex-1 h-px bg-player-border" />
        </View>

        <Pressable
          onPress={handleOwnerTap}
          className="bg-player-surface border border-player-border rounded-2xl p-[19px] flex-row items-center gap-[15px]"
        >
          <View className="w-11 h-11 rounded-xl bg-player-teal-soft items-center justify-center">
            <BuildingIcon />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-figtree-bold text-player-ink text-[15px]">I run a venue</Text>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px] leading-[18px]">
              List your courts and manage bookings
            </Text>
          </View>
          <ChevronRightIcon />
        </Pressable>
      </View>

      <View className="px-[26px] pb-[34px]">
        <Text className="font-figtree-medium text-player-ink-fainter text-[12.5px] leading-[18px]">
          By continuing you agree to our{" "}
          <Text className="font-figtree-semibold text-player-ink-muted underline">Terms</Text> and{" "}
          <Text className="font-figtree-semibold text-player-ink-muted underline">Privacy Policy</Text>.
        </Text>
      </View>
    </SafeAreaView>
  );
}
