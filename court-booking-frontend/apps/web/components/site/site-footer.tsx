"use client";

import Link from "next/link";
import type { MessageKey } from "@/lib/i18n";
import { COMPANY_NAME } from "@/lib/site-config";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { urduFont } from "./urdu-font";

type Column = { titleKey: MessageKey; links: readonly { href: string; labelKey: MessageKey }[] };

// Legal = only pages that really exist (there is no Refund policy page; refunds are explained inside the Terms).
const LEGAL: Column = {
  titleKey: "footer.col.legal",
  links: [
    { href: "/terms", labelKey: "footer.link.terms" },
    { href: "/privacy", labelKey: "footer.link.privacy" },
  ],
};

/** "List your venue" lives in the footer (the header only has For Owners); it opens owner signup. */
const LIST_VENUE = { href: "/signup?role=owner", labelKey: "footer.link.listVenue" } as const;

/** The design has TWO footers: Home's, and the one the five inner pages (Features, For Owners, About, Blog, Contact) share. */
const COLUMNS: Record<"home" | "inner", readonly Column[]> = {
  home: [
    {
      titleKey: "footer.col.explore",
      links: [
        { href: "/search", labelKey: "footer.link.sports" },
        { href: "/features", labelKey: "footer.link.features" },
        { href: "/#faq", labelKey: "footer.link.faq" },
      ],
    },
    {
      titleKey: "footer.col.company",
      links: [
        { href: "/for-owners", labelKey: "footer.link.forOwners" },
        LIST_VENUE,
        { href: "/about", labelKey: "footer.link.about" },
        { href: "/blog", labelKey: "footer.link.blog" },
        { href: "/contact", labelKey: "footer.link.contact" },
      ],
    },
    LEGAL,
  ],
  inner: [
    {
      titleKey: "footer.col.explore",
      links: [
        { href: "/features", labelKey: "footer.link.features" },
        { href: "/for-owners", labelKey: "footer.link.forOwners" },
        LIST_VENUE,
        { href: "/blog", labelKey: "footer.link.blog" },
      ],
    },
    {
      titleKey: "footer.col.company",
      links: [
        { href: "/about", labelKey: "footer.link.about" },
        { href: "/contact", labelKey: "footer.link.contact" },
      ],
    },
    LEGAL,
  ],
};

/**
 * The Khelo footer for Home and the five inner pages (Login, Signup and Search use the header only). A client component (it reads the
 * language from context) so pages that are themselves client components can render it too. In Roman Urdu mode the brand also shows in Urdu script.
 */
export function SiteFooter({ variant = "inner" }: { variant?: "home" | "inner" }) {
  const t = useT();
  const lang = useLang();
  return (
    <footer className="khelo bg-khelo-ink font-[family-name:var(--font-khelo-body-x)] text-white">
      <div className="mx-auto flex max-w-[1248px] flex-wrap justify-between gap-10 px-6 pb-9 pt-14">
        <div className="min-w-0 flex-[1_1_280px]">
          <div className="flex items-center gap-3 font-khelo-display text-[30px] font-extrabold">
            <span>Khelo</span>
            {lang === "ru" ? (
              <span dir="rtl" lang="ur" data-testid="footer-brand-urdu" className={`${urduFont.className} text-[26px] font-bold leading-[1.5] text-khelo-orange`}>
                {"کھیلو"}
              </span>
            ) : null}
          </div>
          <p className="mt-3 max-w-[320px] leading-[1.6] text-white/65">{t("footer.tagline")}</p>
        </div>
        <div className="flex flex-wrap gap-14">
          {COLUMNS[variant].map((col) => (
            <nav key={col.titleKey} aria-label={t(col.titleKey)} className="flex flex-col gap-3 text-[15px]">
              <div className="font-extrabold text-khelo-orange">{t(col.titleKey)}</div>
              {col.links.map((l) => (
                <Link key={l.href + l.labelKey} href={l.href} className="khelo-navlink inline-flex min-h-6 items-center">
                  {t(l.labelKey)}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[1248px] px-6 pb-8 text-[13px] text-white/50">{t("footer.copyright", { company: COMPANY_NAME })}</div>
    </footer>
  );
}
