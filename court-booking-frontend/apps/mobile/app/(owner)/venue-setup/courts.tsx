import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { isStaleVenueDraftError } from "@court-booking/api-client";
import { buildPricingRules, buildSchedules, courtSetupProblem } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { SPORT_OPTIONS, useVenueSetupStore } from "@/lib/venue-setup-store";
import { CourtSetupFields } from "@/components/court-setup-fields";
import { Chip, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, TextField } from "./_components";

export default function VenueCourtsScreen() {
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);
  // Section 31 Part 2: the saved draft pointed at a venue/court that no longer exists (or isn't
  // ours). Shown as a recovery panel with a next step, not as a bare error alert.
  const [staleDraft, setStaleDraft] = useState(false);

  // Each court is valid on its own: a name, usable hours (closing at/before opening, e.g. 06:00 -> 02:00, used to reach the
  // API, 500, and surface as a "network" error), and a price.
  const courtProblems = store.courts.map((c) => (c.name.trim() ? courtSetupProblem(c) : "Give this court a name."));
  const firstProblem = courtProblems.find((p) => p !== null) ?? null;
  const isValid = store.courts.length > 0 && firstProblem === null;

  async function handleSubmit() {
    if (!isValid) {
      Alert.alert("Almost there", firstProblem ?? "Add at least one court and a price for it before sending for review.");
      return;
    }
    setSubmitting(true);
    setStaleDraft(false);
    // Ids read from the saved draft (as opposed to created during this run) are the only ones
    // whose failure can mean "stale draft" -- see isStaleVenueDraftError.
    const draftHadVenue = !!store.createdVenueId;
    const draftCourtIds = { ...store.createdCourtIds };
    try {
      let venueId = store.createdVenueId;
      if (!venueId) {
        const { venue } = await api.venues.create({
          name: store.name,
          address: store.address,
          city: store.city,
          area: store.area || undefined,
          latitude: store.latitude!,
          longitude: store.longitude!,
          whatsapp: store.whatsapp || undefined,
          sports: store.sports,
          // one cancellation policy for the whole venue (Section 32 Part 4)
          cancellation_allowed: store.cancellationAllowed,
          cancellation_cutoff_hours:
            store.cancellationAllowed && store.cancellationCutoffHours.trim() ? Number(store.cancellationCutoffHours) : null,
          bank_details:
            store.bankName && store.accountTitle && store.accountNumber
              ? { bank: store.bankName, account_title: store.accountTitle, account_number: store.accountNumber }
              : undefined,
        });
        venueId = venue.id;
        store.setField("createdVenueId", venueId);
      }

      // Resumable: courtId is reused from a prior attempt when we have one (POST /courts
      // always inserts, so re-running it for an already-created court would duplicate the
      // row) -- setSchedule/setPricing are safe to re-run unconditionally either way (the
      // backend replaces, not appends), so a retry that's already fully done just redoes
      // those two harmlessly and reaches the end.
      for (let i = 0; i < store.courts.length; i++) {
        const court = store.courts[i];
        let courtId = store.createdCourtIds[i];
        if (!courtId) {
          const { court: created } = await api.courts.create(venueId, {
            name: court.name,
            sport: court.sport,
            slot_minutes: court.slotMinutes,
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        }
        // each court gets ITS OWN hours and prices
        await api.courts.setSchedule(courtId, buildSchedules(court));
        await api.courts.setPricing(courtId, buildPricingRules(court));
      }

      const finishedVenueId = venueId;
      store.reset();
      router.replace({ pathname: "/(owner)/venue-setup/pending", params: { venueId: finishedVenueId } });
    } catch (e) {
      if (isStaleVenueDraftError(e) && (draftHadVenue || Object.keys(draftCourtIds).length > 0)) {
        // Clear the stale ids right away so a relaunch can't loop back into the same failure.
        store.setField("createdVenueId", null);
        store.setField("createdCourtIds", {});
        setStaleDraft(true);
      } else {
        Alert.alert("Couldn't send for review", friendlyErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-4 pb-8 gap-5">
        <View className="gap-1.5">
          <Text className="font-plex-bold text-owner-ink text-[26px] tracking-tight">
            Your courts and prices
          </Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[15px]">
            Each court has its own slot length, opening hours and prices. We build its schedule from them.
          </Text>
        </View>

        <View className="flex-row items-center justify-between">
          <SectionLabel>Courts</SectionLabel>
          <Pressable onPress={store.addCourt} className="min-h-9 px-3 rounded-lg border border-owner-border flex-row items-center gap-1.5">
            <Text className="font-plex-semibold text-owner-accent text-[13px]">+ Add a court</Text>
          </Pressable>
        </View>

        {store.courts.map((court, index) => (
          <View key={index} className="gap-4">
            <SectionCard>
              <View className="flex-row items-center justify-between">
                <Text className="font-plex-bold text-owner-ink text-base">Court {index + 1}</Text>
                {store.courts.length > 1 ? (
                  <Pressable onPress={() => store.removeCourt(index)}>
                    <Text className="font-plex-medium text-owner-danger text-[12.5px]">Remove</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextField label="Name" value={court.name} onChangeText={(v) => store.updateCourt(index, { name: v })} />
              <View className="gap-2">
                <FieldLabel>Sport</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {SPORT_OPTIONS.map((sport) => (
                    <Chip key={sport} label={sport} selected={court.sport === sport} onPress={() => store.updateCourt(index, { sport })} />
                  ))}
                </View>
              </View>
              {index > 0 ? (
                <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
                  This court started as a copy of the one before it. Change anything below that is different for this court.
                </Text>
              ) : null}
            </SectionCard>
            <CourtSetupFields value={court} onChange={(patch) => store.updateCourt(index, patch)} />
          </View>
        ))}

        {staleDraft ? (
          <View className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border px-4 py-3 gap-3">
            <Text className="font-plex-semibold text-owner-danger text-[13.5px]">
              Your previous session for this venue has expired. Let's start fresh.
            </Text>
            <Pressable
              onPress={() => {
                store.reset();
                setStaleDraft(false);
                router.replace("/(owner)/venue-setup/register");
              }}
              className="self-start min-h-10 px-4 rounded-lg bg-owner-accent items-center justify-center"
            >
              <Text className="font-plex-semibold text-white text-[13.5px]">Start fresh</Text>
            </Pressable>
          </View>
        ) : null}

        <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
          We'll review it and come back to you within a day.
        </Text>
        <View className="flex-row gap-3">
          <SecondaryButton label="Back" onPress={() => router.back()} />
          <View className="flex-1">
            <PrimaryButton label="Send for review" onPress={handleSubmit} loading={submitting} disabled={!isValid} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
