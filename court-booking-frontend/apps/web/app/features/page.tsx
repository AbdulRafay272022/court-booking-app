import type { Metadata } from "next";
import { CalendarMockup, ChatMockup, FeatureRow, PaymentStates, SmallFeatures } from "@/components/features/feature-rows";
import { KheloPage } from "@/components/site/page-shell";
import { Button } from "@/components/site/button";
import { Container, Eyebrow } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const description = t("features.meta.description");
  return {
    title: t("features.meta.title"),
    description,
    alternates: { canonical: "/features" },
    openGraph: { title: t("features.meta.ogTitle"), description, type: "website", url: "/features" },
  };
}

export default async function FeaturesPage() {
  const t = await getT();
  return (
    <KheloPage>
      <section className="bg-khelo-ink text-white">
        <Container className="pb-24 pt-12">
          <Eyebrow tone="orange">{t("features.hero.eyebrow")}</Eyebrow>
          <h1 className="mt-4 max-w-[860px] font-khelo-display text-[44px] font-extrabold leading-none tracking-[-1.5px] md:text-[68px] md:tracking-[-2.2px]">
            {t("features.hero.title")}
          </h1>
          <p className="mt-6 max-w-[600px] text-[19px] leading-[1.6] text-white/80">
            {t("features.hero.sub")}
          </p>
        </Container>
      </section>

      <FeatureRow
        eyebrow={t("features.ai.eyebrow")}
        title={t("features.ai.title")}
        body={t("features.ai.body")}
      >
        <ChatMockup />
      </FeatureRow>

      <FeatureRow
        reverse
        eyebrow={t("features.calendar.eyebrow")}
        title={t("features.calendar.title")}
        body={t("features.calendar.body")}
      >
        <CalendarMockup />
      </FeatureRow>

      <FeatureRow
        eyebrow={t("features.payment.eyebrow")}
        title={t("features.payment.title")}
        body={t("features.payment.body")}
      >
        <PaymentStates />
      </FeatureRow>

      <SmallFeatures />

      <section aria-labelledby="features-cta" className="mx-auto w-full max-w-[1248px] px-6 py-24">
        <div className="rounded-[36px] bg-khelo-orange px-6 py-14 text-center md:px-10">
          <h2 id="features-cta" className="font-khelo-display text-[36px] font-extrabold leading-none tracking-[-1.5px] text-khelo-ink md:text-[52px] md:tracking-[-1.8px]">
            {t("features.cta.title")}
          </h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3.5">
            <Button href="/search" variant="dark" size="lg">
              {t("features.cta.play")}
            </Button>
            <Button href="/for-owners" variant="outlineDark" size="lg" className="border-2">
              {t("features.cta.list")}
            </Button>
          </div>
        </div>
      </section>
    </KheloPage>
  );
}
