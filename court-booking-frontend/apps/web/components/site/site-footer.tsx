import Link from "next/link";

const COLUMNS = [
  {
    title: "Explore",
    links: [
      { href: "/search", label: "Sports" },
      { href: "/features", label: "Features" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/for-owners", label: "For Owners" },
      { href: "/about", label: "About" },
      { href: "/blog", label: "Blog" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    // Only pages that really exist: there is no Refund policy page yet (refunds are explained inside the Terms).
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
] as const;

/** The Khelo footer used on Home, Features, For Owners, About, Blog and Contact (Login, Signup and Search use the header only). */
export function SiteFooter() {
  return (
    <footer className="khelo bg-khelo-ink font-[family-name:var(--font-khelo-body-x)] text-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-10 px-6 pb-9 pt-14">
        <div className="min-w-0 flex-[1_1_280px]">
          <div className="font-khelo-display text-[30px] font-extrabold">Khelo</div>
          <p className="mt-3 max-w-[320px] leading-[1.6] text-white/65">Pakistan ka court booking marketplace. Karachi pilot se shuru.</p>
        </div>
        <div className="flex flex-wrap gap-14">
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="flex flex-col gap-3 text-[15px]">
              <div className="font-extrabold text-khelo-orange">{col.title}</div>
              {col.links.map((l) => (
                <Link key={l.href + l.label} href={l.href} className="khelo-navlink inline-flex min-h-6 items-center">
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-6 pb-8 text-[13px] text-white/50">© 2026 Khelo, a Logic Link System product.</div>
    </footer>
  );
}
