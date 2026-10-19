import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_HINT_COPY, type SettingDefaultKey, type VenueTimers } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import {
  effectiveTimerDraft,
  timerDraftFromValues,
  timerDraftProblems,
  timerDraftToValues,
  timerPreview,
  type TimerDraft,
  type TimerField,
} from "@/lib/settings-defaults";
import { ErrorState } from "./error-state";
import { DefaultHint } from "./default-hint";
import { PrimaryButton, SectionCard, SectionLabel, TextField } from "../app/(owner)/venue-setup/_components";

const digits = (v: string) => v.replace(/\D/g, "");

function Check({ checked, label, onPress, testID }: { checked: boolean; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      testID={testID}
      className="flex-row items-center gap-3"
      style={{ minHeight: 44 }}
    >
      <View
        className="items-center justify-center rounded-md"
        style={{ width: 24, height: 24, borderWidth: 2, borderColor: "#0E6274", backgroundColor: checked ? "#0E6274" : "#FFFFFF" }}
      >
        {checked ? <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14, lineHeight: 16 }}>{String.fromCharCode(0x2713)}</Text> : null}
      </View>
      <Text className="font-plex-semibold text-owner-ink text-[13.5px] flex-1">{label}</Text>
    </Pressable>
  );
}

/**
 * Owner Round 2 Stage 2 (B1 saveable): hold minutes, payment reminders and auto-cancel for ONE venue, with a live preview
 * from the shared `reminderSchedule` and a DefaultHint under every field. CONTROLLED: Venue Settings (`VenueRemindersCard`
 * below, loads + PUTs /owners/venues/{id}/timers) and the onboarding wizard's "Advanced" (keeps the draft in the wizard
 * store, PUTs after the venue is created) render the same card. null in the draft = the default (and null is saved).
 */
export function RemindersCard({
  value,
  onChange,
  footer,
}: {
  value: TimerDraft;
  onChange: (patch: Partial<TimerDraft>) => void;
  footer?: ReactNode;
}) {
  const e = effectiveTimerDraft(value);
  const { errors, warnings } = timerDraftProblems(value);
  const preview = timerPreview(value);

  const numberField = (field: TimerField, key: SettingDefaultKey, label: string, testID: string) => (
    <View className="gap-1.5">
      <TextField
        label={label}
        value={String(e[field] ?? "")}
        onChangeText={(v) => onChange({ [field]: digits(v) } as Partial<TimerDraft>)}
        keyboardType="number-pad"
        mono
        error={errors[field] ?? null}
        testID={testID}
      />
      <DefaultHint
        settingKey={key}
        value={value[field] === null ? null : Number(value[field])}
        onReset={() => onChange({ [field]: null } as Partial<TimerDraft>)}
        testID={`default-${testID}`}
      />
    </View>
  );

  return (
    <SectionCard>
      <SectionLabel>Hold aur payment reminders</SectionLabel>
      <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
        Player slot chunta hai to wo itni der us ke liye hold rehta hai, taa ke wo payment bhej sake. Jab player payment ka
        screenshot bheje aur aap ne abhi approve ya reject na kiya ho, hum aap ko yaad dilate hain. Aap ke action lete hi ya
        player ke cancel karte hi reminders ruk jate hain. Waqt screenshot aane se minute mein hai.
      </Text>

      {numberField("hold", "hold_minutes", "Slot hold (minute)", "rem-hold")}

      <View className="gap-1.5">
        <Check
          checked={e.remindersOn}
          label="Approve na hone par mujhe reminder bhejein"
          onPress={() => onChange({ remindersOn: !e.remindersOn })}
          testID="rem-on"
        />
        <DefaultHint settingKey="reminders_enabled" value={value.remindersOn} onReset={() => onChange({ remindersOn: null })} testID="default-rem-on" />
      </View>
      {e.remindersOn ? (
        <>
          {numberField("first", "first_reminder_after_min", "Pehla reminder (kitne minute baad)", "rem-first")}
          {numberField("every", "repeat_every_min", "Phir har (minute)", "rem-every")}
          {numberField("max", "max_reminders", "Zyada se zyada reminders", "rem-max")}
        </>
      ) : null}

      <View className="gap-1.5">
        <Check
          checked={e.autoCancelOn}
          label="Approve na hone par booking khud cancel karein"
          onPress={() => onChange({ autoCancelOn: !e.autoCancelOn })}
          testID="rem-auto"
        />
        <DefaultHint
          settingKey="auto_cancel_enabled"
          value={value.autoCancelOn}
          onReset={() => onChange({ autoCancelOn: null, cancelAfter: null })}
          testID="default-rem-auto"
        />
      </View>
      {e.autoCancelOn ? (
        <>
          {numberField("cancelAfter", "auto_cancel_after_min", "Kitne minute baad cancel", "rem-cancel")}
          <Text className="font-plex-semibold text-owner-warn text-[12.5px]">
            Dhyan dein: ho sakta hai player ne asal mein paisa bhej diya ho. Auto-cancel booking ko khud cancel kar dega, is liye
            screenshot zaroor check karein. Cancel se 5 minute pehle aap ko aakhri warning milegi.
          </Text>
        </>
      ) : (
        <Text testID="auto-cancel-off-warning" className="font-plex-semibold text-owner-warn text-[12.5px]">
          {DEFAULT_HINT_COPY.ru.autoCancelOffWarning}
        </Text>
      )}

      {warnings.map((w) => (
        <Text key={w} className="font-plex-medium text-owner-warn text-[12.5px]">
          {w}
        </Text>
      ))}
      {preview ? (
        <View className="rounded-[10px] px-3 py-2.5" style={{ backgroundColor: "#EEF6F7" }}>
          <Text testID="reminder-preview" className="font-plex-semibold text-owner-ink text-[13.5px]">
            {preview}
          </Text>
        </View>
      ) : null}
      {footer}
    </SectionCard>
  );
}

/** Venue Settings: loads this venue's timers, saves them (PUT, null = default) and shows the result. */
export function VenueRemindersCard({ venueId }: { venueId: string }) {
  const q = useQuery({
    queryKey: ["venue-timers", venueId],
    queryFn: () => api.owners.venueTimers(venueId),
    retry: false,
  });
  // placeholderData keeps the previous venue's data while a new one loads: never seed from another venue's answer.
  const data = q.data && !q.isPlaceholderData ? q.data : undefined;
  if (q.isError && !data) {
    return (
      <SectionCard>
        <SectionLabel>Hold aur payment reminders</SectionLabel>
        <ErrorState message={friendlyErrorMessage(q.error)} onRetry={() => q.refetch()} tone="owner" />
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard>
        <SectionLabel>Hold aur payment reminders</SectionLabel>
        <ActivityIndicator color="#0E6274" />
      </SectionCard>
    );
  }
  return <VenueRemindersForm key={venueId} venueId={venueId} initial={data} />;
}

function VenueRemindersForm({ venueId, initial }: { venueId: string; initial: VenueTimers }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TimerDraft>(() => timerDraftFromValues(initial.values));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const hasErrors = Object.keys(timerDraftProblems(draft).errors).length > 0;

  async function save() {
    if (hasErrors) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.owners.updateVenueTimers(venueId, timerDraftToValues(draft));
      queryClient.setQueryData(["venue-timers", venueId], saved);
      setDraft(timerDraftFromValues(saved.values));
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: friendlyErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <RemindersCard
      value={draft}
      onChange={(patch) => {
        setMessage(null);
        setDraft((cur) => ({ ...cur, ...patch }));
      }}
      footer={
        <>
          {message ? (
            <Text
              accessibilityRole="alert"
              testID="timers-message"
              className="font-plex-semibold text-[13.5px]"
              style={{ color: message.ok ? "#0E6274" : "#C13525" }}
            >
              {message.text}
            </Text>
          ) : null}
          <PrimaryButton label="Save reminder settings" onPress={save} disabled={hasErrors || saving} loading={saving} />
        </>
      }
    />
  );
}
