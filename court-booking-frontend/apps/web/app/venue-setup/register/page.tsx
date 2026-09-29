"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CITY_CENTRES, accountNumberError, accountTitleError, bankNameError, type City } from "@court-booking/types";
import { SPORT_OPTIONS, useVenueSetupStore } from "@/lib/venue-setup-store";
import { useAuthStore } from "@/lib/auth-store";
import { Chip, Field, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, Stepper } from "@/components/setup/ui";
import { AmenitiesPicker } from "@/components/setup/amenities-picker";
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
      setLocationError("This browser can't share a location — use \"Use city centre for now\" below and refine the pin from Venue Settings once you're approved.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        store.setField("latitude", pos.coords.latitude);
        store.setField("longitude", pos.coords.longitude);
        setLocating(false);
        setUsingCityCentre(false);
      },
      () => {
        setLocationError("Location permission denied or unavailable — use \"Use city centre for now\" below and refine the pin from Venue Settings once you're approved.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // QA signup-venue round item 2 (real DoS -- own decision): the wizard's "Next" was hard
  // gated on browser geolocation; a denied permission would leave a legitimate owner with no
  // way through. Fallback is a city-centre pin (CITY_CENTRES for the wizard's `city`), with
  // a visible "we couldn't get an exact location" notice on the register screen AND on Venue
  // Settings so it stays visible until they refine it. Decision made here rather than adding
  // a geocoding provider dependency; flagged in the round's report.
  const [usingCityCentre, setUsingCityCentre] = useState(false);
  function handleUseCityCentre() {
    setLocationError(null);
    const cityKey = (user?.city as City | undefined) ?? (store.city.toLowerCase() as City);
    const centre = CITY_CENTRES[cityKey] ?? CITY_CENTRES.karachi;
    store.setField("latitude", centre.latitude);
    store.setField("longitude", centre.longitude);
    setUsingCityCentre(true);
  }

  // Bank details are optional -- but if the owner has typed ANYTHING in that block, ALL of
  // the required bank fields must actually be valid. This stops "!!!" / "abc" / a 3-digit
  // account number from saving (QA signup-venue round item 5). The mirror check lives in
  // BankDetailsIn on the backend.
  const bankTouched = !!(store.bankName || store.accountTitle || store.accountNumber);
  const bankErrors = bankTouched
    ? {
        bank: bankNameError(store.bankName),
        title: accountTitleError(store.accountTitle),
        number: accountNumberError(store.accountNumber),
      }
    : { bank: null, title: null, number: null };
  const bankValid = !bankTouched || (!bankErrors.bank && !bankErrors.title && !bankErrors.number);

  const isValid =
    store.name.trim().length > 0 &&
    store.address.trim().length > 0 &&
    store.area.trim().length > 0 &&
    store.sports.length > 0 &&
    store.latitude !== null &&
    store.longitude !== null &&
    bankValid;

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

        <AmenitiesPicker value={store.amenities ?? []} onToggle={store.toggleAmenity} />

        <Field label="Street address" value={store.address} onChange={(e) => store.setField("address", e.target.value)} placeholder="Khayaban-e-Shahbaz, DHA Phase 6" />
        <Field label="Area" value={store.area} onChange={(e) => store.setField("area", e.target.value)} placeholder="DHA Phase 6" />

        <div className="flex flex-col gap-2">
          <FieldLabel>Pin your location so players can find the gate</FieldLabel>
          <SecondaryButton
            label={locating ? "Locating…" : store.latitude && !usingCityCentre ? "Update my location" : "Use my current location"}
            onClick={handleUseLocation}
          />
          {store.latitude !== null && store.longitude !== null ? (
            <p className={`font-[family-name:var(--font-mono-x)] text-[12.5px] font-medium ${usingCityCentre ? "text-owner-warn" : "text-owner-success-dark"}`}>
              Pinned · {store.latitude.toFixed(5)}, {store.longitude.toFixed(5)}
              {usingCityCentre ? " (city centre — refine later)" : ""}
            </p>
          ) : null}
          {locationError ? <p className="text-[12.5px] font-medium text-owner-warn">{locationError}</p> : null}
          {/* Fallback path -- always available so an owner who can't or won't share location can
              still finish the wizard. See item 2 of the QA round. */}
          {store.latitude === null || locationError ? (
            <button
              type="button"
              onClick={handleUseCityCentre}
              className="self-start text-[13px] font-semibold text-owner-accent underline"
            >
              Use city centre for now — refine from Venue Settings
            </button>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionLabel>Where players send payment</SectionLabel>
        <p className="text-[12.5px] leading-[18px] font-medium text-owner-ink-faint">
          Players pay you directly. Maidan never holds your money — we only check that the screenshot matches what&apos;s owed.
          You can add this later if you&apos;d rather skip it for now.
        </p>
        <Field label="Bank name" value={store.bankName} onChange={(e) => store.setField("bankName", e.target.value)} placeholder="Meezan Bank" error={bankTouched && store.bankName ? bankErrors.bank : null} />
        <Field label="Account title" value={store.accountTitle} onChange={(e) => store.setField("accountTitle", e.target.value)} placeholder="Padel Republic" error={bankTouched && store.accountTitle ? bankErrors.title : null} />
        <Field label="Account number" value={store.accountNumber} onChange={(e) => store.setField("accountNumber", e.target.value)} placeholder="03445551234 or 12345678901234" inputMode="numeric" mono error={bankTouched && store.accountNumber ? bankErrors.number : null} />
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
