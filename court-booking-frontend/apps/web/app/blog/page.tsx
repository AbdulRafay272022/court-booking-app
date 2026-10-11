import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Guides, venue tips and Khelo news. Posts are coming soon.',
  openGraph: { title: "Blog · Khelo", description: 'Guides, venue tips and Khelo news. Posts are coming soon.', type: "website" },
};

// FOUNDATION STUB: replaced by the build agent that owns this route.
export default function BlogPage() {
  return (
    <KheloPage>
      <Container className="py-24">
        <h1 className="font-khelo-display text-5xl font-extrabold tracking-[-1.5px]">Blog</h1>
      </Container>
    </KheloPage>
  );
}
