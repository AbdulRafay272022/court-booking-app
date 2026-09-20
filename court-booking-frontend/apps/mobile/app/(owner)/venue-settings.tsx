import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Court, PricingRuleInput, ScheduleTemplateInput } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { DAY_LABELS } from "@/lib/venue-setup-store";
import { ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { Chip, FieldLabel, PrimaryButton, SectionCard, SectionLabel, TextField } from "./venue-setup/_components";
import { Tab } from "./_dashboard-components";

/** "HH:MM:SS" (API) <-> "HH:MM" (editable text input). */
function toShortTime(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}
function toApiTime(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : "06:00:00";
}

interface DayOverride {
  open: string;
  close: string;
}

interface PricingRuleDraft {
  id: string;
  name: string;
  pricePerSlot: string;
  dayOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
}

function ruleToDraft(r: { name: string; price_per_slot: number; day_of_week: number[] | null; start_time: string | null; end_time: string | null }, i: number): PricingRuleDraft {
  return {
    id: `existing-${i}`,
    name: r.name,
    pricePerSlot: String(r.price_per_slot),
    dayOfWeek: r.day_of_week,
    startTime: r.start_time ? toShortTime(r.start_time) : null,
    endTime: r.end_time ? toShortTime(r.end_time) : null,
  };
}

function makeRule(): PricingRuleDraft {
  return { id: Math.random().toString(36).slice(2), name: "New rate", pricePerSlot: "", dayOfWeek: null, startTime: null, endTime: null };
}

export default function VenueSettingsScreen() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  const courts = activeVenue?.courts ?? [];
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const activeCourtId = courtId ?? courts[0]?.id;

  const courtQuery = useQuery({
    queryKey: ["court-settings", activeCourtId],
    queryFn: () => api.courts.get(activeCourtId!),
    enabled: !!activeCourtId,
  });
  const blackoutsQuery = useQuery({
    queryKey: ["court-blackouts", activeCourtId],
    queryFn: () => api.courts.listBlackouts(activeCourtId!),
    enabled: !!activeCourtId,
  });

  const [sameHoursEveryDay, setSameHoursEveryDay] = useState(true);
  const [defaultOpenTime, setDefaultOpenTime] = useState("06:00");
  const [defaultCloseTime, setDefaultCloseTime] = useState("23:00");
  const [perDayOverrides, setPerDayOverrides] = useState<Partial<Record<number, DayOverride>>>({});
  const [pricingRules, setPricingRules] = useState<PricingRuleDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const [blackoutTitle, setBlackoutTitle] = useState("");
  const [blackoutStart, setBlackoutStart] = useState("");
  const [blackoutEnd, setBlackoutEnd] = useState("");
  const [addingBlackout, setAddingBlackout] = useState(false);

  // Re-seed local editable state whenever the fetched court changes (initial load or switching
  // courts) -- this screen edits a copy, not the query cache directly.
  useEffect(() => {
    const court = courtQuery.data as Court | undefined;
    if (!court) return;
    const byDay: Partial<Record<number, DayOverride>> = {};
    for (const t of court.schedule_templates) {
      byDay[t.day_of_week] = { open: toShortTime(t.open_time), close: toShortTime(t.close_time) };
    }
    const first = byDay[0];
    const allSame = first && [0, 1, 2, 3, 4, 5, 6].every((d) => byDay[d]?.open === first.open && byDay[d]?.close === first.close);
    setSameHoursEveryDay(!!allSame || Object.keys(byDay).length === 0);
    if (first) {
      setDefaultOpenTime(first.open);
      setDefaultCloseTime(first.close);
    }
    setPerDayOverrides(byDay);
    setPricingRules(court.pricing_rules.length > 0 ? court.pricing_rules.map(ruleToDraft) : [makeRule()]);
  }, [courtQuery.data]);

  function buildSchedules(): ScheduleTemplateInput[] {
    if (sameHoursEveryDay) {
      return Array.from({ length: 7 }, (_, day) => ({
        day_of_week: day,
        open_time: toApiTime(defaultOpenTime),
        close_time: toApiTime(defaultCloseTime),
      }));
    }
    return Array.from({ length: 7 }, (_, day) => {
      const o = perDayOverrides[day] ?? { open: defaultOpenTime, close: defaultCloseTime };
      return { day_of_week: day, open_time: toApiTime(o.open), close_time: toApiTime(o.close) };
    });
  }

  function buildPricingRules(): PricingRuleInput[] {
    return pricingRules
      .filter((r) => Number(r.pricePerSlot) > 0)
      .map((r, i) => ({
        name: r.name || `Rule ${i + 1}`,
        priority: i,
        day_of_week: r.dayOfWeek,
        start_time: r.startTime ? toApiTime(r.startTime) : undefined,
        end_time: r.endTime ? toApiTime(r.endTime) : undefined,
        price_per_slot: Number(r.pricePerSlot),
        advance_percentage: 100,
      }));
  }

  async function handleSave() {
    if (!activeCourtId) return;
    const rules = buildPricingRules();
    if (rules.length === 0) {
      Alert.alert("Add a price", "At least one priced rate is needed before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.courts.setSchedule(activeCourtId, buildSchedules());
      await api.courts.setPricing(activeCourtId, rules);
      await queryClient.invalidateQueries({ queryKey: ["court-settings", activeCourtId] });
      await queryClient.invalidateQueries({ queryKey: ["court", activeCourtId] });
      Alert.alert("Saved", "Hours and pricing updated.");
    } catch (e) {
      Alert.alert("Couldn't save", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBlackout() {
    if (!activeCourtId || !blackoutStart || !blackoutEnd) {
      Alert.alert("Missing dates", "Pick a start and end date/time for the blackout.");
      return;
    }
    setAddingBlackout(true);
    try {
      await api.courts.addBlackout(activeCourtId, {
        title: blackoutTitle || undefined,
        starts_at: new Date(blackoutStart).toISOString(),
        ends_at: new Date(blackoutEnd).toISOString(),
      });
      setBlackoutTitle("");
      setBlackoutStart("");
      setBlackoutEnd("");
      await queryClient.invalidateQueries({ queryKey: ["court-blackouts", activeCourtId] });
    } catch (e) {
      Alert.alert("Couldn't add blackout", friendlyErrorMessage(e));
    } finally {
      setAddingBlackout(false);
    }
  }

  const loading = venuesLoading || courtQuery.isLoading;

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px] flex-1">Venue settings</Text>
      </View>

      {courts.length > 1 ? (
        <View className="px-4.5 py-3 bg-owner-surface border-b border-owner-border flex-row gap-1.5">
          {courts.map((c) => (
            <Tab key={c.id} label={c.name} selected={activeCourtId === c.id} onPress={() => setCourtId(c.id)} />
          ))}
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : courtQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(courtQuery.error)} onRetry={() => courtQuery.refetch()} tone="owner" />
      ) : !activeCourtId ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="font-plex-medium text-owner-ink-faint text-center">No courts yet — add one from venue setup first.</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-8 gap-4">
          <SectionCard>
            <View className="flex-row items-center justify-between">
              <SectionLabel>Opening hours</SectionLabel>
              <Pressable onPress={() => setSameHoursEveryDay(!sameHoursEveryDay)}>
                <Text className="font-plex-semibold text-owner-accent text-[13px]">
                  {sameHoursEveryDay ? "Set different hours per day" : "Use same hours every day"}
                </Text>
              </Pressable>
            </View>
            {sameHoursEveryDay ? (
              <View className="flex-row gap-3">
                <TextField label="Opens" value={defaultOpenTime} onChangeText={setDefaultOpenTime} placeholder="06:00" mono />
                <TextField label="Closes" value={defaultCloseTime} onChangeText={setDefaultCloseTime} placeholder="23:00" mono />
              </View>
            ) : (
              <View className="gap-3">
                {DAY_LABELS.map((label, day) => {
                  const o = perDayOverrides[day] ?? { open: defaultOpenTime, close: defaultCloseTime };
                  return (
                    <View key={day} className="flex-row items-center gap-3">
                      <Text className="font-plex-medium text-owner-ink text-sm w-10">{label}</Text>
                      <View className="flex-1">
                        <TextField
                          label=""
                          value={o.open}
                          onChangeText={(v) => setPerDayOverrides({ ...perDayOverrides, [day]: { ...o, open: v } })}
                          placeholder="06:00"
                          mono
                        />
                      </View>
                      <View className="flex-1">
                        <TextField
                          label=""
                          value={o.close}
                          onChangeText={(v) => setPerDayOverrides({ ...perDayOverrides, [day]: { ...o, close: v } })}
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
            {pricingRules.map((rule) => (
              <View key={rule.id} className="border border-owner-border rounded-[10px] p-3.5 gap-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 mr-3">
                    <TextField
                      label="Name"
                      value={rule.name}
                      onChangeText={(v) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, name: v } : r)))}
                    />
                  </View>
                  {pricingRules.length > 1 ? (
                    <Pressable onPress={() => setPricingRules(pricingRules.filter((r) => r.id !== rule.id))} className="mt-6">
                      <Text className="font-plex-medium text-owner-danger text-[12.5px]">Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View className="flex-row gap-3">
                  <TextField
                    label="Per slot (PKR)"
                    value={rule.pricePerSlot}
                    onChangeText={(v) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, pricePerSlot: v.replace(/\D/g, "") } : r)))}
                    keyboardType="number-pad"
                    placeholder="2500"
                    mono
                  />
                  <TextField
                    label="From (optional)"
                    value={rule.startTime ?? ""}
                    onChangeText={(v) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, startTime: v || null } : r)))}
                    placeholder="16:00"
                    mono
                  />
                  <TextField
                    label="To (optional)"
                    value={rule.endTime ?? ""}
                    onChangeText={(v) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, endTime: v || null } : r)))}
                    placeholder="close"
                    mono
                  />
                </View>
              </View>
            ))}
            <Pressable
              onPress={() => setPricingRules([...pricingRules, makeRule()])}
              className="min-h-10 px-3 rounded-lg border border-owner-border items-start justify-center self-start"
            >
              <Text className="font-plex-semibold text-owner-accent text-[13px]">+ Add a rate</Text>
            </Pressable>
          </SectionCard>

          <PrimaryButton label="Save changes" onPress={handleSave} loading={saving} />

          <SectionCard>
            <SectionLabel>Blackout dates</SectionLabel>
            {(blackoutsQuery.data ?? []).length === 0 ? (
              <Text className="font-plex-medium text-owner-ink-faint text-[13px]">No blackout dates yet.</Text>
            ) : (
              (blackoutsQuery.data ?? []).map((b) => (
                <View key={b.id} className="border border-owner-border rounded-[10px] p-3">
                  <Text className="font-plex-semibold text-owner-ink text-sm">{b.title ?? "Blocked"}</Text>
                  <Text className="font-mono-medium text-owner-ink-faint text-xs mt-0.5">
                    {new Date(b.starts_at).toLocaleString()} → {new Date(b.ends_at).toLocaleString()}
                  </Text>
                </View>
              ))
            )}
            <View className="h-px bg-owner-border-light" />
            <FieldLabel>Add a blackout</FieldLabel>
            <TextField label="Title (optional)" value={blackoutTitle} onChangeText={setBlackoutTitle} placeholder="Maintenance" />
            <TextField
              label="Starts at (e.g. 2026-12-25 06:00)"
              value={blackoutStart}
              onChangeText={setBlackoutStart}
              placeholder="YYYY-MM-DD HH:MM"
              mono
            />
            <TextField
              label="Ends at"
              value={blackoutEnd}
              onChangeText={setBlackoutEnd}
              placeholder="YYYY-MM-DD HH:MM"
              mono
            />
            <PrimaryButton label="Add blackout" onPress={handleAddBlackout} loading={addingBlackout} />
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
