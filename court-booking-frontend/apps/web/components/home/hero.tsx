import { Button } from "@/components/site/button";
import { Container } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";
import type { TFunction } from "@/lib/i18n";

type SlotState = "free" | "booked" | "mine";
const SLOTS: { t: string; s: SlotState }[] = [
  { t: "6:00 PM", s: "free" },
  { t: "7:00 PM", s: "booked" },
  { t: "8:00 PM", s: "mine" },
  { t: "9:00 PM", s: "free" },
  { t: "10:00 PM", s: "booked" },
  { t: "11:00 PM", s: "free" },
];
const SLOT_CLASS: Record<SlotState, string> = {
  free: "bg-khelo-surface text-khelo-ink border-khelo-border",
  booked: "bg-khelo-booked-bg text-khelo-booked-text border-khelo-booked-bg",
  mine: "bg-khelo-orange text-khelo-ink border-khelo-orange",
};

/** The phone illustration: static and decorative (a sample venue and sample slots, not real data). */
function PhoneMock({ t }: { t: TFunction }) {
  return (
    <div aria-hidden="true" className="box-border w-[320px] max-w-full rounded-[40px] border-[6px] border-khelo-frame bg-khelo-surface p-3.5 text-khelo-ink shadow-[0_40px_80px_rgba(0,0,0,.45)]">
      <div className="rounded-[28px] bg-khelo-page px-[18px] pb-[22px] pt-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-khelo-muted-2">DHA Phase 6</div>
            <div className="font-khelo-display text-[22px] font-extrabold">Test Arena One</div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-khelo-surface">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-khelo-orange)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-4.5-9-9.2C1.7 8 4 5 7 5c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3 0 5.300 3 4 6.800-2 4.700-9 9.200-9 9.200z" />
            </svg>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <span className="rounded-full bg-khelo-ink px-3.5 py-2 text-[12px] font-bold text-white">Futsal</span>
          <span className="rounded-full bg-khelo-surface px-3.5 py-2 text-[12px] font-bold">Padel</span>
        </div>
        <div className="mt-[18px] text-[12px] font-bold text-khelo-muted-2">{t("home.hero.mock.tonight")}</div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {SLOTS.map((s) => (
            <div key={s.t} className={`rounded-xl border-[1.5px] py-3 text-center text-[13px] font-bold ${SLOT_CLASS[s.s]}`}>
              {s.t}
            </div>
          ))}
        </div>
        <div className="mt-3.5 flex gap-3.5 text-[11px] font-semibold text-khelo-muted-2">
          <span><span className="mr-[5px] inline-block h-[9px] w-[9px] rounded-[3px] border-[1.5px] border-khelo-border bg-khelo-surface" />{t("home.hero.mock.free")}</span>
          <span><span className="mr-[5px] inline-block h-[9px] w-[9px] rounded-[3px] bg-khelo-booked-bg" />{t("home.hero.mock.booked")}</span>
          <span><span className="mr-[5px] inline-block h-[9px] w-[9px] rounded-[3px] bg-khelo-orange" />{t("home.hero.mock.yours")}</span>
        </div>
        <div className="mt-[18px] flex items-center justify-between rounded-2xl bg-khelo-ink px-4 py-3.5 text-white">
          <div>
            <div className="text-[11px] text-white/65">{t("home.hero.mock.summary")}</div>
            <div className="text-[18px] font-extrabold">{t("home.hero.mock.price")}</div>
          </div>
          <div className="rounded-xl bg-khelo-orange px-4 py-[11px] text-[13px] font-extrabold text-khelo-ink">{t("home.hero.mock.continue")}</div>
        </div>
      </div>
    </div>
  );
}

export async function Hero() {
  const t = await getT();
  return (
    <section id="top" className="relative overflow-hidden bg-khelo-ink text-white">
      <svg aria-hidden="true" width="1400" height="760" viewBox="0 0 1400 760" fill="none" className="pointer-events-none absolute -right-[260px] -top-10 opacity-[.12]">
        <rect x="200" y="100" width="1000" height="560" rx="24" stroke="white" strokeWidth="3" />
        <line x1="700" y1="100" x2="700" y2="660" stroke="white" strokeWidth="3" />
        <circle cx="700" cy="380" r="110" stroke="white" strokeWidth="3" />
        <rect x="200" y="260" width="150" height="240" stroke="white" strokeWidth="3" />
        <rect x="1050" y="260" width="150" height="240" stroke="white" strokeWidth="3" />
      </svg>
      <Container className="relative flex flex-wrap items-center gap-12 pb-[88px] pt-14">
        <div className="min-w-0 flex-[1_1_440px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[.18] bg-white/[.08] px-4 py-2 text-[13px] font-semibold">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-khelo-success" />
            {t("home.hero.badge")}
          </div>
          <h1 className="mt-6 font-khelo-display text-[46px] font-extrabold leading-[.98] tracking-[-1.5px] min-[761px]:text-[76px] min-[761px]:tracking-[-2.5px]">
            {t("home.hero.title1")}
            <br />
            {t("home.hero.title2")}
            <br />
            <span className="text-khelo-orange">{t("home.hero.title3")}</span>
          </h1>
          <p className="mt-[26px] max-w-[520px] text-[19px] leading-[1.6] text-white/[.78]">
            {t("home.hero.sub")}
          </p>
          <div className="mt-[34px] flex flex-wrap gap-3.5">
            <Button href="/search" size="lg">{t("home.hero.cta.book")}</Button>
            <Button href="#how" variant="outline" size="lg">{t("home.hero.cta.how")}</Button>
          </div>
          <div className="mt-[38px] flex flex-wrap gap-[22px] text-[14px] font-semibold text-white/70">
            <span>{t("home.hero.point.ai")}</span>
            <span>{t("home.hero.point.whatsapp")}</span>
            <span>{t("home.hero.point.calendar")}</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] justify-center">
          <PhoneMock t={t} />
        </div>
      </Container>
    </section>
  );
}
