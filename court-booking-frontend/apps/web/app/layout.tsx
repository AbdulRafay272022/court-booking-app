import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, IBM_Plex_Sans, IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { LangProvider } from "@/components/i18n/lang-provider";
import { getLang } from "@/lib/i18n-server";
import { makeT } from "@/lib/i18n";
import { COMPANY_NAME } from "@/lib/site-config";

const figtree = Figtree({ variable: "--font-figtree-x", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-x", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-mono-x", subsets: ["latin"], weight: ["400", "500", "600"] });
// Khelo website + app screens (display = headlines, body = text). Self-hosted by next/font at build time.
// The design loads Bricolage Grotesque with its optical-size axis (glyphs tighten at large sizes), so load the variable font with `opsz`
// (weights 200-800 come with it); a static 600/800 instance has the default optical size and sets visibly wider.
const kheloDisplay = Bricolage_Grotesque({ variable: "--font-khelo-display-x", subsets: ["latin"], axes: ["opsz"] });
const kheloBody = Plus_Jakarta_Sans({ variable: "--font-khelo-body-x", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLang());
  return {
    title: { default: t("common.meta.siteTitle"), template: "%s \u00b7 Khelo" },
    description: t("common.meta.siteDescription", { company: COMPANY_NAME }),
  };
}

// `<html lang>` stays "en" in both languages: Roman Urdu is Latin script (not `ur`). The cookie read makes every route dynamic.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  return (
    <html lang="en" className={`${figtree.variable} ${plexSans.variable} ${plexMono.variable} ${kheloDisplay.variable} ${kheloBody.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-figtree-x)] bg-player-bg text-player-ink antialiased">
        <LangProvider lang={lang}>
          <Providers>{children}</Providers>
        </LangProvider>
      </body>
    </html>
  );
}
