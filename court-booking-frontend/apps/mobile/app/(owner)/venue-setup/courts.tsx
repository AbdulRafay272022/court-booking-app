import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { isStaleVenueDraftError } from "@court-booking/api-client";
import { weeklyHoursError, type PricingRuleInput, type ScheduleTemplateInput } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import {
  DAY_LABELS,
  SLOT_MINUTES_OPTIONS,
  SPORT_OPTIONS,
  useVenueSetupStore,
} from "@/lib/venue-setup-store";
import { TimeField12 } from "@/components/time-fields";
import { Chip, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, TextField } from "./_components";

function toTimeString(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : "06:00:00";
}

export default function VenueCourtsScreen() {
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);
  // Section 31 Part 2: the saved draft pointed at a venue/court that no longer exists (or isn't
  // ours). Shown as a recovery panel with a next step, not as a bare error alert.
  const [staleDraft, setStaleDraft] = useState(false);

  const totalPricedRules = store.pricingRules.filter((r) => Number(r.pricePerSlot) > 0);
  // Hours the database can't store (closing at/before opening, e.g. 06:00 -> 02:00) used to reach the API,
  // 500, and surface as a "network" error. Caught here so the owner sees what to fix.
  const hoursProblem = weeklyHoursError(
    store.sameHoursEveryDay, store.defaultOpenTime, store.defaultCloseTime, store.perDayOverrides, DAY_LABELS,
  );
  const isValid = store.courts.length > 0 && totalPricedRules.length > 0 && !hoursProblem;

  function buildSchedules(): ScheduleTemplateInput[] {
    if (store.sameHoursEveryDay) {
      return Array.from({ length: 7 }, (_, day) => ({
        day_of_week: day,
        open_time: toTimeString(store.defaultOpenTime),
        close_time: toTimeString(store.defaultCloseTime),
      }));
    }
    return Array.from({ length: 7 }, (_, day) => {
      const override = store.perDayOverrides[day];
      return {
        day_of_week: day,
        open_time: toTimeString(override?.open ?? store.defaultOpenTime),
        close_time: toTimeString(override?.close ?? store.defaultCloseTime),
      };
    });
  }

  function buildPricingRules(): PricingRuleInput[] {
    return totalPricedRules.map((r, i) => ({
      name: r.name || `Rule ${i + 1}`,
      priority: i,
      day_of_week: r.dayOfWeek,
      start_time: r.startTime ? toTimeString(r.startTime) : undefined,
      end_time: r.endTime ? toTimeString(r.endTime) : undefined,
      price_per_slot: Number(r.pricePerSlot),
      advance_percentage: 100,
    }));
  }

  async function handleSubmit() {
    if (hoursProblem) {
      Alert.alert("Check your hours", hoursProblem);
      return;
    }
    if (!isValid) {
      Alert.alert("Almost there", "Add at least one court and one priced rate before sending for review.");
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
          bank_details:
            store.bankName && store.accountTitle && store.accountNumber
              ? { bank: store.bankName, account_title: store.accountTitle, account_number: store.accountNumber }
              : undefined,
        });
        venueId = venue.id;
        store.setField("createdVenueId", venueId);
      }

      const schedules = buildSchedules();
      const pricingRules = buildPricingRules();

      // Resumable: courtId is reused from a prior attempt when we have one (POST /courts
      // always inserts, so re-running it for an already-created court would duplicate the
      // row) -- setSchedule/setPricing are safe to re-run unconditionally either way (the
      // backend replaces, not appends), so a retry that's already fully done just redoes
      // those two harmlessly and reaches the end.
      for (let i = 0; i < store.courts.length; i++) {
        const court = store.courts[i];
        let courtId = store.createdCourtIds[i];
        if (!courtId) {
          // Section 31: each court carries its own cancellation policy.
          const cutoffHours = court.cancellationCutoffHours.trim() ? Number(court.cancellationCutoffHours) : null;
          const { court: created } = await api.courts.create(venueId, {
            name: court.name,
            sport: court.sport,
            slot_minutes: court.slotMinutes,
            cancellation_allowed: court.cancellationAllowed,
            cancellation_cutoff_hours: court.cancellationAllowed ? cutoffHours : null,
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        }
        await api.courts.setSchedule(courtId, schedules);
        await api.courts.setPricing(courtId, pricingRules);
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
            Set your hours once and we build the whole schedule for you.
          </Text>
        </View>

        <SectionCard>
          <View className="flex-row items-center justify-between">
            <SectionLabel>Courts</SectionLabel>
            <Pressable onPress={store.addCourt} className="min-h-9 px-3 rounded-lg border border-owner-border flex-row items-center gap-1.5">
              <Text className="font-plex-semibold text-owner-accent text-[13px]">+ Add a court</Text>
            </Pressable>
          </View>

          {store.courts.map((court, index) => (
            <View key={index} className="border border-owner-border rounded-[10px] p-3.5 gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-plex-semibold text-owner-ink text-sm">Court {index + 1}</Text>
                {store.courts.length > 1 ? (
                  <Pressable onPress={() => store.removeCourt(index)}>
                    <Text className="font-plex-medium text-owner-danger text-[12.5px]">Remove</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextField
                label="Name"
                value={court.name}
                onChangeText={(v) => store.updateCourt(index, { name: v })}
              />
              <View className="gap-2">
                <FieldLabel>Sport</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {SPORT_OPTIONS.map((sport) => (
                    <Chip
                      key={sport}
                      label={sport}
                      selected={court.sport === sport}
                      onPress={() => store.updateCourt(index, { sport })}
                    />
                  ))}
                </View>
              </View>
              <View className="gap-2">
                <FieldLabel>Slot length</FieldLabel>
                <View className="flex-row gap-2">
                  {SLOT_MINUTES_OPTIONS.map((minutes) => (
                    <Chip
                      key={minutes}
                      label={`${minutes} min`}
                      selected={court.slotMinutes === minutes}
                      onPress={() => store.updateCourt(index, { slotMinutes: minutes })}
                    />
                  ))}
                </View>
              </View>
              <View className="gap-2">
                <FieldLabel>Cancellations</FieldLabel>
                <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
                  Can a player cancel a booking on this court after they've already paid?
                </Text>
                <View className="flex-row gap-2">
                  <Chip
                    label="Allowed"
                    selected={court.cancellationAllowed}
                    onPress={() => store.updateCourt(index, { cancellationAllowed: true })}
                  />
                  <Chip
                    label="Not allowed"
                    selected={!court.cancellationAllowed}
                    onPress={() => store.updateCourt(index, { cancellationAllowed: false })}
                  />
                </View>
                {court.cancellationAllowed ? (
                  <TextField
                    label="Require cancelling at least this many hours before (optional)"
                    value={court.cancellationCutoffHours}
                    onChangeText={(v) => store.updateCourt(index, { cancellationCutoffHours: v.replace(/\D/g, "") })}
                    keyboardType="number-pad"
                    placeholder="Leave blank for no limit"
                    mono
                  />
                ) : null}
              </View>
            </View>
          ))}
        </SectionCard>

        <SectionCard>
          <View className="flex-row items-center justify-between">
            <SectionLabel>Opening hours</SectionLabel>
            <Pressable onPress={() => store.setField("sameHoursEveryDay", !store.sameHoursEveryDay)}>
              <Text className="font-plex-semibold text-owner-accent text-[13px]">
                {store.sameHoursEveryDay ? "Set different hours per day" : "Use same hours every day"}
              </Text>
            </Pressable>
          </View>

          {store.sameHoursEveryDay ? (
            <View className="flex-row gap-3">
              <TimeField12 label="Opens" value={store.defaultOpenTime} onChange={(v) => store.setField("defaultOpenTime", v)} />
              <TimeField12 label="Closes" value={store.defaultCloseTime} onChange={(v) => store.setField("defaultCloseTime", v)} />
            </View>
          ) : (
            <View className="gap-3">
              {DAY_LABELS.map((label, day) => {
                const override = store.perDayOverrides[day] ?? {
                  open: store.defaultOpenTime,
                  close: store.defaultCloseTime,
                };
                return (
                  <View key={day} className="flex-row items-center gap-3">
                    <Text className="font-plex-medium text-owner-ink text-sm w-10">{label}</Text>
                    <View className="flex-1">
                      <TimeField12 label="" value={override.open} onChange={(v) => store.setDayOverride(day, { ...override, open: v })} />
                    </View>
                    <View className="flex-1">
                      <TimeField12 label="" value={override.close} onChange={(v) => store.setDayOverride(day, { ...override, close: v })} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          {hoursProblem ? (
            <Text className="font-plex-semibold text-owner-danger text-[13px]">{hoursProblem}</Text>
          ) : null}
        </SectionCard>

        <SectionCard>
          <SectionLabel>Prices</SectionLabel>
          {store.pricingRules.map((rule) => (
            <View key={rule.id} className="border border-owner-border rounded-[10px] p-3.5 gap-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <TextField
                    label="Name"
                    value={rule.name}
                    onChangeText={(v) => store.updatePricingRule(rule.id, { name: v })}
                  />
                </View>
                {store.pricingRules.length > 1 ? (
                  <Pressable onPress={() => store.removePricingRule(rule.id)} className="mt-6">
                    <Text className="font-plex-medium text-owner-danger text-[12.5px]">Remove</Text>
                  </Pressable>
                ) : null}
              </View>
              <View className="flex-row gap-3">
                <TextField
                  label="Per slot (PKR)"
                  value={rule.pricePerSlot}
                  onChangeText={(v) => store.updatePricingRule(rule.id, { pricePerSlot: v.replace(/\D/g, "") })}
                  keyboardType="number-pad"
                  placeholder="2500"
                  mono
                />
                <TimeField12 label="From (optional)" optional value={rule.startTime ?? ""} onChange={(v) => store.updatePricingRule(rule.id, { startTime: v || null })} />
                <TimeField12 label="To (optional)" optional value={rule.endTime ?? ""} onChange={(v) => store.updatePricingRule(rule.id, { endTime: v || null })} />
              </View>
            </View>
          ))}
          <Pressable
            onPress={store.addPricingRule}
            className="min-h-10 px-3 rounded-lg border border-owner-border items-start justify-center self-start"
          >
            <Text className="font-plex-semibold text-owner-accent text-[13px]">+ Add a peak-hours rule</Text>
          </Pressable>
        </SectionCard>

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
