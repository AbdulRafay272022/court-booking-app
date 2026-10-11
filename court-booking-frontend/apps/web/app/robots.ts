import type { MetadataRoute } from "next";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = getSiteConfig();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/booking", "/account", "/venue-setup", "/bookings"],
      },
    ],
    // Only advertise a sitemap when we know the real origin.
    ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
