import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TS source (no build step) -- Next only transpiles
  // node_modules packages listed here, so without this, importing them 500s.
  transpilePackages: ["@court-booking/types", "@court-booking/api-client"],
  // Bundles only the files actually needed to run (a minimal node_modules
  // subset via file tracing) into .next/standalone -- what the production
  // Dockerfile copies, instead of shipping the full dev node_modules tree.
  output: "standalone",
};

export default nextConfig;
