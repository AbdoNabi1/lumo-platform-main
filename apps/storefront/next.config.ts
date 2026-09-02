import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output for the production Docker image (see infrastructure/docker).
  // Vercel produces its own serverless output and neither uses nor needs standalone tracing,
  // so it is disabled there; the Docker image path is unchanged.
  output: process.env.VERCEL ? undefined : "standalone",
  // Trace from the monorepo root so workspace packages are bundled into standalone output.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Compile workspace packages from source (no pre-build step needed).
  transpilePackages: [
    "@platform/ui",
    "@platform/design",
    "@platform/utils",
    "@platform/config",
    "@platform/types",
    "@platform/tracking",
  ],
};

export default config;
