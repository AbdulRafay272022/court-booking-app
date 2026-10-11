import type { Metadata } from "next";
import { Benefits, PricingBlock, SampleDayCard, Steps } from "@/components/owners/owner-sections";
import { Button } from "@/components/site/button";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow, FaqItem } from "@/components/site/primitives";
import { getSiteConfig } from "@/lib/site-config";

// Reads NEXT_PUBLIC_OWNER_PRICING_TEXT from the running server's environment, so it must render per request.
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "List your courts on Khelo: one dashboard for bookings and revenue, payment approval with one tap, your own pricing and cancellation policy. Built for venue owners in Karachi.";

export const metadata: Metadata = {
  title: "For Owners",
  description: DESCRIPTION,
  alternates: { canonical: "/for-owners" },
  openGraph: { title: "For Owners · Khelo", description: DESCRIPTION, type: "website", url: "/for-owners" },
};

export default function ForOwnersPage() {
  const { ownerPricingText, supportWhatsapp, supportEmail } = getSiteConfig();
  // /contact has nothing to offer until a WhatsApp number or email is configured, so the button is hidden until then.
  const canContact = Boolean(supportWhatsapp || supportEmail);

  return (
    <KheloPage>
      <section className="bg-khelo-teal text-white">
        <Container className="flex flex-wrap items-center gap-14 pb-24 pt-12">
          <div className="min-w-0 flex-[1_1_440px]">
            <Eyebrow tone="light">For venue owners</Eyebrow>
            <h1 className="mt-4 font-khelo-display text-[44px] font-extrabold leading-none tracking-[-1.5px] md:text-[64px] md:tracking-[-2px]">
              Court aapka. Bookings hamari zimmedari.
            </h1>
            <p className="mt-6 max-w-[540px] text-[19px] leading-[1.65] text-white/90">
              Call, chat aur notebook se azadi. Khelo bookings leta hai, payment ka proof sambhalta hai, aur batata hai kaun se slots khali reh rahe hain.
            </p>
            <Button href="/signup?role=owner" size="lg" className="mt-8">
              Apna venue list karo
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
                Pricing poochein
              </Button>
            ) : null
          }
        />
      ) : null}

      <section id="faq" aria-labelledby="owners-faq" className="mx-auto w-full max-w-[908px] px-6 pt-24">
        <h2 id="owners-faq" className="font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1.3px] md:text-[44px]">
          Owners ke sawal
        </h2>
        <div className="mt-7 flex flex-col gap-3">
          <FaqItem question="Kya mujhe tech ka ilm chahiye?" defaultOpen>
            Nahi. Setup wizard step by step guide karta hai, aur dashboard seedha simple hai.
          </FaqItem>
          <FaqItem question="Payment mujhe kaise milti hai?">
            Players aapke bank ya wallet account mein seedha pay karte hain aur proof chat mein dete hain. Aap verify karke approve karte hain.
          </FaqItem>
          <FaqItem question="Mere paas kai venues hain, chalega?">Haan, ek account se kai venues aur har venue ke kai courts manage ho sakte hain.</FaqItem>
        </div>
      </section>

      <section aria-labelledby="owners-cta" className="mx-auto w-full max-w-[1248px] px-6 py-24">
        <div className="rounded-[36px] bg-khelo-ink px-6 py-14 text-center text-white md:px-10">
          <h2 id="owners-cta" className="font-khelo-display text-[36px] font-extrabold leading-none tracking-[-1.5px] md:text-[52px] md:tracking-[-1.8px]">
            Khali slots ko kamayi mein badlo.
          </h2>
          <Button href="/signup?role=owner" size="lg" className="mt-7">
            Venue list karo
          </Button>
        </div>
      </section>
    </KheloPage>
  );
}
