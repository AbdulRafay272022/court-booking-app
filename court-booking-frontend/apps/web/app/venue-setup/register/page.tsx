"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SPORT_OPTIONS, useVenueSetupStore } from "@/lib/venue-setup-store";
import { useAuthStore } from "@/lib/auth-store";
import { Chip, Field, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, Stepper } from "@/components/setup/ui";
import { CancellationPolicyFields } from "@/components/setup/cancellation-policy-fields";

export default function VenueRegisterPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const store = useVenueSetupStore();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  function handleUseLocation() {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("This browser can't share a location — you can enter the address manually below.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        store.setField("latitude", pos.coords.latitude);
        store.setField("longitude", pos.coords.longitude);
        setLocating(false);
      },
      () => {
        setLocationError("Location permission denied or unavailable — you can still enter the address manually below.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  const isValid =
    store.name.trim().length > 0 &&
    store.address.trim().length > 0 &&
    store.area.trim().length > 0 &&
    store.sports.length > 0 &&
    store.latitude !== null &&
    store.longitude !== null;

  return (
    <>
      <Stepper current={1} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-tight">Tell us about your venue</h1>
        <p className="text-owner-ink-muted text-[15px]">This is what players will see. You can change any of it later.</p>
      </div>

      <SectionCard>
        <SectionLabel>The basics</SectionLabel>
        <Field label="Venue name" value={store.name} onChange={(e) => store.setField("name", e.target.value)} placeholder="Padel Republic" />

        <div className="flex flex-col gap-2">
          <FieldLabel>Mobile number</FieldLabel>
          <div className="h-12 px-3.5 rounded-[9px] bg-owner-bg border border-owner-border flex items-center gap-2.5">
            <span className="font-[family-name:var(--font-mono-x)] text-[15px] flex-1">{user?.phone}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-owner-success-soft text-owner-success-dark">VERIFIED</span>
          </div>
        </div>

        <Field
          label="WhatsApp for bookings (if different)"
          value={store.whatsapp}
          onChange={(e) => store.setField("whatsapp", e.target.value)}
          placeholder="Same as above"
          inputMode="tel"
          mono
        />

        <div className="flex flex-col gap-2">
          <FieldLabel>Sports you offer</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {SPORT_OPTIONS.map((sport) => (
              <Chip key={sport} label={sport} selected={store.sports.includes(sport)} onClick={() => store.toggleSport(sport)} />
            ))}
          </div>
        </div>

        <Field label="Street address" value={store.address} onChange={(e) => store.setField("address", e.target.value)} placeholder="Khayaban-e-Shahbaz, DHA Phase 6" />
        <Field label="Area" value={store.area} onChange={(e) => store.setField("area", e.target.value)} placeholder="DHA Phase 6" />

        <div className="flex flex-col gap-2">
          <FieldLabel>Pin your location so players can find the gate</FieldLabel>
          <SecondaryButton
            label={locating ? "Locating…" : store.latitude ? "Update my location" : "Use my current location"}
            onClick={handleUseLocation}
          />
          {store.latitude !== null && store.longitude !== null ? (
            <p className="font-[family-name:var(--font-mono-x)] text-[12.5px] font-medium text-owner-success-dark">
              Pinned · {store.latitude.toFixed(5)}, {store.longitude.toFixed(5)}
            </p>
          ) : null}
          {locationError ? <p className="text-[12.5px] font-medium text-owner-warn">{locationError}</p> : null}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionLabel>Where players send payment</SectionLabel>
        <p className="text-[12.5px] leading-[18px] font-medium text-owner-ink-faint">
          Players pay you directly. Maidan never holds your money — we only check that the screenshot matches what&apos;s owed.
          You can add this later if you&apos;d rather skip it for now.
        </p>
        <Field label="Bank name" value={store.bankName} onChange={(e) => store.setField("bankName", e.target.value)} placeholder="Meezan Bank" />
        <Field label="Account title" value={store.accountTitle} onChange={(e) => store.setField("accountTitle", e.target.value)} placeholder="Padel Republic" />
        <Field label="Account number" value={store.accountNumber} onChange={(e) => store.setField("accountNumber", e.target.value)} placeholder="PK00 MEZN 0000 0000 0000" mono />
      </SectionCard>

      <CancellationPolicyFields
        allowed={store.cancellationAllowed}
        cutoffHours={store.cancellationCutoffHours}
        onAllowedChange={(v) => store.setField("cancellationAllowed", v)}
        onCutoffChange={(v) => store.setField("cancellationCutoffHours", v)}
      />

      <div className="bg-owner-warn-soft border border-owner-warn-soft-border rounded-2xl p-5 flex flex-col gap-1.5">
        <p className="font-bold text-owner-warn-dark text-[14.5px]">Free while we&apos;re building</p>
        <p className="font-medium text-owner-warn text-[13px] leading-[19px]">
          Early venues in DHA and Clifton keep the Pro plan free permanently. No card, no contract.
        </p>
      </div>

      <p className="text-[13px] font-medium text-owner-ink-faint">
        Everything here can be edited after you go live. Your progress is saved on this device as you type.
      </p>
      <div className="flex gap-3">
        <SecondaryButton label="Save and finish later" onClick={() => router.push("/")} />
        <PrimaryButton label="Next: courts & pricing" ready={isValid} onClick={() => router.push("/venue-setup/courts")} />
      </div>
    </>
  );
}
