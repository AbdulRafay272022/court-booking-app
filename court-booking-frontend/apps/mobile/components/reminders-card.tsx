import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  REMINDER_DEFAULTS,
  reminderPreviewText,
  reminderSchedule,
  validateReminderInput,
  type ReminderField,
} from "@court-booking/types";

import { SectionCard, SectionLabel, TextField } from "../app/(owner)/venue-setup/_components";

/** Y prefilled when the owner switches auto-cancel on (the spec's worked example). */
export const AUTO_CANCEL_PREFILL_MIN = 120;

/** Stage 1 note: per-venue reminder settings need a schema change (Stage 2), so nothing here is saved yet. */
export const REMINDERS_NOT_SAVED_NOTE = "Ye settings save karne ka option jald aa raha hai; abhi ye default chal rahe hain.";

const toNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/**
 * Owner Round 2 (B1, Stage 1): "Payment reminders" card with a LIVE preview from the shared `reminderSchedule` /
 * `reminderPreviewText` (packages/types, the same function the backend scheduler is tested against) and the shared
 * `validateReminderInput` errors. Rendered in Venue Settings and in the onboarding wizard under "Advanced" (same
 * component, same defaults = today's behaviour). NOT saved: see REMINDERS_NOT_SAVED_NOTE.
 */
export function RemindersCard() {
  const [first, setFirst] = useState(String(REMINDER_DEFAULTS.firstAfterMin));
  const [every, setEvery] = useState(String(REMINDER_DEFAULTS.everyMin));
  const [max, setMax] = useState(String(REMINDER_DEFAULTS.maxReminders));
  const [autoCancel, setAutoCancel] = useState(REMINDER_DEFAULTS.autoCancelMin !== null);
  const [cancelAfter, setCancelAfter] = useState(String(REMINDER_DEFAULTS.autoCancelMin ?? AUTO_CANCEL_PREFILL_MIN));

  const input = { firstAfterMin: toNum(first), everyMin: toNum(every), maxReminders: toNum(max), autoCancelMin: toNum(cancelAfter) };
  const { errors, warnings } = validateReminderInput(input, autoCancel, "ru");
  const errorFor = (f: ReminderField) => errors.find((e) => e.field === f)?.message ?? null;
  const preview =
    errors.length === 0
      ? reminderPreviewText(
          reminderSchedule({
            firstAfterMin: input.firstAfterMin ?? 0,
            everyMin: input.everyMin ?? 0,
            maxReminders: input.maxReminders ?? 0,
            autoCancelMin: autoCancel ? input.autoCancelMin : null,
          }),
          "ru",
        )
      : null;
  const digits = (v: string) => v.replace(/\D/g, "");

  return (
    <SectionCard>
      <SectionLabel>Payment reminders</SectionLabel>
      <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
        Jab player payment ka screenshot bheje aur aap ne abhi approve ya reject na kiya ho, hum aap ko yaad dilate hain. Aap ke
        action lete hi ya player ke cancel karte hi reminders ruk jate hain. Waqt screenshot aane se minute mein hai.
      </Text>
      <TextField
        label="Pehla reminder (kitne minute baad)"
        value={first}
        onChangeText={(v) => setFirst(digits(v))}
        keyboardType="number-pad"
        mono
        error={errorFor("firstAfterMin")}
        testID="rem-first"
      />
      <TextField
        label="Phir har (minute)"
        value={every}
        onChangeText={(v) => setEvery(digits(v))}
        keyboardType="number-pad"
        mono
        error={errorFor("everyMin")}
        testID="rem-every"
      />
      <TextField
        label="Zyada se zyada reminders"
        value={max}
        onChangeText={(v) => setMax(digits(v))}
        keyboardType="number-pad"
        mono
        error={errorFor("maxReminders")}
        testID="rem-max"
      />

      <Pressable
        onPress={() => setAutoCancel((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: autoCancel }}
        accessibilityLabel="Approve na hone par booking khud cancel karein"
        className="flex-row items-center gap-3"
        style={{ minHeight: 44 }}
      >
        <View
          className="items-center justify-center rounded-md"
          style={{ width: 24, height: 24, borderWidth: 2, borderColor: "#0E6274", backgroundColor: autoCancel ? "#0E6274" : "#FFFFFF" }}
        >
          {autoCancel ? <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14, lineHeight: 16 }}>{String.fromCharCode(0x2713)}</Text> : null}
        </View>
        <Text className="font-plex-semibold text-owner-ink text-[13.5px] flex-1">Approve na hone par booking khud cancel karein</Text>
      </Pressable>
      {autoCancel ? (
        <>
          <TextField
            label="Kitne minute baad cancel"
            value={cancelAfter}
            onChangeText={(v) => setCancelAfter(digits(v))}
            keyboardType="number-pad"
            mono
            error={errorFor("autoCancelMin")}
            testID="rem-cancel"
          />
          <Text className="font-plex-semibold text-owner-warn text-[12.5px]">
            Dhyan dein: ho sakta hai player ne asal mein paisa bhej diya ho. Auto-cancel booking ko khud cancel kar dega, is liye
            screenshot zaroor check karein. Cancel se 5 minute pehle aap ko aakhri warning milegi.
          </Text>
        </>
      ) : null}

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
      <Text testID="reminders-note" className="font-plex-medium text-owner-ink-muted text-[12.5px]">
        {REMINDERS_NOT_SAVED_NOTE}
      </Text>
    </SectionCard>
  );
}

