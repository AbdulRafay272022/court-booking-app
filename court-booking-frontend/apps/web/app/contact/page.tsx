import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Talk to the Khelo team: questions, venue listings, feedback and support.',
  openGraph: { title: "Contact · Khelo", description: 'Talk to the Khelo team: questions, venue listings, feedback and support.', type: "website" },
};

// FOUNDATION STUB: replaced by the build agent that owns this route.
export default function ContactPage() {
  return (
    <KheloPage>
      <Container className="py-24">
        <h1 className="font-khelo-display text-5xl font-extrabold tracking-[-1.5px]">Contact</h1>
      </Container>
    </KheloPage>
  );
}
