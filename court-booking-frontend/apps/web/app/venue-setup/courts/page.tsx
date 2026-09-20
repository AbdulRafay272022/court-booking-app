"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { PricingRuleInput, ScheduleTemplateInput } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { DAY_LABELS, SLOT_MINUTES_OPTIONS, SPORT_OPTIONS, useVenueSetupStore } from "@/lib/venue-setup-store";
import { Chip, Field, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, Stepper } from "@/components/setup/ui";

/** "HH:MM" from an <input type="time"> -> "HH:MM:SS" for the API. */
function toTimeString(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : "06:00:00";
}

export default function VenueCourtsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pricedRules = store.pricingRules.filter((r) => Number(r.pricePerSlot) > 0);
  const isValid = store.courts.length > 0 && store.courts.every((c) => c.name.trim()) && pricedRules.length > 0;

  function buildSchedules(): ScheduleTemplateInput[] {
    return Array.from({ length: 7 }, (_, day) => {
      const o = store.sameHoursEveryDay ? undefined : store.perDayOverrides[day];
      return {
        day_of_week: day,
        open_time: toTimeString(o?.open ?? store.defaultOpenTime),
        close_time: toTimeString(o?.close ?? store.defaultCloseTime),
      };
    });
  }

  function buildPricingRules(): PricingRuleInput[] {
    return pricedRules.map((r, i) => ({
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
    setSubmitting(true);
    setError(null);
    try {
      // Same idempotency pattern as mobile: remember the venue once POST /venues succeeds, so a
      // retry after a later step fails doesn't create a duplicate venue.
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
      const cutoffHours = store.cancellationCutoffHours.trim() ? Number(store.cancellationCutoffHours) : null;
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
            cancellation_allowed: store.cancellationAllowed,
            cancellation_cutoff_hours: store.cancellationAllowed ? cutoffHours : null,
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        }
        await api.courts.setSchedule(courtId, schedules);
        await api.courts.setPricing(courtId, pricingRules);
      }

      store.reset();
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      router.replace(`/venue-setup/status?venueId=${venueId}`);
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stepper current={2} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-tight">Your courts and prices</h1>
        <p className="text-owner-ink-muted text-[15px]">Set your hours once and we build the whole schedule for you.</p>
      </div>

      <SectionCard>
        <div className="flex items-center justify-between">
          <SectionLabel>Courts</SectionLabel>
          <button type="button" onClick={store.addCourt} className="min-h-9 px-3 rounded-lg border border-owner-border text-[13px] font-semibold text-owner-accent">
            + Add a court
          </button>
        </div>
        {store.courts.map((court, index) => (
          <div key={index} className="border border-owner-border rounded-[10px] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Court {index + 1}</p>
              {store.courts.length > 1 ? (
                <button type="button" onClick={() => store.removeCourt(index)} className="text-[12.5px] font-medium text-owner-danger">
                  Remove
                </button>
              ) : null}
            </div>
            <Field label="Name" value={court.name} onChange={(e) => store.updateCourt(index, { name: e.target.value })} />
            <div className="flex flex-col gap-2">
              <FieldLabel>Sport</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {SPORT_OPTIONS.map((sport) => (
                  <Chip key={sport} label={sport} selected={court.sport === sport} onClick={() => store.updateCourt(index, { sport })} />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel>Slot length</FieldLabel>
              <div className="flex gap-2">
                {SLOT_MINUTES_OPTIONS.map((m) => (
                  <Chip key={m} label={`${m} min`} selected={court.slotMinutes === m} onClick={() => store.updateCourt(index, { slotMinutes: m })} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </SectionCard>

      <SectionCard>
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Opening hours</SectionLabel>
          <button
            type="button"
            onClick={() => store.setField("sameHoursEveryDay", !store.sameHoursEveryDay)}
            className="text-[13px] font-semibold text-owner-accent"
          >
            {store.sameHoursEveryDay ? "Set different hours per day" : "Use same hours every day"}
          </button>
        </div>
        <p className="text-[12.5px] font-medium text-owner-ink-faint">Times are Pakistan time (PKT).</p>

        {store.sameHoursEveryDay ? (
          <div className="flex gap-3">
            <Field label="Opens" type="time" value={store.defaultOpenTime} onChange={(e) => store.setField("defaultOpenTime", e.target.value)} mono />
            <Field label="Closes" type="time" value={store.defaultCloseTime} onChange={(e) => store.setField("defaultCloseTime", e.target.value)} mono />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {DAY_LABELS.map((label, day) => {
              const o = store.perDayOverrides[day] ?? { open: store.defaultOpenTime, close: store.defaultCloseTime };
              return (
                <div key={day} className="flex items-end gap-3">
                  <span className="text-sm font-medium w-10 pb-3">{label}</span>
                  <Field label="" type="time" value={o.open} onChange={(e) => store.setDayOverride(day, { ...o, open: e.target.value })} mono aria-label={`${label} opens`} />
                  <Field label="" type="time" value={o.close} onChange={(e) => store.setDayOverride(day, { ...o, close: e.target.value })} mono aria-label={`${label} closes`} />
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <SectionLabel>Prices</SectionLabel>
        {store.pricingRules.map((rule) => (
          <div key={rule.id} className="border border-owner-border rounded-[10px] p-4 flex flex-col gap-3">
            <div className="flex items-end gap-3">
              <Field label="Name" value={rule.name} onChange={(e) => store.updatePricingRule(rule.id, { name: e.target.value })} />
              {store.pricingRules.length > 1 ? (
                <button type="button" onClick={() => store.removePricingRule(rule.id)} className="pb-3 text-[12.5px] font-medium text-owner-danger">
                  Remove
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Field
                label="Per slot (PKR)"
                value={rule.pricePerSlot}
                onChange={(e) => store.updatePricingRule(rule.id, { pricePerSlot: e.target.value.replace(/\D/g, "") })}
                inputMode="numeric"
                placeholder="2500"
                mono
              />
              <Field label="From (optional)" type="time" value={rule.startTime ?? ""} onChange={(e) => store.updatePricingRule(rule.id, { startTime: e.target.value || null })} mono />
              <Field label="To (optional)" type="time" value={rule.endTime ?? ""} onChange={(e) => store.updatePricingRule(rule.id, { endTime: e.target.value || null })} mono />
            </div>
          </div>
        ))}
        <button type="button" onClick={store.addPricingRule} className="self-start min-h-10 px-3 rounded-lg border border-owner-border text-[13px] font-semibold text-owner-accent">
          + Add a peak-hours rule
        </button>
      </SectionCard>

      <SectionCard>
        <SectionLabel>Cancellations</SectionLabel>
        <p className="text-[13px] font-medium text-owner-ink-faint">Can a player cancel a booking after they&apos;ve already paid?</p>
        <div className="flex gap-2">
          <Chip label="Allowed" selected={store.cancellationAllowed} onClick={() => store.setField("cancellationAllowed", true)} />
          <Chip label="Not allowed" selected={!store.cancellationAllowed} onClick={() => store.setField("cancellationAllowed", false)} />
        </div>
        {store.cancellationAllowed ? (
          <Field
            label="Require cancelling at least this many hours before (optional)"
            value={store.cancellationCutoffHours}
            onChange={(e) => store.setField("cancellationCutoffHours", e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Leave blank for no limit"
            mono
          />
        ) : null}
      </SectionCard>

      {error ? (
        <p role="alert" className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border text-owner-danger text-[13.5px] font-semibold px-4 py-3">
          Couldn&apos;t send for review: {error}
        </p>
      ) : null}

      <p className="text-[13px] font-medium text-owner-ink-faint">We&apos;ll review it and come back to you within a day.</p>
      <div className="flex gap-3">
        <SecondaryButton label="Back" onClick={() => router.back()} />
        <PrimaryButton label="Send for review" ready={isValid} busy={submitting} onClick={handleSubmit} />
      </div>
    </>
  );
}
