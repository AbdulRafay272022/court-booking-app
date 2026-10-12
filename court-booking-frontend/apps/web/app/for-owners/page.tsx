import type { Metadata } from "next";
import { Benefits, PricingBlock, SampleDayCard, Steps } from "@/components/owners/owner-sections";
import { Button } from "@/components/site/button";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow, FaqItem } from "@/components/site/primitives";
import { getSiteConfig } from "@/lib/site-config";
import { getT } from "@/lib/i18n-server";

// Reads NEXT_PUBLIC_OWNER_PRICING_TEXT from the running server's environment, so it must render per request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const description = t("owners.meta.description");
  return {
    title: t("owners.meta.title"),
    description,
    alternates: { canonical: "/for-owners" },
    openGraph: { title: t("owners.meta.ogTitle"), description, type: "website", url: "/for-owners" },
  };
}

export default async function ForOwnersPage() {
  const t = await getT();
  const { ownerPricingText, supportWhatsapp, supportEmail } = getSiteConfig();
  // /contact has nothing to offer until a WhatsApp number or email is configured, so the button is hidden until then.
  const canContact = Boolean(supportWhatsapp || supportEmail);

  return (
    <KheloPage>
      <section className="bg-khelo-teal text-white">
        <Container className="flex flex-wrap items-center gap-14 pb-24 pt-12">
          <div className="min-w-0 flex-[1_1_440px]">
            <Eyebrow tone="light">{t("owners.hero.eyebrow")}</Eyebrow>
            <h1 className="mt-4 font-khelo-display text-[44px] font-extrabold leading-none tracking-[-1.5px] md:text-[64px] md:tracking-[-2px]">
              {t("owners.hero.title")}
            </h1>
            <p className="mt-6 max-w-[540px] text-[19px] leading-[1.65] text-white/90">
              {t("owners.hero.sub")}
            </p>
            <Button href="/signup?role=owner" size="lg" className="mt-8">
              {t("owners.hero.cta")}
            </Button>
          </div>
          <div className="min-w-0 flex-[1_1_360px]">
            <SampleDayCard />
          </div>
        </Container>
      </section>

      <Benefits />
      <Steps />

      {ownerPricingText ? (
        <PricingBlock
          text={ownerPricingText}
          action={
            canContact ? (
              <Button href="/contact" variant="dark" size="lg">
                {t("owners.pricing.cta")}
              </Button>
            ) : null
          }
        />
      ) : null}

      <section id="faq" aria-labelledby="owners-faq" className="mx-auto w-full max-w-[908px] px-6 pt-24">
        <h2 id="owners-faq" className="font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1.3px] md:text-[44px]">
          {t("owners.faq.title")}
        </h2>
        <div className="mt-7 flex flex-col gap-3">
          <FaqItem question={t("owners.faq.q1")} defaultOpen>
            {t("owners.faq.a1")}
          </FaqItem>
          <FaqItem question={t("owners.faq.q2")}>
            {t("owners.faq.a2")}
          </FaqItem>
          <FaqItem question={t("owners.faq.q3")}>{t("owners.faq.a3")}</FaqItem>
        </div>
      </section>

      <section aria-labelledby="owners-cta" className="mx-auto w-full max-w-[1248px] px-6 py-24">
        <div className="rounded-[36px] bg-khelo-ink px-6 py-14 text-center text-white md:px-10">
          <h2 id="owners-cta" className="font-khelo-display text-[36px] font-extrabold leading-none tracking-[-1.5px] md:text-[52px] md:tracking-[-1.8px]">
            {t("owners.cta.title")}
          </h2>
          <Button href="/signup?role=owner" size="lg" className="mt-7">
            {t("owners.cta.button")}
          </Button>
        </div>
      </section>
    </KheloPage>
  );
}
