"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CITY_CENTRES, accountNumberError, accountTitleError, bankNameError, type City } from "@court-booking/types";
import { SPORT_OPTIONS, useVenueSetupStore } from "@/lib/venue-setup-store";
import { useAuthStore } from "@/lib/auth-store";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { Chip, Field, FieldLabel, PrimaryButton, SecondaryButton, SectionCard, SectionLabel, Stepper } from "@/components/setup/ui";
import { AmenitiesPicker } from "@/components/setup/amenities-picker";
import { CancellationPolicyFields } from "@/components/setup/cancellation-policy-fields";

// Sample values shown greyed in empty fields; they are examples, not copy.
const SAMPLE_VENUE = "Padel Republic"; // i18n-ignore
const SAMPLE_ADDRESS = "Khayaban-e-Shahbaz, DHA Phase 6"; // i18n-ignore
const SAMPLE_AREA = "DHA Phase 6"; // i18n-ignore
const SAMPLE_BANK = "Meezan Bank"; // i18n-ignore

export default function VenueRegisterPage() {
  const router = useRouter();
  const t = useT();
  const fmt = useFmt();
  const user = useAuthStore((s) => s.user);
  const store = useVenueSetupStore();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  function handleUseLocation() {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError(t("setup.reg.geoUnsupported"));
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
        setLocationError(t("setup.reg.geoDenied"));
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
        bank: bankNameError(store.bankName) ? fmt.validation(bankNameError(store.bankName)!) : null,
        title: accountTitleError(store.accountTitle) ? fmt.validation(accountTitleError(store.accountTitle)!) : null,
        number: accountNumberError(store.accountNumber) ? fmt.validation(accountNumberError(store.accountNumber)!) : null,
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
        <h1 className="text-[26px] font-bold tracking-tight">{t("setup.reg.title")}</h1>
        <p className="text-owner-ink-muted text-[15px]">{t("setup.reg.subtitle")}</p>
      </div>

      <SectionCard>
        <SectionLabel>{t("setup.reg.basics")}</SectionLabel>
        <Field label={t("setup.reg.venueName")} value={store.name} onChange={(e) => store.setField("name", e.target.value)} placeholder={SAMPLE_VENUE} />

        <div className="flex flex-col gap-2">
          <FieldLabel>{t("setup.reg.mobile")}</FieldLabel>
          <div className="h-12 px-3.5 rounded-[9px] bg-owner-bg border border-owner-border flex items-center gap-2.5">
            <span className="font-[family-name:var(--font-mono-x)] text-[15px] flex-1">{user?.phone}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-owner-success-soft text-owner-success-dark">{t("setup.reg.verified")}</span>
          </div>
        </div>

        <Field
          label={t("setup.reg.whatsapp")}
          value={store.whatsapp}
          onChange={(e) => store.setField("whatsapp", e.target.value)}
          placeholder={t("setup.reg.whatsappPlaceholder")}
          inputMode="tel"
          mono
        />

        <div className="flex flex-col gap-2">
          <FieldLabel>{t("setup.reg.sports")}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {SPORT_OPTIONS.map((sport) => (
              <Chip key={sport} label={fmt.sport(sport)} selected={store.sports.includes(sport)} onClick={() => store.toggleSport(sport)} />
            ))}
          </div>
        </div>

        <AmenitiesPicker value={store.amenities ?? []} onToggle={store.toggleAmenity} />

        <Field label={t("setup.reg.address")} value={store.address} onChange={(e) => store.setField("address", e.target.value)} placeholder={SAMPLE_ADDRESS} />
        <Field label={t("setup.reg.area")} value={store.area} onChange={(e) => store.setField("area", e.target.value)} placeholder={SAMPLE_AREA} />

        <div className="flex flex-col gap-2">
          <FieldLabel>{t("setup.reg.pin")}</FieldLabel>
          <SecondaryButton
            label={locating ? t("setup.reg.locating") : store.latitude && !usingCityCentre ? t("setup.reg.updateLocation") : t("setup.reg.useLocation")}
            onClick={handleUseLocation}
          />
          {store.latitude !== null && store.longitude !== null ? (
            <p className={`font-[family-name:var(--font-mono-x)] text-[12.5px] font-medium ${usingCityCentre ? "text-owner-warn" : "text-owner-success-dark"}`}>
              {t("setup.reg.pinned", { lat: store.latitude.toFixed(5), lng: store.longitude.toFixed(5) })}
              {usingCityCentre ? ` ${t("setup.reg.cityCentreNote")}` : ""}
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
              {t("setup.reg.cityCentre")}
            </button>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionLabel>{t("setup.reg.payTitle")}</SectionLabel>
        <p className="text-[12.5px] leading-[18px] font-medium text-owner-ink-faint">
          {t("setup.reg.payHelp")}
        </p>
        <Field label={t("setup.bank.name")} value={store.bankName} onChange={(e) => store.setField("bankName", e.target.value)} placeholder={SAMPLE_BANK} error={bankTouched && store.bankName ? bankErrors.bank : null} />
        <Field label={t("setup.bank.title")} value={store.accountTitle} onChange={(e) => store.setField("accountTitle", e.target.value)} placeholder={SAMPLE_VENUE} error={bankTouched && store.accountTitle ? bankErrors.title : null} />
        <Field label={t("setup.bank.number")} value={store.accountNumber} onChange={(e) => store.setField("accountNumber", e.target.value)} placeholder={t("setup.bank.numberPlaceholder")} inputMode="numeric" mono error={bankTouched && store.accountNumber ? bankErrors.number : null} />
      </SectionCard>

      <CancellationPolicyFields
        allowed={store.cancellationAllowed}
        cutoffHours={store.cancellationCutoffHours}
        onAllowedChange={(v) => store.setField("cancellationAllowed", v)}
        onCutoffChange={(v) => store.setField("cancellationCutoffHours", v)}
      />

      <div className="bg-owner-warn-soft border border-owner-warn-soft-border rounded-2xl p-5 flex flex-col gap-1.5">
        <p className="font-bold text-owner-warn-dark text-[14.5px]">{t("setup.reg.freeTitle")}</p>
        <p className="font-medium text-owner-warn text-[13px] leading-[19px]">
          {t("setup.reg.freeBody")}
        </p>
      </div>

      <p className="text-[13px] font-medium text-owner-ink-faint">
        {t("setup.reg.savedNote")}
      </p>
      <div className="flex gap-3">
        <SecondaryButton label={t("setup.reg.saveLater")} onClick={() => router.push("/")} />
        <PrimaryButton label={t("setup.reg.next")} ready={isValid} onClick={() => router.push("/venue-setup/courts")} />
      </div>
    </>
  );
}
