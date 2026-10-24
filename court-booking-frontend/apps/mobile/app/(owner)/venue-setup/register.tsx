import { useState } from "react";
import { Text } from "@/components/ui";
import { View } from "react-native";
import { Banner, Screen } from "@/components/ui";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { router } from "expo-router";
import * as Location from "expo-location";

import { useAuthStore } from "@/lib/auth-store";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { AmenityPicker } from "@/components/court-identity-fields";
import { CheckIcon } from "@/components/icons";
import { Chip, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, TextField, WizardSteps } from "./_components";
import { CancellationPolicyFields } from "@/components/court-setup-fields";
import { AMENITY_OPTIONS, CITY_CENTRES, SPORT_OPTIONS, accountNumberError, accountTitleError, bankNameError, type City } from "@court-booking/types";

export default function VenueRegisterScreen() {
  const user = useAuthStore((s) => s.user);
  const store = useVenueSetupStore();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [usingCityCentre, setUsingCityCentre] = useState(false);

  async function handleUseLocation() {
    setLocationError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location permission denied — tap \"Use city centre for now\" below and refine the pin from Venue Settings once you're approved.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      store.setField("latitude", position.coords.latitude);
      store.setField("longitude", position.coords.longitude);
      setUsingCityCentre(false);
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
      setLocationError("Couldn't get your location — tap \"Use city centre for now\" below and refine the pin from Venue Settings once you're approved.");
    } finally {
      setLocating(false);
    }
  }

  // QA signup-venue round item 2 -- mirror of the web fix. Mobile's real-device flow uses
  // expo-location + reverse-geocode; a denied permission previously left the owner with the
  // same dead-end "Next" gate. City-centre fallback matches web exactly (same CITY_CENTRES).
  function handleUseCityCentre() {
    setLocationError(null);
    const cityKey = (user?.city as City | undefined) ?? "karachi";
    const centre = CITY_CENTRES[cityKey] ?? CITY_CENTRES.karachi;
    store.setField("latitude", centre.latitude);
    store.setField("longitude", centre.longitude);
    setUsingCityCentre(true);
  }

  // Bank details are optional -- but if any bank field is filled, ALL required bank fields
  // must be valid (matches BankDetailsIn's server-side check; see QA signup-venue round item 5).
  const bankTouched = !!(store.bankName || store.accountTitle || store.accountNumber);
  const bankErrors = bankTouched
    ? {
        bank: bankNameError(store.bankName),
        title: accountTitleError(store.accountTitle),
        number: accountNumberError(store.accountNumber),
      }
    : { bank: null, title: null, number: null };
  const bankValid = !bankTouched || (!bankErrors.bank && !bankErrors.title && !bankErrors.number);

  const isValid =
    store.name.trim().length > 0 &&
    store.address.trim().length > 0 &&
    store.area.trim().length > 0 &&
    store.sports.length > 0 &&
    store.latitude !== null &&
    store.longitude !== null &&
    bankValid;

  function handleNext() {
    if (!isValid) {
      return;
    }
    router.push("/(owner)/venue-setup/courts");
  }

  function handleSaveAndExit() {
    // Draft is already persisted on every keystroke via the zustand persist middleware.
    router.replace("/(owner)/(tabs)/today");
  }

  return (
    <Screen keyboard testID="wizard-register">
      <WizardSteps current={0} />
        <View className="gap-1.5">
          <Text variant="h2">
            Tell us about your venue
          </Text>
          <Text variant="body" tone="muted">
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
            <Text variant="meta" tone="muted" weight="bold">Mobile number</Text>
            <View style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: radius.input, backgroundColor: palette.ground, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text variant="body" className="flex-1">{user?.phone}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: palette.openTint }}>
                <CheckIcon size={11} color={palette.open} strokeWidth={3} />
                <Text variant="caption" tone="open" weight="bold">VERIFIED</Text>
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
            <Text variant="meta" tone="muted" weight="bold">Sports you offer</Text>
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

          <AmenityPicker value={store.amenities} onToggle={store.toggleAmenity} options={AMENITY_OPTIONS} />

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
            <Text variant="meta" tone="muted" weight="bold">
              Pin your location so players can find the gate
            </Text>
            <SecondaryButton
              label={locating ? "Locating…" : store.latitude && !usingCityCentre ? "Update my location" : "Use my current location"}
              onPress={handleUseLocation}
            />
            {store.latitude !== null && store.longitude !== null ? (
              <Text
                variant="caption"
                tone={usingCityCentre ? "waiting" : "open"}
              >
                Pinned · {store.latitude.toFixed(5)}, {store.longitude.toFixed(5)}
                {usingCityCentre ? " (city centre — refine later)" : ""}
              </Text>
            ) : null}
            {locationError ? (
              <Text variant="caption" tone="waiting">{locationError}</Text>
            ) : null}
            {store.latitude === null || locationError ? (
              <Text
                onPress={handleUseCityCentre}
                variant="meta" weight="bold" tone="link"
                style={{ textDecorationLine: "underline", minHeight: 44, paddingVertical: 12 }}
              >
                Use city centre for now — refine from Venue Settings
              </Text>
            ) : null}
          </View>
        </SectionCard>

        <SectionCard>
          <SectionLabel>Where players send payment</SectionLabel>
          <Text variant="caption" tone="subtle">
            Players pay you directly. Khelo never holds your money — we only check that the
            screenshot matches what's owed. You can add this later if you'd rather skip it for now.
          </Text>
          <TextField
            label="Bank name"
            value={store.bankName}
            onChangeText={(v) => store.setField("bankName", v)}
            placeholder="Meezan Bank"
            error={bankTouched && store.bankName ? bankErrors.bank : null}
          />
          <TextField
            label="Account title"
            value={store.accountTitle}
            onChangeText={(v) => store.setField("accountTitle", v)}
            placeholder="Padel Republic"
            error={bankTouched && store.accountTitle ? bankErrors.title : null}
          />
          <TextField
            label="Account number"
            value={store.accountNumber}
            onChangeText={(v) => store.setField("accountNumber", v)}
            placeholder="03445551234 or 12345678901234"
            keyboardType="number-pad"
            mono
            error={bankTouched && store.accountNumber ? bankErrors.number : null}
          />
        </SectionCard>

        <CancellationPolicyFields
          allowed={store.cancellationAllowed}
          cutoffHours={store.cancellationCutoffHours}
          onAllowedChange={(v) => store.setField("cancellationAllowed", v)}
          onCutoffChange={(v) => store.setField("cancellationCutoffHours", v)}
        />

        <View style={{ backgroundColor: palette.waitingTint, borderRadius: radius.tile, padding: space[5], gap: 6 }}>
          <Text variant="body" tone="waiting" weight="black">
            Free while we're building
          </Text>
          <Text variant="meta" tone="waiting">
            Early venues in DHA and Clifton keep the Pro plan free permanently. No card, no
            contract.
          </Text>
        </View>

        <Text variant="meta" tone="subtle">
          Everything here can be edited after you go live.
        </Text>
        {!isValid ? (
          <Banner
            tone="waiting"
            testID="wizard-next-reason"
            body={`Aage jaane ke liye baqi: ${[
              !store.name.trim() ? "venue ka naam" : null,
              !store.address.trim() ? "address" : null,
              !store.area.trim() ? "area" : null,
              store.sports.length === 0 ? "kam se kam ek khel" : null,
              store.latitude === null || store.longitude === null ? "location pin" : null,
              !bankValid ? "bank ki teeno details (ya teeno khaali)" : null,
            ]
              .filter(Boolean)
              .join(", ")}.`}
          />
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
          <SecondaryButton label="Save and finish later" onPress={handleSaveAndExit} />
          <PrimaryButton label="Next: courts & pricing" onPress={handleNext} disabled={!isValid} />
        </View>
        <Text variant="caption" tone="muted" align="center">
          Draft khud save hota hai
        </Text>
    </Screen>
  );
}
