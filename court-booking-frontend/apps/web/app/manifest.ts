import type { MetadataRoute } from "next";

/** Web app manifest (Round 2 Stage 2): needed for "Add to Home Screen", which iPhone/iPad need before Web Push works. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Khelo",
    short_name: "Khelo",
    description: "Book sports courts in Pakistan",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#FAF8F6",
    theme_color: "#E44E1F",
    icons: [
      { src: "/brand/khelo-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/khelo-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/khelo-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/khelo-logo-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
