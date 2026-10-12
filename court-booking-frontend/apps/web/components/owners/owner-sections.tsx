import type { ReactNode } from "react";
import { Badge, Eyebrow } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n";

const SAMPLE_ROWS: { time: string; court: MessageKey; status: MessageKey; tone: "success" | "warning" | "booked" }[] = [
  { time: "6:00 PM", court: "owners.sample.court1", status: "owners.sample.booked", tone: "success" },
  { time: "7:00 PM", court: "owners.sample.court1", status: "owners.sample.pending", tone: "warning" },
  { time: "8:00 PM", court: "owners.sample.court2", status: "owners.sample.booked", tone: "success" },
  { time: "9:30 PM", court: "owners.sample.court2", status: "owners.sample.free", tone: "booked" },
];

/** The "Aaj ka din" illustration in the hero. Sample data, labeled as such (as designed). */
export async function SampleDayCard() {
  const t = await getT();
  return (
    <div className="rounded-[28px] bg-white p-[26px] text-khelo-ink shadow-[0_30px_60px_rgba(0,0,0,.25)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-khelo-display text-[22px] font-extrabold">{t("owners.sample.title")}</div>
        <Badge tone="mint" className="text-[11px] font-bold">
          {t("owners.sample.badge")}
        </Badge>
      </div>
      <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
        {SAMPLE_ROWS.map((r) => (
          <li key={r.time} className="flex items-center justify-between gap-3 rounded-2xl bg-khelo-page px-4 py-3.5">
            <div>
              <div className="text-[15px] font-extrabold">{r.time}</div>
              <div className="text-[13px] text-khelo-muted-2">{t(r.court)}</div>
            </div>
            <Badge tone={r.tone} className="px-3 py-[7px]">
              {t(r.status)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BENEFITS: { title: MessageKey; body: MessageKey }[] = [
  { title: "owners.why.dashboard.title", body: "owners.why.dashboard.body" },
  { title: "owners.why.approval.title", body: "owners.why.approval.body" },
  { title: "owners.why.growth.title", body: "owners.why.growth.body" },
  { title: "owners.why.pricing.title", body: "owners.why.pricing.body" },
];

function Heading({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={`mt-3 font-khelo-display text-[34px] font-extrabold leading-[1.05] tracking-[-1.5px] md:text-5xl ${className}`}>
      {children}
    </h2>
  );
}

export async function Benefits() {
  const t = await getT();
  return (
    <section aria-labelledby="why-khelo" className="mx-auto w-full max-w-[1248px] px-6 pt-[88px]">
      <Eyebrow>{t("owners.why.eyebrow")}</Eyebrow>
      <Heading id="why-khelo" className="max-w-[760px]">
        {t("owners.why.title")}
      </Heading>
      <ul className="m-0 mt-9 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5 p-0">
        {BENEFITS.map((b) => (
          <li key={b.title} className="khelo-card rounded-3xl bg-white p-[30px]">
            <h3 className="text-[22px] font-extrabold">{t(b.title)}</h3>
            <p className="mt-2.5 leading-[1.6] text-khelo-muted">{t(b.body)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STEPS: { title: MessageKey; body: MessageKey }[] = [
  { title: "owners.steps.s1.title", body: "owners.steps.s1.body" },
  { title: "owners.steps.s2.title", body: "owners.steps.s2.body" },
  { title: "owners.steps.s3.title", body: "owners.steps.s3.body" },
  { title: "owners.steps.s4.title", body: "owners.steps.s4.body" },
];

export async function Steps() {
  const t = await getT();
  return (
    <section id="how" aria-labelledby="get-started" className="mx-auto w-full max-w-[1248px] px-6 pt-24">
      <Eyebrow>{t("owners.steps.eyebrow")}</Eyebrow>
      <Heading id="get-started">{t("owners.steps.title")}</Heading>
      <ol className="m-0 mt-9 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-5 p-0">
        {STEPS.map((s, i) => {
          const last = i === STEPS.length - 1;
          return (
            <li key={s.title} className={`rounded-3xl p-7 ${last ? "bg-khelo-orange text-khelo-ink" : "bg-khelo-ink text-white"}`}>
              <div aria-hidden="true" className={`font-khelo-display text-5xl font-extrabold leading-none ${last ? "" : "text-khelo-orange"}`}>
                {i + 1}
              </div>
              <h3 className="mt-3.5 text-[20px] font-extrabold">
                <span className="sr-only">{t("owners.steps.stepLabel", { n: i + 1 })}</span>
                {t(s.title)}
              </h3>
              <p className={`mt-2 leading-[1.55] ${last ? "opacity-85" : "text-white/70"}`}>{t(s.body)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Pricing block. The caller renders this ONLY when NEXT_PUBLIC_OWNER_PRICING_TEXT is set; `text` is that value. */
export async function PricingBlock({ text, action }: { text: string; action: ReactNode }) {
  const t = await getT();
  return (
    <section aria-labelledby="pricing" className="mx-auto w-full max-w-[1248px] px-6 pt-24">
      <div className="flex flex-wrap items-center justify-between gap-8 rounded-[32px] border-2 border-dashed border-khelo-dash bg-white p-6 md:p-11">
        <div className="min-w-0 flex-[1_1_360px]">
          <Eyebrow>{t("owners.pricingBlock.eyebrow")}</Eyebrow>
          <h2 id="pricing" className="mt-2.5 font-khelo-display text-[28px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[38px] md:leading-[1.05]">
            {text}
          </h2>
          <p className="mt-3 max-w-[520px] leading-[1.6] text-khelo-muted">
            {t("owners.pricingBlock.note")}
          </p>
        </div>
        {action}
      </div>
    </section>
  );
}
