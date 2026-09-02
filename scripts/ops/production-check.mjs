#!/usr/bin/env node
// Phase A.34 (Task 20) — production configuration validation. Run this against the environment
// you're about to deploy (e.g. `kubectl -n lumo-runtime exec` env dump, a rendered .env.production,
// or CI secrets exported as real env vars) BEFORE applying it — never against real production
// itself, and never with real secrets pasted into a terminal that gets logged.
//
// Usage: node scripts/ops/production-check.mjs
//
// Note on HYDRA_DSN/KRATOS_DSN/KETO_DSN: each Ory service's actual k8s Secret key is just `DSN`
// (infrastructure/k8s/secret.example.yaml — scoped per-pod, so no prefix is needed there). This
// script checks all three from one flat process, so it expects them supplied under these prefixed
// names — map each service's real `DSN` value to the matching prefixed var when compiling the
// input for this check (e.g. from three `kubectl get secret -o jsonpath` calls).
//
// Exits non-zero and prints every failure (not just the first) if:
//   - a required production env var is missing
//   - a URL-shaped var resolves to localhost/127.0.0.1
//   - an auth-service DSN is "memory" (Hydra/Kratos/Keto — A.33 P0 #1)
//   - AUTH_CLIENT_SECRET equals the known dev placeholder (A.33 P0 #3)
//   - Kratos's CORS allowlist is unset, "*", or contains a localhost origin (A.33 P0/Task 10)
//   - COOKIE_SAME_SITE is an invalid value

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}
function warn(message) {
  warnings.push(message);
}

function isLocalhost(value) {
  return /localhost|127\.0\.0\.1/i.test(value);
}

function requireUrl(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    fail(`${name} is not set.`);
    return;
  }
  if (isLocalhost(value)) {
    fail(`${name}="${value}" resolves to localhost — not valid in production.`);
    return;
  }
  try {
    new URL(value);
  } catch {
    fail(`${name}="${value}" is not a valid URL.`);
  }
}

function requireNonEmpty(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    fail(`${name} is not set.`);
  }
}

function checkDsn(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    fail(`${name} is not set — the auth service it configures would boot ephemeral (A.33 P0 #1).`);
    return;
  }
  if (value.trim().toLowerCase() === "memory") {
    fail(`${name}="memory" — ephemeral auth state is a P0 production blocker (A.33 P0 #1).`);
  }
}

function checkClientSecret() {
  const value = process.env["AUTH_CLIENT_SECRET"];
  if (value === undefined || value.length === 0) {
    fail(
      "AUTH_CLIENT_SECRET is not set — admin-web fails closed on this already, but a deploy without it never boots (A.33 P0 #3).",
    );
    return;
  }
  if (value === "lumo-admin-web-secret-change-me") {
    fail(
      'AUTH_CLIENT_SECRET is still the dev placeholder ("lumo-admin-web-secret-change-me") — A.33 P0 #3.',
    );
  }
}

function checkCors() {
  const value = process.env["SERVE_PUBLIC_CORS_ALLOWED_ORIGINS"];
  if (value === undefined || value.length === 0) {
    fail(
      "SERVE_PUBLIC_CORS_ALLOWED_ORIGINS is not set — Kratos would fall back to its config file default.",
    );
    return;
  }
  const origins = value.split(",").map((origin) => origin.trim());
  if (origins.includes("*")) {
    fail(
      'SERVE_PUBLIC_CORS_ALLOWED_ORIGINS contains "*" — wildcard CORS is not allowed in production.',
    );
  }
  for (const origin of origins) {
    if (isLocalhost(origin)) {
      fail(
        `SERVE_PUBLIC_CORS_ALLOWED_ORIGINS contains "${origin}" — localhost is not valid in production.`,
      );
    }
  }
}

function checkCookieSameSite() {
  const value = process.env["COOKIE_SAME_SITE"] ?? "lax";
  if (!["lax", "strict", "none"].includes(value)) {
    fail(`COOKIE_SAME_SITE="${value}" is not one of lax|strict|none.`);
    return;
  }
  if (value === "none") {
    warn(
      'COOKIE_SAME_SITE="none" — valid (e.g. Hydra/Kratos on a non-subdomain host), but this app has no ' +
        "explicit CSRF token beyond the OAuth `state` parameter (documented in PHASE_A34_PRODUCTION_REMEDIATION_REPORT.md). " +
        "Confirm this is intentional.",
    );
  }
  if (process.env["COOKIE_DOMAIN"] === undefined) {
    warn(
      "COOKIE_DOMAIN is not set — admin-web's cookies stay host-only. Fine if Hydra/Kratos run on the " +
        "exact same host as admin-web; required if they're on sibling subdomains (A.33 P0 #6).",
    );
  }
}

// admin-web's own production env contract (apps/admin-web/src/lib/env.ts's requireProdEnv set).
requireUrl("HYDRA_PUBLIC_URL");
requireUrl("HYDRA_ADMIN_URL");
requireUrl("KRATOS_PUBLIC_URL");
requireUrl("AUTH_ISSUER_URL");
requireUrl("AUTH_JWKS_URL");
requireUrl("RUNTIME_API_URL");
requireNonEmpty("TENANT_DEFAULT_ID");
checkClientSecret();

// Auth service persistence (infrastructure/k8s/71-hydra.yaml, 72-kratos.yaml, 73-keto.yaml).
checkDsn("HYDRA_DSN");
checkDsn("KRATOS_DSN");
checkDsn("KETO_DSN");

checkCors();
checkCookieSameSite();

if (failures.length > 0) {
  console.error(`production:check FAILED — ${failures.length} issue(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  if (warnings.length > 0) {
    console.error(`\n${warnings.length} warning(s):\n`);
    for (const warning of warnings) console.error(`  ! ${warning}`);
  }
  process.exitCode = 1;
} else {
  console.error("production:check passed — no blocking issues found.");
  if (warnings.length > 0) {
    console.error(`\n${warnings.length} warning(s):\n`);
    for (const warning of warnings) console.error(`  ! ${warning}`);
  }
}
