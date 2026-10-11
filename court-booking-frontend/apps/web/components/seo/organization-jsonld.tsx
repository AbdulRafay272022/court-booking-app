import { getSiteConfig } from "@/lib/site-config";
import { safeJsonLd } from "@/lib/safe-json";

/**
 * Organization structured data for the home page. Server component: reads the site origin at request time, so the page that
 * renders it must be `dynamic = "force-dynamic"` (the home page already is when it calls getSiteConfig()).
 * `url` and `logo` are only emitted when NEXT_PUBLIC_SITE_URL is set (unset = omit, never invent an origin).
 */
export function OrganizationJsonLd() {
  const { siteUrl } = getSiteConfig();
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Khelo",
    ...(siteUrl ? { url: siteUrl, logo: `${siteUrl}/icon.svg` } : {}),
    parentOrganization: { "@type": "Organization", name: "Logic Link System" },
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }} />;
}
