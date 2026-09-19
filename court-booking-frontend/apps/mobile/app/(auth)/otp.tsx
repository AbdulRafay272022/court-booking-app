import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { getDeviceName, getOrCreateDeviceId, getPlatform } from "@/lib/device";
import { ChevronLeftIcon, WhatsAppIcon, CheckIcon } from "@/components/icons";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function OtpScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (code.length === CODE_LENGTH) {
      void handleVerify(code);
    }
  }, [code]);

  async function handleVerify(otp: string) {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const deviceId = await getOrCreateDeviceId();
      const response = await api.auth.verifyOtp({
        phone,
        otp,
        device_id: deviceId,
        device_name: getDeviceName(),
        platform: getPlatform(),
      });
      await useAuthStore.getState().signIn(response.token, response.user);
      // Stack.Protected in the root layout reacts to status/role and swaps the
      // visible group automatically — nothing to navigate to here.
    } catch (e) {
      setError(friendlyErrorMessage(e));
      setCode("");
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendSeconds > 0) return;
    setError(null);
    try {
      await api.auth.requestOtp({ phone });
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setError(friendlyErrorMessage(e));
    }
  }

  function handleSmsFallback() {
    Alert.alert(
      "WhatsApp only, for now",
      "We can only deliver the code over WhatsApp at the moment — check the chat with Maidan there.",
    );
  }

  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => code[i]);
  const activeIndex = Math.min(code.length, CODE_LENGTH - 1);

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-[26px]">
        <Pressable
          onPress={() => router.back()}
          className="w-11 h-11 rounded-xl bg-player-surface border border-player-border-light items-center justify-center"
        >
          <ChevronLeftIcon />
        </Pressable>
      </View>

      <View className="flex-1 px-[26px] pt-[30px] gap-[30px]">
        <View className="gap-[11px]">
          <Text className="font-figtree-extrabold text-player-ink text-[28px] tracking-tight">
            Enter your code
          </Text>
          <Text className="font-figtree-medium text-player-ink-muted text-base leading-6">
            Six digits, sent to{" "}
            <Text className="font-mono-semibold text-player-ink">{phone}</Text>
          </Text>
        </View>

        <Pressable onPress={() => inputRef.current?.focus()} className="flex-row gap-[9px]">
          {boxes.map((digit, i) => {
            const isActive = i === activeIndex && !digit;
            return (
              <View
                key={i}
                className="flex-1 h-16 rounded-[13px] bg-player-surface items-center justify-center"
                style={{
                  borderWidth: isActive ? 1.5 : 1,
                  borderColor: isActive ? "#EF5A2C" : "#E5DED8",
                }}
              >
                {digit ? (
                  <Text className="font-mono-semibold text-player-ink text-[25px]">{digit}</Text>
                ) : isActive ? (
                  <View className="w-0.5 h-[26px] bg-player-accent" />
                ) : null}
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, CODE_LENGTH))}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          autoFocus
          style={{ position: "absolute", opacity: 0, height: 0, width: 0 }}
        />

        <View className="bg-player-success-soft border border-player-success-soft-border rounded-2xl p-[15px] flex-row items-center gap-3">
          <View className="w-9 h-9 rounded-full bg-player-success items-center justify-center">
            <CheckIcon size={18} />
          </View>
          <Text className="font-figtree-semibold text-player-success-dark text-[13.5px] leading-[19px] flex-1">
            Check WhatsApp — the code is in your chat with Maidan
          </Text>
        </View>

        {error ? (
          <Text className="font-figtree-medium text-player-danger text-[13px] -mt-4">{error}</Text>
        ) : null}

        <Pressable
          onPress={() => handleVerify(code)}
          disabled={code.length !== CODE_LENGTH || loading}
          className="h-[58px] rounded-2xl bg-player-accent items-center justify-center"
          style={{ opacity: code.length !== CODE_LENGTH || loading ? 0.5 : 1 }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="font-figtree-bold text-white text-[16.5px]">Verify</Text>
          )}
        </Pressable>

        <View className="items-center gap-4">
          {resendSeconds > 0 ? (
            <Text className="font-figtree-medium text-player-ink-fainter text-sm">
              Resend in{" "}
              <Text className="font-mono-semibold text-player-ink-muted">
                0:{resendSeconds.toString().padStart(2, "0")}
              </Text>
            </Text>
          ) : (
            <Pressable onPress={handleResend}>
              <Text className="font-figtree-bold text-player-accent text-sm">Resend code</Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleSmsFallback}
            className="min-h-11 px-[18px] flex-row items-center gap-2 rounded-full border border-player-border"
          >
            <Text className="font-figtree-semibold text-player-ink-muted text-sm">
              Send by SMS instead
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="px-[26px] pb-[30px] items-center">
        <Pressable onPress={() => router.back()} className="min-h-11 px-4 flex-row items-center gap-1.5">
          <Text className="font-figtree-medium text-player-ink-fainter text-[13.5px]">
            Wrong number?
          </Text>
          <Text className="font-figtree-bold text-player-ink-muted text-[13.5px] underline">
            Change it
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
