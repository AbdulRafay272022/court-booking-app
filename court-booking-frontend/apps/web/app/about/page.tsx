import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow, SectionTitle } from "@/components/site/primitives";
import { Button } from "@/components/site/button";
import { VALUES } from "@/components/about/about-content";
import { getT } from "@/lib/i18n-server";
import { COMPANY_NAME } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const description = t("about.meta.description", { company: COMPANY_NAME });
  return {
    title: t("about.meta.title"),
    description,
    openGraph: { title: t("about.meta.ogTitle"), description, type: "website" },
  };
}

export default async function AboutPage() {
  const t = await getT();
  const company = COMPANY_NAME;
  return (
    <KheloPage>
      {/* HERO */}
      <section className="bg-khelo-ink text-white">
        <Container className="pb-[72px] pt-12 md:pb-24">
          <Eyebrow tone="orange">{t("about.hero.eyebrow")}</Eyebrow>
          <h1 className="mt-4 max-w-[900px] font-khelo-display text-[40px] font-extrabold leading-none tracking-[-1.4px] md:text-[68px] md:tracking-[-2.2px]">
            {t("about.hero.title")}
          </h1>
          <p className="mt-6 max-w-[640px] text-[17px] leading-[1.65] text-white/80 md:text-[19px]">
            {t("about.hero.sub")}
          </p>
        </Container>
      </section>

      {/* PROBLEM / SOLUTION */}
      <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-6 pt-[88px]">
        <div className="rounded-[28px] bg-khelo-surface p-7 md:p-9">
          <div className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-khelo-orange-label">{t("about.problem.label")}</div>
          <h2 className="mt-3 font-khelo-display text-[30px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[34px]">{t("about.problem.title")}</h2>
          <p className="mt-3.5 leading-[1.7] text-khelo-muted">
            {t("about.problem.body")}
          </p>
        </div>
        <div className="rounded-[28px] bg-khelo-teal p-7 text-white md:p-9">
          <div className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-khelo-mint-text">{t("about.solution.label")}</div>
          <h2 className="mt-3 font-khelo-display text-[30px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[34px]">{t("about.solution.title")}</h2>
          <p className="mt-3.5 leading-[1.7] text-white/90">
            {t("about.solution.body")}
          </p>
        </div>
      </Container>

      {/* VALUES */}
      <Container className="pt-24">
        <Eyebrow>{t("about.values.eyebrow")}</Eyebrow>
        <SectionTitle className="mt-3">{t("about.values.title")}</SectionTitle>
        <ul className="mt-9 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-5 p-0">
          {VALUES.map((v) => (
            <li key={v.title} className="khelo-card rounded-[24px] bg-khelo-surface p-[30px]">
              <h3 className="text-[22px] font-extrabold">{t(v.title)}</h3>
              <p className="mt-2.5 leading-[1.6] text-khelo-muted">{t(v.body)}</p>
            </li>
          ))}
        </ul>
      </Container>

      {/* STORY / FOUNDER */}
      <Container className="flex flex-wrap items-stretch gap-10 pt-24">
        <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-khelo-ink p-7 text-white md:p-11">
          <Eyebrow tone="orange">{t("about.story.eyebrow")}</Eyebrow>
          <h2 className="mt-3 font-khelo-display text-[32px] font-extrabold leading-[1.08] tracking-[-1.2px] md:text-[38px]">{t("about.story.title")}</h2>
          <p className="mt-4 leading-[1.75] text-white/80">
            {t("about.story.body")}
          </p>
        </div>
        <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-khelo-surface p-7 md:p-11">
          <Eyebrow>{t("about.founder.eyebrow")}</Eyebrow>
          <div className="mt-5 flex items-center gap-[18px]">
            <div
              aria-hidden="true"
              className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full bg-khelo-orange font-khelo-display text-[28px] font-extrabold text-khelo-ink"
            >
              AR
            </div>
            <div>
              <div className="text-[22px] font-extrabold">Abdul Rafay</div>
              <div className="text-[15px] text-khelo-muted-2">{t("about.founder.role", { company })}</div>
            </div>
          </div>
          <p className="mt-[22px] leading-[1.75] text-khelo-muted">{t("about.founder.body", { company })}</p>
        </div>
      </Container>

      {/* CTA */}
      <Container className="py-24">
        <div className="rounded-[36px] bg-khelo-orange px-6 py-14 text-center md:px-10">
          <h2 className="font-khelo-display text-[38px] font-extrabold leading-none tracking-[-1.8px] text-khelo-ink md:text-[52px]">{t("about.cta.title")}</h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3.5">
            <Button href="/search" variant="dark" size="lg" className="px-8">
              {t("about.cta.play")}
            </Button>
            <Button href="/contact" variant="outlineDark" size="lg" className="px-8 !border-2">
              {t("about.cta.talk")}
            </Button>
          </div>
        </div>
      </Container>
    </KheloPage>
  );
}
