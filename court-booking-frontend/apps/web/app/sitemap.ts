import type { MetadataRoute } from "next";
import { getSiteConfig } from "@/lib/site-config";
import { serverApi } from "@/lib/server-api";

// The origin is read at request time (see lib/site-config.ts), so this cannot be prerendered at build.
export const dynamic = "force-dynamic";

const STATIC_ROUTES = [
  "/",
  "/features",
  "/for-owners",
  "/about",
  "/blog",
  "/contact",
  "/search",
  "/login",
  "/signup",
  "/terms",
  "/privacy",
];

const PER_PAGE = 100;
const MAX_PAGES = 20;

async function venueSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await serverApi.listVenues({ page, per_page: PER_PAGE });
      for (const v of res.venues) if (v.slug) slugs.push(v.slug);
      if (page * PER_PAGE >= res.total || res.venues.length === 0) break;
    }
  } catch {
    // API unreachable: still publish the static routes (and any slugs fetched before the failure).
  }
  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { siteUrl } = getSiteConfig();
  if (!siteUrl) return []; // no origin configured: never invent one
  const slugs = await venueSlugs();
  return [
    ...STATIC_ROUTES.map((path) => ({ url: `${siteUrl}${path === "/" ? "" : path}` })),
    ...slugs.map((slug) => ({ url: `${siteUrl}/venues/${encodeURIComponent(slug)}` })),
  ];
}
