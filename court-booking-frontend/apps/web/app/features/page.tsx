import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";

export const metadata: Metadata = {
  title: 'Features',
  description: 'What Khelo does for players and venues: live slots, booking by chat or WhatsApp, payments and approvals in one place.',
  openGraph: { title: "Features · Khelo", description: 'What Khelo does for players and venues: live slots, booking by chat or WhatsApp, payments and approvals in one place.', type: "website" },
};

// FOUNDATION STUB: replaced by the build agent that owns this route.
export default function FeaturesPage() {
  return (
    <KheloPage>
      <Container className="py-24">
        <h1 className="font-khelo-display text-5xl font-extrabold tracking-[-1.5px]">Features</h1>
      </Container>
    </KheloPage>
  );
}
