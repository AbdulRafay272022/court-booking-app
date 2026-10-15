"use client";

import { SPORT_OPTIONS } from "@court-booking/types";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { Chip, Field, FieldLabel, SectionCard } from "./ui";

/** Name, sport and indoor/outdoor for ONE court -- shared by the wizard's court tab and Venue settings' court tab.
 * `sportOptions` are the sports to pick from (the venue's own sports when it has any); the court's current sport is
 * always offered so an old value never vanishes from the chips. */
export function CourtBasicsFields({
  name,
  sport,
  isIndoor,
  onChange,
  sportOptions,
  note,
}: {
  name: string;
  sport: string;
  isIndoor: boolean;
  onChange: (patch: { name?: string; sport?: string; isIndoor?: boolean }) => void;
  sportOptions?: readonly string[];
  note?: string;
}) {
  const t = useT();
  const fmt = useFmt();
  const base = sportOptions && sportOptions.length > 0 ? sportOptions : SPORT_OPTIONS;
  const options = base.some((s) => s.toLowerCase() === sport.toLowerCase()) || !sport ? [...base] : [...base, sport];
  return (
    <SectionCard>
      <Field label={t("setup.court.name")} value={name} onChange={(e) => onChange({ name: e.target.value })} data-testid="court-name" />
      <div className="flex flex-col gap-2">
        <FieldLabel>{t("setup.court.sport")}</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {options.map((s) => (
            <Chip key={s} label={fmt.sport(s)} selected={s.toLowerCase() === sport.toLowerCase()} onClick={() => onChange({ sport: s })} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>{t("setup.court.setting")}</FieldLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("setup.court.settingAria")}>
          {[
            { label: fmt.setting("outdoor"), value: false },
            { label: fmt.setting("indoor"), value: true },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={isIndoor === o.value}
              onClick={() => onChange({ isIndoor: o.value })}
              className={`min-h-10 px-4 rounded-full whitespace-nowrap text-[13.5px] font-semibold border ${
                isIndoor === o.value ? "bg-owner-accent text-white border-owner-accent" : "bg-owner-surface text-owner-ink-muted border-owner-border"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {note ? <p className="text-[12.5px] font-medium text-owner-ink-faint">{note}</p> : null}
    </SectionCard>
  );
}
