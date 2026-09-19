import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Location from "expo-location";

import { useAuthStore } from "@/lib/auth-store";
import { SPORT_OPTIONS, useVenueSetupStore } from "@/lib/venue-setup-store";
import { CheckIcon } from "@/components/icons";
import { Chip, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, TextField } from "./_components";

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Your venue", "Courts & pricing", "We review it"];
  return (
    <View className="flex-row items-center gap-2 px-6 pt-2 pb-4">
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const done = stepNum < current;
        const active = stepNum === current;
        return (
          <View key={label} className="flex-row items-center gap-2">
            <View
              className="w-[22px] h-[22px] rounded-full items-center justify-center"
              style={{ backgroundColor: done || active ? "#0E6274" : "#F4F6F7", borderWidth: done || active ? 0 : 1, borderColor: "#DCE3E6" }}
            >
              {done ? (
                <CheckIcon size={11} strokeWidth={3} />
              ) : (
                <Text className="font-plex-semibold text-[11px]" style={{ color: active ? "#FFFFFF" : "#8399A1" }}>
                  {stepNum}
                </Text>
              )}
            </View>
            <Text
              className="font-plex-medium text-[12.5px]"
              style={{ color: active ? "#101C21" : "#8399A1", fontWeight: active ? "600" : "500" }}
            >
              {label}
            </Text>
            {i < steps.length - 1 ? <View className="w-4 h-px bg-owner-border ml-1" /> : null}
          </View>
        );
      })}
    </View>
  );
}

export default function VenueRegisterScreen() {
  const user = useAuthStore((s) => s.user);
  const store = useVenueSetupStore();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  async function handleUseLocation() {
    setLocationError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location permission denied — you can still enter the address manually below.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      store.setField("latitude", position.coords.latitude);
      store.setField("longitude", position.coords.longitude);
      const places = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const place = places[0];
      if (place) {
        const addressGuess = [place.street, place.district ?? place.subregion].filter(Boolean).join(", ");
        if (addressGuess && !store.address) store.setField("address", addressGuess);
        if (place.district && !store.area) store.setField("area", place.district);
      }
    } catch {
      setLocationError("Couldn't get your location — you can still enter the address manually below.");
    } finally {
      setLocating(false);
    }
  }

  const isValid =
    store.name.trim().length > 0 &&
    store.address.trim().length > 0 &&
    store.area.trim().length > 0 &&
    store.sports.length > 0 &&
    store.latitude !== null &&
    store.longitude !== null;

  function handleNext() {
    if (!isValid) {
      Alert.alert(
        "A few things are missing",
        "Venue name, address, area, at least one sport, and a location pin are needed before continuing.",
      );
      return;
    }
    router.push("/(owner)/venue-setup/courts");
  }

  function handleSaveAndExit() {
    // Draft is already persisted on every keystroke via the zustand persist middleware.
    router.replace("/(owner)/today");
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <Stepper current={1} />
      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-8 gap-5">
        <View className="gap-1.5">
          <Text className="font-plex-bold text-owner-ink text-[26px] tracking-tight">
            Tell us about your venue
          </Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[15px]">
            This is what players will see. You can change any of it later.
          </Text>
        </View>

        <SectionCard>
          <SectionLabel>The basics</SectionLabel>

          <TextField
            label="Venue name"
            value={store.name}
            onChangeText={(v) => store.setField("name", v)}
            placeholder="Padel Republic"
          />

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">Mobile number</Text>
            <View className="h-12 px-3.5 rounded-[9px] bg-owner-bg border border-owner-border flex-row items-center gap-2.5">
              <Text className="font-mono-medium text-owner-ink text-[15px] flex-1">{user?.phone}</Text>
              <View className="flex-row items-center gap-1 px-2 py-0.5 rounded bg-owner-success-soft">
                <CheckIcon size={11} color="#1F7A52" strokeWidth={3} />
                <Text className="font-plex-semibold text-owner-success-dark text-[11px]">VERIFIED</Text>
              </View>
            </View>
          </View>

          <TextField
            label="WhatsApp for bookings (if different)"
            value={store.whatsapp}
            onChangeText={(v) => store.setField("whatsapp", v)}
            placeholder="Same as above"
            keyboardType="phone-pad"
            mono
          />

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">Sports you offer</Text>
            <View className="flex-row flex-wrap gap-2">
              {SPORT_OPTIONS.map((sport) => (
                <Chip
                  key={sport}
                  label={sport}
                  selected={store.sports.includes(sport)}
                  onPress={() => store.toggleSport(sport)}
                />
              ))}
            </View>
          </View>

          <TextField
            label="Street address"
            value={store.address}
            onChangeText={(v) => store.setField("address", v)}
            placeholder="Khayaban-e-Shahbaz, DHA Phase 6"
          />

          <TextField
            label="Area"
            value={store.area}
            onChangeText={(v) => store.setField("area", v)}
            placeholder="DHA Phase 6"
          />

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">
              Pin your location so players can find the gate
            </Text>
            <SecondaryButton
              label={locating ? "Locating…" : store.latitude ? "Update my location" : "Use my current location"}
              onPress={handleUseLocation}
            />
            {store.latitude !== null && store.longitude !== null ? (
              <Text className="font-mono-medium text-owner-success-dark text-[12.5px]">
                Pinned · {store.latitude.toFixed(5)}, {store.longitude.toFixed(5)}
              </Text>
            ) : null}
            {locationError ? (
              <Text className="font-plex-medium text-owner-warn text-[12.5px]">{locationError}</Text>
            ) : null}
          </View>
        </SectionCard>

        <SectionCard>
          <SectionLabel>Where players send payment</SectionLabel>
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px] leading-[18px]">
            Players pay you directly. Maidan never holds your money — we only check that the
            screenshot matches what's owed. You can add this later if you'd rather skip it for now.
          </Text>
          <TextField
            label="Bank name"
            value={store.bankName}
            onChangeText={(v) => store.setField("bankName", v)}
            placeholder="Meezan Bank"
          />
          <TextField
            label="Account title"
            value={store.accountTitle}
            onChangeText={(v) => store.setField("accountTitle", v)}
            placeholder="Padel Republic"
          />
          <TextField
            label="Account number"
            value={store.accountNumber}
            onChangeText={(v) => store.setField("accountNumber", v)}
            placeholder="PK00 MEZN 0000 0000 0000"
            mono
          />
        </SectionCard>

        <View className="bg-owner-warn-soft border border-owner-warn-soft-border rounded-2xl p-5 gap-1.5">
          <Text className="font-plex-bold text-owner-warn-dark text-[14.5px]">
            Free while we're building
          </Text>
          <Text className="font-plex-medium text-owner-warn text-[13px] leading-[19px]">
            Early venues in DHA and Clifton keep the Pro plan free permanently. No card, no
            contract.
          </Text>
        </View>

        <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
          Everything here can be edited after you go live.
        </Text>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <SecondaryButton label="Save and finish later" onPress={handleSaveAndExit} />
          </View>
          <View className="flex-1">
            <PrimaryButton label="Next: courts & pricing" onPress={handleNext} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
