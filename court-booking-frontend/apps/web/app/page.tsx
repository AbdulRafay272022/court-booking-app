import type { Metadata } from "next";
import { SPORT_OPTIONS } from "@court-booking/types";
import { Areas } from "@/components/home/areas";
import { Hero } from "@/components/home/hero";
import { Faq, Features, FinalCta, HowItWorks, Owners } from "@/components/home/sections";
import { Sports } from "@/components/home/sports";
import { StatsStrip } from "@/components/home/stats";
import { KheloPage } from "@/components/site/page-shell";
import { serverApi } from "@/lib/server-api";

const TITLE = "Khelo – Book Courts in Karachi";
const DESCRIPTION =
  "Khelo shows open slots at sports courts in Karachi. Pick a court, tap a slot and confirm by chat or WhatsApp. Venue owners get one dashboard for bookings and payments.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Khelo" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

// The stats and areas fetches revalidate every 5 minutes / 1 minute; the page itself refreshes on the shorter bound.
export const revalidate = 300;

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
    <KheloPage>
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
