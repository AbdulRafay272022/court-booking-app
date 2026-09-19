import type { Metadata } from "next";
import { Figtree, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const figtree = Figtree({ variable: "--font-figtree-x", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-x", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-mono-x", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: {
    default: "Maidan — Book padel and futsal courts in Karachi",
    template: "%s · Maidan",
  },
  description: "Find and book padel and futsal courts in DHA and Clifton, Karachi. Real-time availability, instant confirmation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-figtree-x)] bg-player-bg text-player-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
