/**
 * Optional site content that depends on values the owner has not necessarily set yet (support contacts, owner pricing text,
 * the public site URL). THE RULE: an unset value means the thing is HIDDEN, never a placeholder like "[SUPPORT EMAIL]".
 *
 * Read these ONLY from server components. They are looked up at request time with a computed key on purpose: a plain
 * `process.env.NEXT_PUBLIC_X` is replaced with its value when `next build` runs, so a value added later on the server
 * (`.env.web`) would never show up until the image was rebuilt. A computed key reads the running container's environment.
 * The pages that call `getSiteConfig()` are therefore rendered per request (`export const dynamic = "force-dynamic"`).
 */
function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface SiteConfig {
  /** Support WhatsApp number, digits with optional leading +. */
  supportWhatsapp?: string;
  /** Support email address. */
  supportEmail?: string;
  /** Free text such as "Mon to Sat, 10am to 8pm". */
  supportHours?: string;
  /** Owner plan pricing sentence(s) for the For Owners page. */
  ownerPricingText?: string;
  /** Public origin of the site, no trailing slash (for sitemap, robots, canonical and Open Graph). */
  siteUrl?: string;
}

export function getSiteConfig(): SiteConfig {
  const siteUrl = read("NEXT_PUBLIC_SITE_URL")?.replace(/\/+$/, "");
  return {
    supportWhatsapp: read("NEXT_PUBLIC_SUPPORT_WHATSAPP"),
    supportEmail: read("NEXT_PUBLIC_SUPPORT_EMAIL"),
    supportHours: read("NEXT_PUBLIC_SUPPORT_HOURS"),
    ownerPricingText: read("NEXT_PUBLIC_OWNER_PRICING_TEXT"),
    siteUrl,
  };
}

/** `https://wa.me/<digits>?text=...` for a configured WhatsApp number, or undefined when none is set. */
export function whatsappLink(config: SiteConfig, prefill?: string): string | undefined {
  const digits = config.supportWhatsapp?.replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  return `https://wa.me/${digits}${prefill ? `?text=${encodeURIComponent(prefill)}` : ""}`;
}

/** `mailto:` link for a configured support email, or undefined when none is set. */
export function mailtoLink(config: SiteConfig, subject?: string, body?: string): string | undefined {
  if (!config.supportEmail) return undefined;
  const parts: string[] = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${config.supportEmail}${parts.length ? `?${parts.join("&")}` : ""}`;
}
