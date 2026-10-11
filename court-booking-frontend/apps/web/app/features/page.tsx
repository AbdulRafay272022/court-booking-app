import type { Metadata } from "next";
import { CalendarMockup, ChatMockup, FeatureRow, PaymentStates, SmallFeatures } from "@/components/features/feature-rows";
import { KheloPage } from "@/components/site/page-shell";
import { Button } from "@/components/site/button";
import { Container, Eyebrow } from "@/components/site/primitives";

const DESCRIPTION =
  "What Khelo does for players and venue owners: book by chat or WhatsApp, a live slot calendar, payment proof and owner approval, favorites, reviews and clear cancellation policies.";

export const metadata: Metadata = {
  title: "Features",
  description: DESCRIPTION,
  alternates: { canonical: "/features" },
  openGraph: { title: "Features · Khelo", description: DESCRIPTION, type: "website", url: "/features" },
};

export default function FeaturesPage() {
  return (
    <KheloPage>
      <section className="bg-khelo-ink text-white">
        <Container className="pb-24 pt-12">
          <Eyebrow tone="orange">Features</Eyebrow>
          <h1 className="mt-4 max-w-[860px] font-khelo-display text-[44px] font-extrabold leading-none tracking-[-1.5px] md:text-[68px] md:tracking-[-2.2px]">
            Booking ka har kaam, ek hi jagah.
          </h1>
          <p className="mt-6 max-w-[600px] text-[19px] leading-[1.6] text-white/80">
            Players ke liye aasani, owners ke liye control. Yahan wo sab hai jo Khelo ko alag banata hai.
          </p>
        </Container>
      </section>

      <FeatureRow
        eyebrow="AI booking assistant"
        title="Baat karo, booking ho jaye"
        body="Slot par tap karo ya seedha likho. Khelo AI poochta hai “book karun?”, slot hold karta hai, aur payment ka tareeqa batata hai. App aur WhatsApp dono mein wahi experience."
      >
        <ChatMockup />
      </FeatureRow>

      <FeatureRow
        reverse
        eyebrow="Live calendar"
        title="Khali slot ek nazar mein"
        body="Har court ka apna schedule. Booked slot grey, free slot safed. Ek slot par do log booking nahi kar sakte, system har tabdeeli ko pehle check karta hai."
      >
        <CalendarMockup />
      </FeatureRow>

      <FeatureRow
        eyebrow="Payment"
        title="Pay karo, proof bhejo, confirm"
        body="Apne bank ya wallet se transfer karo aur screenshot chat mein bhejo. Owner ko foran popup aur notification milti hai. Approve hote hi booking confirm."
      >
        <PaymentStates />
      </FeatureRow>

      <SmallFeatures />

      <section aria-labelledby="features-cta" className="mx-auto w-full max-w-[1248px] px-6 py-24">
        <div className="rounded-[36px] bg-khelo-orange px-6 py-14 text-center md:px-10">
          <h2 id="features-cta" className="font-khelo-display text-[36px] font-extrabold leading-none tracking-[-1.5px] text-khelo-ink md:text-[52px] md:tracking-[-1.8px]">
            Khud try karke dekho.
          </h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3.5">
            <Button href="/search" variant="dark" size="lg">
              Start playing
            </Button>
            <Button href="/for-owners" variant="outlineDark" size="lg" className="border-2">
              List your venue
            </Button>
          </div>
        </div>
      </section>
    </KheloPage>
  );
}
