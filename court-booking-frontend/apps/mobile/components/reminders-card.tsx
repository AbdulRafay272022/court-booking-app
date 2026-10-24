import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Checkbox, ErrorState, IconButton, Pill, Skeleton, Text } from "@/components/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_HINT_COPY, type SettingDefaultKey, type VenueTimers } from "@court-booking/types";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { PERM } from "@/lib/overview";
import { useMyPermissions } from "@/lib/use-my-permissions";
import {
  effectiveTimerDraft,
  timerDraftFromValues,
  timerDraftProblems,
  timerDraftToValues,
  timerPreview,
  type TimerDraft,
  type TimerField,
} from "@/lib/settings-defaults";
import { DefaultHint } from "./default-hint";
import { PrimaryButton, SectionCard, SectionLabel, TextField } from "../app/(owner)/venue-setup/_components";

const digits = (v: string) => v.replace(/\D/g, "");

/** − / + step and the allowed floor per timer (the full ranges are checked by timerDraftProblems). */
const STEP: Record<string, { step: number; min: number }> = {
  hold: { step: 5, min: 5 },
  first: { step: 5, min: 1 },
  every: { step: 5, min: 5 },
  max: { step: 1, min: 1 },
  cancelAfter: { step: 5, min: 5 },
};

function Check({ checked, label, onPress, testID }: { checked: boolean; label: string; onPress: () => void; testID?: string }) {
  return <Checkbox checked={checked} onChange={() => onPress()} label={label} testID={testID} />;
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

  // OSettings "Timers": − value + (the value stays typeable), the state badge, help and "Default par wapas".
  const numberField = (field: TimerField, key: SettingDefaultKey, label: string, testID: string) => {
    const cur = Number(e[field] ?? 0) || 0;
    const st = STEP[field] ?? { step: 1, min: 0 };
    const set = (n: number) => onChange({ [field]: String(Math.max(st.min, n)) } as Partial<TimerDraft>);
    const custom = value[field] !== null && value[field] !== undefined;
    return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] }}>
        <IconButton icon={Minus} variant="mist" accessibilityLabel={`${label} kam karein`} onPress={() => set(cur - st.step)} disabled={cur - st.step < st.min} testID={`${testID}-dec`} />
        <TextField
          label={label}
          value={String(e[field] ?? "")}
          onChangeText={(v) => onChange({ [field]: digits(v) } as Partial<TimerDraft>)}
          keyboardType="number-pad"
          error={errors[field] ?? null}
          testID={testID}
        />
        <IconButton icon={Plus} variant="mist" accessibilityLabel={`${label} barhayein`} onPress={() => set(cur + st.step)} testID={`${testID}-inc`} />
      </View>
      <Pill size="sm" tone={custom ? "waiting" : "info"} label={custom ? "Badla hua" : "Default chal raha"} />
      <DefaultHint
        settingKey={key}
        value={value[field] === null ? null : Number(value[field])}
        onReset={() => onChange({ [field]: null } as Partial<TimerDraft>)}
        testID={`default-${testID}`}
      />
    </View>
    );
  };

  return (
    <SectionCard>
      <SectionLabel>Hold aur payment reminders</SectionLabel>
      <Text variant="meta" tone="muted">
        Player slot chunta hai to wo itni der us ke liye hold rehta hai, taa ke wo payment bhej sake. Jab player payment ka
        screenshot bheje aur aap ne abhi approve ya reject na kiya ho, hum aap ko yaad dilate hain. Aap ke action lete hi ya
        player ke cancel karte hi reminders ruk jate hain. Waqt screenshot aane se minute mein hai.
      </Text>

      {numberField("hold", "hold_minutes", "Slot hold (minute)", "rem-hold")}

      <View style={{ gap: 6 }}>
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

      <View style={{ gap: 6 }}>
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
          <Text variant="meta" weight="bold" tone="waiting">
            Dhyan dein: ho sakta hai player ne asal mein paisa bhej diya ho. Auto-cancel booking ko khud cancel kar dega, is liye
            screenshot zaroor check karein. Cancel se 5 minute pehle aap ko aakhri warning milegi.
          </Text>
        </>
      ) : (
        <Text testID="auto-cancel-off-warning" variant="meta" weight="bold" tone="waiting">
          {DEFAULT_HINT_COPY.ru.autoCancelOffWarning}
        </Text>
      )}

      {warnings.map((w) => (
        <Text key={w} variant="meta" tone="waiting">
          {w}
        </Text>
      ))}
      {preview ? (
        <View style={{ borderRadius: radius.sm, paddingHorizontal: space[3], paddingVertical: 10, backgroundColor: palette.tealTint }}>
          <Text testID="reminder-preview" variant="bodyBold">
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
  const perms = useMyPermissions();
  const q = useQuery({
    queryKey: ["venue-timers", venueId],
    queryFn: () => api.owners.venueTimers(venueId),
    retry: false,
  });
  // placeholderData keeps the previous venue's data while a new one loads: never seed from another venue's answer.
  const data = q.data && !q.isPlaceholderData ? q.data : undefined;
  // staff without edit_court_settings: a read-only summary (the server answers 403 to their PUT, and to the GET too
  // unless they hold view_ledger), never inputs and never an error box
  const denied = q.error instanceof ApiError && q.error.status === 403;
  if (perms.settled && (!perms.can(PERM.editSettings, venueId) || denied)) {
    return <VenueRemindersReadOnly data={data} />;
  }
  if (!perms.settled) {
    return (
      <SectionCard>
        <SectionLabel>Hold aur payment reminders</SectionLabel>
        <Skeleton height={120} r={radius.input} />
      </SectionCard>
    );
  }
  if (q.isError && !data) {
    return (
      <SectionCard>
        <SectionLabel>Hold aur payment reminders</SectionLabel>
        <ErrorState message={friendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard>
        <SectionLabel>Hold aur payment reminders</SectionLabel>
        <Skeleton height={120} r={radius.input} />
      </SectionCard>
    );
  }
  return <VenueRemindersForm key={venueId} venueId={venueId} initial={data} />;
}

/** What runs at this venue, without inputs (staff without the settings permission). */
function VenueRemindersReadOnly({ data }: { data: VenueTimers | undefined }) {
  const preview = data ? timerPreview(timerDraftFromValues(data.values)) : null;
  return (
    <SectionCard>
      <View testID="timers-card-readonly" style={{ gap: space[2] }}>
        <SectionLabel>Hold aur payment reminders</SectionLabel>
        {data ? (
          <Text variant="body">
            {`Player ke paas payment bhejne ke liye ${data.effective.hold_minutes} minute.`}
          </Text>
        ) : null}
        {preview ? <Text variant="body">{preview}</Text> : null}
        <Text variant="meta" tone="muted">
          Ye settings sirf venue owner (ya settings ki ijazat wala staff) badal sakta hai.
        </Text>
      </View>
    </SectionCard>
  );
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
            <Text accessibilityRole="alert" testID="timers-message" variant="bodyBold" tone={message.ok ? "info" : "danger"}>
              {message.text}
            </Text>
          ) : null}
          <PrimaryButton label="Save reminder settings" onPress={save} disabled={hasErrors || saving} loading={saving} />
        </>
      }
    />
  );
}
