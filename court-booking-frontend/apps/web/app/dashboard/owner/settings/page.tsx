"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Court, PricingRuleInput, ScheduleTemplateInput } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { DAY_LABELS } from "@/lib/venue-setup-store";
import { Chip, Field, FieldLabel, PrimaryButton, SectionCard, SectionLabel } from "@/components/setup/ui";

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

export default function VenueSettingsPage() {
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
  const [saveMessage, setSaveMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [blackoutTitle, setBlackoutTitle] = useState("");
  const [blackoutStart, setBlackoutStart] = useState("");
  const [blackoutEnd, setBlackoutEnd] = useState("");
  const [addingBlackout, setAddingBlackout] = useState(false);
  const [blackoutError, setBlackoutError] = useState<string | null>(null);

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
    // Deliberately NOT clearing saveMessage here: handleSave's own invalidateQueries() triggers
    // a refetch that re-runs this effect moments after a successful save, which cleared the
    // "Hours and pricing updated" confirmation almost as soon as it appeared (caught live while
    // verifying this screen). Cleared instead on court switch specifically, below.
  }, [courtQuery.data]);

  // Clear any stale confirmation/error when switching to a different court.
  useEffect(() => {
    setSaveMessage(null);
  }, [activeCourtId]);

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
      setSaveMessage({ kind: "error", text: "Add at least one priced rate before saving." });
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      await api.courts.setSchedule(activeCourtId, buildSchedules());
      await api.courts.setPricing(activeCourtId, rules);
      await queryClient.invalidateQueries({ queryKey: ["court-settings", activeCourtId] });
      await queryClient.invalidateQueries({ queryKey: ["court", activeCourtId] });
      setSaveMessage({ kind: "ok", text: "Hours and pricing updated." });
    } catch (e) {
      setSaveMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBlackout() {
    if (!activeCourtId || !blackoutStart || !blackoutEnd) {
      setBlackoutError("Pick a start and end date/time for the blackout.");
      return;
    }
    setAddingBlackout(true);
    setBlackoutError(null);
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
      setBlackoutError(friendlyErrorMessage(e));
    } finally {
      setAddingBlackout(false);
    }
  }

  const loading = venuesLoading || courtQuery.isLoading;

  return (
    <div className="p-8 max-w-3xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Venue settings</h1>

      {courts.length > 1 ? (
        <div className="flex gap-2">
          {courts.map((c) => (
            <button
              key={c.id}
              onClick={() => setCourtId(c.id)}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
              style={{ background: activeCourtId === c.id ? "#0E6274" : "#F4F6F7", color: activeCourtId === c.id ? "#fff" : "#5B7079" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : courtQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(courtQuery.error)} onRetry={() => courtQuery.refetch()} tone="owner" />
      ) : !activeCourtId ? (
        <p className="text-owner-ink-faint">No courts yet — add one from venue setup first.</p>
      ) : (
        <>
          <SectionCard>
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Opening hours</SectionLabel>
              <button
                type="button"
                onClick={() => setSameHoursEveryDay(!sameHoursEveryDay)}
                className="text-[13px] font-semibold text-owner-accent"
              >
                {sameHoursEveryDay ? "Set different hours per day" : "Use same hours every day"}
              </button>
            </div>
            {sameHoursEveryDay ? (
              <div className="flex gap-3">
                <Field label="Opens" type="time" value={defaultOpenTime} onChange={(e) => setDefaultOpenTime(e.target.value)} mono />
                <Field label="Closes" type="time" value={defaultCloseTime} onChange={(e) => setDefaultCloseTime(e.target.value)} mono />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {DAY_LABELS.map((label, day) => {
                  const o = perDayOverrides[day] ?? { open: defaultOpenTime, close: defaultCloseTime };
                  return (
                    <div key={day} className="flex items-end gap-3">
                      <span className="text-sm font-medium w-10 pb-3">{label}</span>
                      <Field
                        label=""
                        type="time"
                        value={o.open}
                        onChange={(e) => setPerDayOverrides({ ...perDayOverrides, [day]: { ...o, open: e.target.value } })}
                        mono
                        aria-label={`${label} opens`}
                      />
                      <Field
                        label=""
                        type="time"
                        value={o.close}
                        onChange={(e) => setPerDayOverrides({ ...perDayOverrides, [day]: { ...o, close: e.target.value } })}
                        mono
                        aria-label={`${label} closes`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard>
            <SectionLabel>Prices</SectionLabel>
            {pricingRules.map((rule) => (
              <div key={rule.id} className="border border-owner-border rounded-[10px] p-4 flex flex-col gap-3">
                <div className="flex items-end gap-3">
                  <Field label="Name" value={rule.name} onChange={(e) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, name: e.target.value } : r)))} />
                  {pricingRules.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setPricingRules(pricingRules.filter((r) => r.id !== rule.id))}
                      className="pb-3 text-[12.5px] font-medium text-owner-danger"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Field
                    label="Per slot (PKR)"
                    value={rule.pricePerSlot}
                    onChange={(e) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, pricePerSlot: e.target.value.replace(/\D/g, "") } : r)))}
                    inputMode="numeric"
                    placeholder="2500"
                    mono
                  />
                  <Field
                    label="From (optional)"
                    type="time"
                    value={rule.startTime ?? ""}
                    onChange={(e) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, startTime: e.target.value || null } : r)))}
                    mono
                  />
                  <Field
                    label="To (optional)"
                    type="time"
                    value={rule.endTime ?? ""}
                    onChange={(e) => setPricingRules(pricingRules.map((r) => (r.id === rule.id ? { ...r, endTime: e.target.value || null } : r)))}
                    mono
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPricingRules([...pricingRules, makeRule()])}
              className="self-start min-h-10 px-3 rounded-lg border border-owner-border text-[13px] font-semibold text-owner-accent"
            >
              + Add a rate
            </button>
          </SectionCard>

          {saveMessage ? (
            <p role="alert" className={`text-[13.5px] font-semibold ${saveMessage.kind === "ok" ? "text-owner-accent" : "text-owner-danger"}`}>
              {saveMessage.text}
            </p>
          ) : null}
          <PrimaryButton label="Save changes" onClick={handleSave} busy={saving} />

          <SectionCard>
            <SectionLabel>Blackout dates</SectionLabel>
            {(blackoutsQuery.data ?? []).length === 0 ? (
              <p className="text-owner-ink-faint text-[13px]">No blackout dates yet.</p>
            ) : (
              (blackoutsQuery.data ?? []).map((b) => (
                <div key={b.id} className="border border-owner-border rounded-[10px] p-3">
                  <p className="text-sm font-semibold">{b.title ?? "Blocked"}</p>
                  <p className="font-mono text-xs text-owner-ink-faint mt-0.5">
                    {new Date(b.starts_at).toLocaleString()} → {new Date(b.ends_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
            <div className="h-px bg-owner-border-light" />
            <FieldLabel>Add a blackout</FieldLabel>
            <div className="flex flex-wrap gap-3">
              <Field label="Title (optional)" value={blackoutTitle} onChange={(e) => setBlackoutTitle(e.target.value)} placeholder="Maintenance" />
              <Field label="Starts at" type="datetime-local" value={blackoutStart} onChange={(e) => setBlackoutStart(e.target.value)} mono />
              <Field label="Ends at" type="datetime-local" value={blackoutEnd} onChange={(e) => setBlackoutEnd(e.target.value)} mono />
            </div>
            {blackoutError ? (
              <p role="alert" className="text-[13px] font-semibold text-owner-danger">
                {blackoutError}
              </p>
            ) : null}
            <PrimaryButton label="Add blackout" onClick={handleAddBlackout} busy={addingBlackout} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
