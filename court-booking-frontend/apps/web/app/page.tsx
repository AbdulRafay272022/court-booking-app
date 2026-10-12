import type { Metadata } from "next";
import { SPORT_OPTIONS } from "@court-booking/types";
import { Areas } from "@/components/home/areas";
import { Hero } from "@/components/home/hero";
import { Faq, Features, FinalCta, HowItWorks, Owners } from "@/components/home/sections";
import { Sports } from "@/components/home/sports";
import { StatsStrip } from "@/components/home/stats";
import { OrganizationJsonLd } from "@/components/seo/organization-jsonld";
import { KheloPage } from "@/components/site/page-shell";
import { serverApi } from "@/lib/server-api";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const title = t("home.meta.title");
  const description = t("home.meta.description");
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { title, description, type: "website", siteName: "Khelo" },
    twitter: { card: "summary", title, description },
  };
}

// Rendered per request: the organization data reads the site URL from the server's environment at request time. The stats and areas
// fetches below are still cached by Next's data cache (5 minutes / 1 minute), so this stays cheap.
export const dynamic = "force-dynamic";

/** Real counts, or null (hide the strip) when the request fails or there is nothing to show yet. */
async function loadStats() {
  try {
    const s = await serverApi.publicStats();
    const counts = [s?.venues, s?.courts, s?.bookings, s?.players];
    if (!counts.every((n) => Number.isFinite(n) && n >= 0)) return null;
    return counts.every((n) => n === 0) ? null : s;
  } catch {
    return null;
  }
}

/** Areas with at least one approved venue; empty on failure so the section is simply hidden. */
async function loadAreas(): Promise<string[]> {
  try {
    const { areas } = await serverApi.areas();
    return Array.isArray(areas) ? areas.filter((a) => typeof a === "string" && a.trim() !== "") : [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [stats, areas] = await Promise.all([loadStats(), loadAreas()]);
  return (
    <KheloPage footerVariant="home">
      <OrganizationJsonLd />
      <Hero />
      {stats ? <StatsStrip stats={stats} /> : null}
      <Sports sports={SPORT_OPTIONS} />
      <HowItWorks />
      <Features />
      <Owners />
      {areas.length > 0 ? <Areas areas={areas} /> : null}
      <Faq />
      <FinalCta />
    </KheloPage>
  );
}
