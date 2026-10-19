import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TS source (no build step) -- Next only transpiles
  // node_modules packages listed here, so without this, importing them 500s.
  transpilePackages: ["@court-booking/types", "@court-booking/api-client"],
  // Bundles only the files actually needed to run (a minimal node_modules
  // subset via file tracing) into .next/standalone -- what the production
  // Dockerfile copies, instead of shipping the full dev node_modules tree.
  output: "standalone",
  // Stage 2 Web Push: the service worker must never be served stale (a cached sw.js keeps an old worker alive) and may
  // control the whole site.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
