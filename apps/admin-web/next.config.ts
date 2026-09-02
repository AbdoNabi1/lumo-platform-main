import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

/**
 * Phase A.34 (A.33 P1 #3, Task 9) — security headers. None existed before this (confirmed by
 * A.33: zero matches for CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/
 * Permissions-Policy/HSTS anywhere in this app).
 *
 * `script-src`/`style-src` include `'unsafe-inline'` deliberately, not as an oversight: Next.js's
 * App Router hydration payload (`self.__next_f.push(...)`) is an inline `<script>` with no nonce
 * wiring in this app, and the design system injects inline `style` attributes for
 * positioning/theming. Removing `'unsafe-inline'` without nonce wiring would break hydration
 * entirely — the same tradeoff `infrastructure/k8s/60-ingress.yaml` already documents for the
 * storefront ("a real CSP needs to be script/style-aware... pending dedicated nonce-wiring work").
 * Tracked as a follow-up in PHASE_A34_PRODUCTION_REMEDIATION_REPORT.md, not silently accepted.
 *
 * `form-action` allows Kratos's public origin because `login/page.tsx` renders a real HTML
 * `<form action={flow.ui.action}>` that Kratos owns and posts to directly (browser navigation, not
 * fetch) — without this, CSP would block the one real login form in the app.
 */
function authOrigin(envVar: string, devDefault: string): string {
  const value = process.env[envVar];
  if (value !== undefined && value.length > 0) {
    try {
      return new URL(value).origin;
    } catch {
      return devDefault;
    }
  }
  return devDefault;
}

const kratosOrigin = authOrigin("KRATOS_PUBLIC_URL", "http://localhost:4433");
const hydraOrigin = authOrigin("HYDRA_PUBLIC_URL", "http://localhost:4444");

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  `form-action 'self' ${kratosOrigin} ${hydraOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Trace from the monorepo root so workspace packages are bundled into standalone output.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Compile the design-system packages from source — no pre-build step needed.
  transpilePackages: ["@platform/ui", "@platform/design"],
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default config;
