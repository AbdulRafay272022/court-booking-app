import type { ReactNode } from "react";
import { Button } from "@/components/site/button";
import { Badge, Container, Eyebrow, FaqItem, SectionTitle } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n";

const WRAP = "mx-auto w-full max-w-[1248px] px-6 pb-6 pt-[88px]";

/* ---------- How it works ---------- */

const STEPS: { n: string; title: MessageKey; body: MessageKey }[] = [
  { n: "01", title: "home.how.s1.title", body: "home.how.s1.body" },
  { n: "02", title: "home.how.s2.title", body: "home.how.s2.body" },
  { n: "03", title: "home.how.s3.title", body: "home.how.s3.body" },
];

export async function HowItWorks() {
  const t = await getT();
  return (
    <section id="how" aria-labelledby="how-title" className={WRAP}>
      <Eyebrow>{t("home.how.eyebrow")}</Eyebrow>
      <SectionTitle id="how-title" className="mt-3">{t("home.how.title")}</SectionTitle>
      <ol className="m-0 mt-10 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-5 p-0">
        {STEPS.map((s) => (
          <li key={s.n} className="khelo-card rounded-3xl bg-khelo-surface p-[30px]">
            <div aria-hidden="true" className="font-khelo-display text-[64px] font-extrabold leading-none text-khelo-orange-text">{s.n}</div>
            <h3 className="mt-4 text-[22px] font-extrabold">{t(s.title)}</h3>
            <p className="mt-2.5 leading-[1.6] text-khelo-muted">{t(s.body)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Features ---------- */

function Icon({ children, stroke = "var(--color-khelo-teal)" }: { children: ReactNode; stroke?: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function FeatureCard({ icon, title, body, tone = "light" }: { icon: ReactNode; title: string; body: string; tone?: "light" | "orange" }) {
  return (
    <div className={`khelo-card rounded-[28px] p-8 ${tone === "orange" ? "bg-khelo-orange" : "bg-khelo-surface"}`}>
      {icon}
      <h3 className="mt-[18px] text-2xl font-extrabold">{title}</h3>
      <p className={`mt-2 leading-[1.6] ${tone === "orange" ? "text-khelo-ink opacity-[.82]" : "text-khelo-muted"}`}>{body}</p>
    </div>
  );
}

export async function Features() {
  const t = await getT();
  return (
    <section id="features" aria-labelledby="features-title" className={WRAP}>
      <Eyebrow>{t("home.features.eyebrow")}</Eyebrow>
      <SectionTitle id="features-title" className="mt-3 max-w-[720px]">{t("home.features.title")}</SectionTitle>
      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
        <div className="khelo-card rounded-[28px] bg-khelo-ink p-8 text-white">
          <h3 className="text-2xl font-extrabold">{t("home.features.chat.title")}</h3>
          <p className="mb-[22px] mt-2 leading-[1.6] text-white/[.72]">{t("home.features.chat.body")}</p>
          <div className="flex flex-col gap-2.5 text-[14px]">
            <div className="max-w-[85%] self-end rounded-[18px_18px_4px_18px] bg-khelo-orange px-4 py-[11px] font-semibold text-khelo-ink">{t("home.features.chat.m1")}</div>
            <div className="max-w-[85%] self-start rounded-[18px_18px_18px_4px] bg-white/10 px-4 py-[11px]">{t("home.features.chat.m2")}</div>
            <div className="self-end rounded-[18px_18px_4px_18px] bg-khelo-orange px-4 py-[11px] font-semibold text-khelo-ink">{t("home.features.chat.m3")}</div>
          </div>
        </div>
        <FeatureCard
          icon={<Icon><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>}
          title={t("home.features.calendar.title")}
          body={t("home.features.calendar.body")}
        />
        <FeatureCard
          icon={<Icon><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M7 15h4" /></Icon>}
          title={t("home.features.payment.title")}
          body={t("home.features.payment.body")}
        />
        <FeatureCard
          tone="orange"
          icon={<Icon stroke="var(--color-khelo-ink)"><path d="M12 21s-7-4.500-9-9.200C1.700 8 4 5 7 5c2 0 3.500 1 5 3 1.500-2 3-3 5-3 3 0 5.300 3 4 6.800-2 4.700-9 9.200-9 9.200z" /></Icon>}
          title={t("home.features.favorites.title")}
          body={t("home.features.favorites.body")}
        />
        <FeatureCard
          icon={<Icon><path d="M12 3l2.800 5.700 6.200.9-4.500 4.400 1.100 6.200L12 17.200 6.400 20.200l1.100-6.200L3 9.600l6.200-.9z" /></Icon>}
          title={t("home.features.reviews.title")}
          body={t("home.features.reviews.body")}
        />
        <FeatureCard
          icon={<Icon><path d="M6 9a6 6 0 0112 0c0 6 2.500 7 2.500 7h-17S6 15 6 9zM10 20a2 2 0 004 0" /></Icon>}
          title={t("home.features.alerts.title")}
          body={t("home.features.alerts.body")}
        />
      </div>
    </section>
  );
}

/* ---------- Owners ---------- */

const OWNER_POINTS: MessageKey[] = ["home.owners.p1", "home.owners.p2", "home.owners.p3"];
const BARS: { h: number; on: boolean }[] = [
  { h: 40, on: false }, { h: 55, on: false }, { h: 35, on: false }, { h: 70, on: false }, { h: 100, on: true }, { h: 85, on: true }, { h: 60, on: false },
];

export async function Owners() {
  const t = await getT();
  return (
    <section id="owners" aria-labelledby="owners-title" className="mt-[88px] bg-khelo-teal text-white">
      <Container className="flex flex-wrap items-center gap-14 py-[88px]">
        <div className="min-w-0 flex-[1_1_420px]">
          <div className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-khelo-mint-text">{t("home.owners.eyebrow")}</div>
          <h2 id="owners-title" className="mt-3 font-khelo-display text-[36px] font-extrabold leading-[1.03] tracking-[-1.5px] min-[761px]:text-[52px]">{t("home.owners.title")}</h2>
          <p className="mt-[22px] max-w-[520px] text-[18px] leading-[1.65] text-white/[.88]">
            {t("home.owners.sub")}
          </p>
          <ul className="m-0 mt-7 flex list-none flex-col gap-3.5 p-0 text-[16px] font-semibold">
            {OWNER_POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span aria-hidden="true" className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-khelo-orange">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-khelo-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                </span>
                {t(p)}
              </li>
            ))}
          </ul>
          <Button href="/for-owners" size="lg" className="mt-[34px]">{t("home.owners.cta")}</Button>
        </div>

        <div className="min-w-0 flex-[1_1_380px]">
          <div className="rounded-[28px] bg-khelo-surface p-[26px] text-khelo-ink shadow-[0_30px_60px_rgba(0,0,0,.25)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-khelo-display text-[22px] font-extrabold">{t("home.owners.mock.title")}</div>
              <Badge tone="mint" className="px-2.5 py-[5px] text-[11px] !font-bold">{t("home.owners.mock.sample")}</Badge>
            </div>
            <div className="mt-[18px] grid grid-cols-3 gap-2.5">
              {[
                { l: t("home.owners.mock.today"), v: "12", c: "" },
                { l: t("home.owners.mock.week"), v: "67", c: "" },
                { l: t("home.owners.mock.pending"), v: "3", c: "text-khelo-orange-text" },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl bg-khelo-page p-3.5">
                  <div className="text-[11px] font-semibold text-khelo-muted-2">{s.l}</div>
                  <div className={`text-2xl font-extrabold ${s.c}`}>{s.v}</div>
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="mt-3.5 flex h-[90px] items-end gap-2 px-1">
              {BARS.map((b, i) => (
                <div key={i} style={{ height: `${b.h}%` }} className={`flex-1 rounded-lg ${b.on ? "bg-khelo-teal" : "bg-khelo-chart"}`} />
              ))}
            </div>
            <div className="mt-[18px] rounded-[18px] border-[1.5px] border-khelo-orange bg-khelo-warm-2 p-4">
              <div className="text-[12px] font-extrabold tracking-[.5px] text-khelo-orange-label">{t("home.owners.mock.tipLabel")}</div>
              <div className="mt-1.5 font-bold leading-[1.5]">{t("home.owners.mock.tip")}</div>
              <div aria-hidden="true" className="mt-3 flex gap-2">
                <span className="rounded-[10px] bg-khelo-ink px-4 py-2.5 text-[13px] font-bold text-white">{t("home.owners.mock.apply")}</span>
                <span className="rounded-[10px] border-[1.5px] border-khelo-ink px-4 py-2.5 text-[13px] font-bold">{t("home.owners.mock.later")}</span>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ---------- FAQ ---------- */

const FAQS: { q: MessageKey; a: MessageKey }[] = [
  { q: "home.faq.q1", a: "home.faq.a1" },
  { q: "home.faq.q2", a: "home.faq.a2" },
  { q: "home.faq.q3", a: "home.faq.a3" },
  { q: "home.faq.q4", a: "home.faq.a4" },
];

export async function Faq() {
  const t = await getT();
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto w-full max-w-[908px] px-6 pb-6 pt-[88px]">
      <Eyebrow>{t("home.faq.eyebrow")}</Eyebrow>
      <SectionTitle id="faq-title" className="mt-3">{t("home.faq.title")}</SectionTitle>
      <div className="mt-8 flex flex-col gap-3">
        {FAQS.map((f, i) => (
          <FaqItem key={f.q} question={t(f.q)} defaultOpen={i === 0}>
            <p className="m-0">{t(f.a)}</p>
          </FaqItem>
        ))}
      </div>
    </section>
  );
}

/* ---------- Final CTA ---------- */

export async function FinalCta() {
  const t = await getT();
  return (
    <section id="cta" aria-labelledby="cta-title" className="mx-auto w-full max-w-[1248px] px-6 py-[88px]">
      <div className="rounded-[36px] bg-khelo-orange px-6 py-14 text-center text-khelo-ink min-[761px]:px-10 min-[761px]:py-16">
        <h2 id="cta-title" className="m-0 font-khelo-display text-[38px] font-extrabold leading-none tracking-[-1.5px] min-[761px]:text-[60px] min-[761px]:tracking-[-2px]">{t("home.cta.title")}</h2>
        <p className="mx-auto mt-[18px] max-w-[520px] text-[18px] leading-[1.6] opacity-85">{t("home.cta.sub")}</p>
        <div className="mt-[30px] flex flex-wrap justify-center gap-3.5">
          <Button href="/signup" variant="dark" size="lg" className="px-8">{t("home.cta.signup")}</Button>
          <Button href="/for-owners" variant="outlineDark" size="lg" className="border-2 px-8 font-extrabold">{t("home.cta.list")}</Button>
        </div>
      </div>
    </section>
  );
}
