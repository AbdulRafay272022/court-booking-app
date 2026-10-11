import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * The frame every Khelo page sits in: header, one `<main>` landmark, optional footer. `app` is for Login, Signup and Search
 * (1240px header, no footer); the marketing pages use the default. The `khelo` class turns on the focus ring, hover and
 * reduced-motion rules in globals.css and the Khelo body font.
 */
export function KheloPage({
  children,
  app = false,
  footer = !app,
  footerVariant = "inner",
}: {
  children: ReactNode;
  app?: boolean;
  footer?: boolean;
  /** Home has its own footer columns in the design; the five inner pages share the other one. */
  footerVariant?: "home" | "inner";
}) {
  return (
    <div className="khelo flex min-h-screen flex-col bg-khelo-page font-[family-name:var(--font-khelo-body-x)] text-khelo-ink antialiased">
      <SiteHeader wide={app} />
      <main id="main" className="flex-1">
        {children}
      </main>
      {footer ? <SiteFooter variant={footerVariant} /> : null}
    </div>
  );
}
