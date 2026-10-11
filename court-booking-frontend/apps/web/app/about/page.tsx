import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";

export const metadata: Metadata = {
  title: 'About',
  description: "Khelo is Pakistan's court booking marketplace, built by Logic Link System. Started with a Karachi pilot.",
  openGraph: { title: "About · Khelo", description: "Khelo is Pakistan's court booking marketplace, built by Logic Link System. Started with a Karachi pilot.", type: "website" },
};

// FOUNDATION STUB: replaced by the build agent that owns this route.
export default function AboutPage() {
  return (
    <KheloPage>
      <Container className="py-24">
        <h1 className="font-khelo-display text-5xl font-extrabold tracking-[-1.5px]">About</h1>
      </Container>
    </KheloPage>
  );
}
