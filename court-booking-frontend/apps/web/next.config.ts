import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TS source (no build step) -- Next only transpiles
  // node_modules packages listed here, so without this, importing them 500s.
  transpilePackages: ["@court-booking/types", "@court-booking/api-client"],
};

export default nextConfig;
