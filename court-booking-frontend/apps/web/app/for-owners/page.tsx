import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";

export const metadata: Metadata = {
  title: 'For Owners',
  description: 'List your courts on Khelo: a free booking calendar, payment approvals and walk-ins in one place for venue owners in Karachi.',
  openGraph: { title: "For Owners · Khelo", description: 'List your courts on Khelo: a free booking calendar, payment approvals and walk-ins in one place for venue owners in Karachi.', type: "website" },
};

// FOUNDATION STUB: replaced by the build agent that owns this route.
export default function ForOwnersPage() {
  return (
    <KheloPage>
      <Container className="py-24">
        <h1 className="font-khelo-display text-5xl font-extrabold tracking-[-1.5px]">For Owners</h1>
      </Container>
    </KheloPage>
  );
}
