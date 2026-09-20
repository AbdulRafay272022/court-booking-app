import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { PricingRuleInput, ScheduleTemplateInput } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import {
  DAY_LABELS,
  SLOT_MINUTES_OPTIONS,
  SPORT_OPTIONS,
  useVenueSetupStore,
} from "@/lib/venue-setup-store";
import { Chip, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, TextField } from "./_components";

function toTimeString(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : "06:00:00";
}

export default function VenueCourtsScreen() {
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);

  const totalPricedRules = store.pricingRules.filter((r) => Number(r.pricePerSlot) > 0);
  const isValid = store.courts.length > 0 && totalPricedRules.length > 0;

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
    if (!isValid) {
      Alert.alert("Almost there", "Add at least one court and one priced rate before sending for review.");
      return;
    }
    setSubmitting(true);
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

      for (const court of store.courts) {
        const { court: created } = await api.courts.create(venueId, {
          name: court.name,
          sport: court.sport,
          slot_minutes: court.slotMinutes,
        });
        await api.courts.setSchedule(created.id, schedules);
        await api.courts.setPricing(created.id, pricingRules);
      }

      const finishedVenueId = venueId;
      store.reset();
      router.replace({ pathname: "/(owner)/venue-setup/pending", params: { venueId: finishedVenueId } });
    } catch (e) {
      Alert.alert("Couldn't send for review", friendlyErrorMessage(e));
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
              <TextField
                label="Opens"
                value={store.defaultOpenTime}
                onChangeText={(v) => store.setField("defaultOpenTime", v)}
                placeholder="06:00"
                mono
              />
              <TextField
                label="Closes"
                value={store.defaultCloseTime}
                onChangeText={(v) => store.setField("defaultCloseTime", v)}
                placeholder="23:00"
                mono
              />
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
                      <TextField
                        label=""
                        value={override.open}
                        onChangeText={(v) => store.setDayOverride(day, { ...override, open: v })}
                        placeholder="06:00"
                        mono
                      />
                    </View>
                    <View className="flex-1">
                      <TextField
                        label=""
                        value={override.close}
                        onChangeText={(v) => store.setDayOverride(day, { ...override, close: v })}
                        placeholder="23:00"
                        mono
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
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
                <TextField
                  label="From (optional)"
                  value={rule.startTime ?? ""}
                  onChangeText={(v) => store.updatePricingRule(rule.id, { startTime: v || null })}
                  placeholder="16:00"
                  mono
                />
                <TextField
                  label="To (optional)"
                  value={rule.endTime ?? ""}
                  onChangeText={(v) => store.updatePricingRule(rule.id, { endTime: v || null })}
                  placeholder="close"
                  mono
                />
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
