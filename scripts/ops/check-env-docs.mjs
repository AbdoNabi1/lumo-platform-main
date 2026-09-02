#!/usr/bin/env node
// M-10 fitness function — the missing guard that let `.env.example` drift from what running
// code actually reads: 58 variables the collector and runtime require at boot were undocumented
// (a deploy following `.env.example` alone would fail on first request), while 11 documented
// variables described features nothing in the codebase reads (SMTP_*, FLAGS_PROVIDER,
// PAYMENTS_PROVIDER=mock superseded by the real Stripe wiring, …).
//
// Extracts every environment-variable NAME two ways and diffs them:
//   - "required by code": zod schema keys (multi-line-safe) from the four schema files that
//     validate process.env, plus `requireProdEnv("X", …)` / `optionalEnv("X", …)` /
//     `process.env["X"]` reads in the two Next.js apps (which don't go through a zod schema).
//   - "documented": `KEY=` lines in .env.example, plus its prose convention for secret-bearing
//     vars that are deliberately never given an `=` line (`# KEY comes from the secret manager`).
//
// Anything in one set and not the other fails the check UNLESS it's in ALLOWLIST below, with a
// reason. This mirrors this repo's own convention for pnpm-workspace.yaml's `ignoreGhsas` —
// exceptions are named and justified, not silently tolerated.
//
// Usage: node scripts/ops/check-env-docs.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

/**
 * Variables intentionally on only one side. Every entry needs a reason — this is the list a
 * reviewer actually reads when the check fails on something new.
 */
const ALLOWLIST = {
  // Documented for humans/ops tooling, not read by any TypeScript process.
  codeOnly: [],
  docsOnly: [
    ["NEXT_PUBLIC_APP_URL", "read by Next.js's own env inlining, not a schema key"],
    [
      "PORT",
      "read by both Next.js apps' dev/start scripts and by apps/runtime/collector; base schema key already covers it",
    ],
    [
      "CONNECT_URL",
      "read by infrastructure/docker/debezium/register-connector.sh (host-side shell script), not TypeScript",
    ],
    [
      "PGADMIN_DEFAULT_EMAIL",
      "read by infrastructure/docker/docker-compose.yml's pgadmin service, not app code",
    ],
    ["PGADMIN_DEFAULT_PASSWORD", "same as PGADMIN_DEFAULT_EMAIL"],
    [
      "AUTH_CLIENT_SECRET",
      "prose-only in .env.example by design (A.33 P0 #3 — no fallback, ever); read via requireProdEnv with no default",
    ],
    [
      "STRIPE_SECRET_KEY",
      "prose-only in .env.example by design — optional secret, present/absent toggles the real adapter",
    ],
    ["STRIPE_WEBHOOK_SECRET", "same as STRIPE_SECRET_KEY"],
    ["VAULT_TOKEN", "prose-only in .env.example by design — optional secret"],
    ["AWS_ACCESS_KEY_ID", "prose-only in .env.example by design — optional secret"],
    ["AWS_SECRET_ACCESS_KEY", "prose-only in .env.example by design — optional secret"],
    ["AWS_SESSION_TOKEN", "prose-only in .env.example by design — optional secret"],
    ["GCP_KMS_ACCESS_TOKEN", "prose-only in .env.example by design — optional secret"],
    ["AZURE_OAUTH_CLIENT_SECRET", "prose-only in .env.example by design — optional secret"],
  ],
};

function readText(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

/**
 * Multi-line-safe zod object key extraction: `KEY: z.foo()`, `KEY: zBool(...)`, a bare
 * `KEY: z` continued by `.foo()` on the next line, or `KEY: someNamedSchema` (a reference to a
 * schema defined earlier in the same file, e.g. packages/config/src/env.ts's `nodeEnvSchema`).
 */
function zodKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(
    /^\s+([A-Z][A-Z0-9_]+):\s*(?:z\.|zBool\(|z\s*$|[a-z]\w*Schema\b)/gm,
  )) {
    keys.add(match[1]);
  }
  return keys;
}

/**
 * `requireProdEnv("X", ...)` / `optionalEnv("X", ...)` / `required("X")` (apps/collector's local
 * helper of the same shape) / `process.env["X"]` / `process.env.X`.
 */
function envReads(source) {
  const keys = new Set();
  for (const match of source.matchAll(
    /(?:requireProdEnv|optionalEnv|required)\(\s*"([A-Z][A-Z0-9_]+)"/g,
  )) {
    keys.add(match[1]);
  }
  for (const match of source.matchAll(/process\.env\[?"?([A-Z][A-Z0-9_]+)"?\]?/g)) {
    if (match[1] !== "SIGINT" && match[1] !== "SIGTERM") keys.add(match[1]);
  }
  return keys;
}

/** `env("X")` — how Prisma schema files (packages/db/prisma/schema/*.prisma) declare requirements. */
function prismaEnvKeys() {
  const keys = new Set();
  const schemaDir = join(root, "packages", "db", "prisma", "schema");
  for (const entry of readdirSync(schemaDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".prisma")) continue;
    const content = readFileSync(join(schemaDir, entry.name), "utf8");
    for (const match of content.matchAll(/\benv\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function walk(dir, out) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".turbo")
      continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
      out.push(rel);
    }
  }
}

function collectRequiredByCode() {
  const required = new Set();

  for (const key of zodKeys(readText("apps", "runtime", "src", "config.ts"))) required.add(key);
  for (const key of zodKeys(readText("packages", "config", "src", "env.ts"))) required.add(key);
  for (const key of zodKeys(readText("packages", "config", "src", "server", "env.ts")))
    required.add(key);

  for (const key of envReads(readText("apps", "collector", "src", "main.ts"))) required.add(key);
  for (const key of prismaEnvKeys()) required.add(key);

  for (const dir of [join("apps", "admin-web", "src"), join("apps", "storefront", "src")]) {
    const files = [];
    walk(dir, files);
    for (const file of files) {
      for (const key of envReads(readText(file))) required.add(key);
    }
  }

  return required;
}

function collectDocumented() {
  const documented = new Set();
  const content = readText(".env.example");
  for (const match of content.matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})=/gm)) {
    documented.add(match[1]);
  }
  // The prose convention for secret-bearing vars: "# KEY comes from the secret manager", or
  // several such vars sharing one line ("# X / Y / Z come from the secret manager") — no
  // trailing `=` on any of them.
  for (const match of content.matchAll(/^#\s*([A-Z][A-Z0-9_ /]+?)\s+comes? from/gm)) {
    for (const name of match[1].split("/")) {
      const trimmed = name.trim();
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(trimmed)) documented.add(trimmed);
    }
  }
  return documented;
}

const required = collectRequiredByCode();
const documented = collectDocumented();

const codeOnlyAllowed = new Set(ALLOWLIST.codeOnly.map(([name]) => name));
const docsOnlyAllowed = new Set(ALLOWLIST.docsOnly.map(([name]) => name));

const missingFromDocs = [...required]
  .filter((name) => !documented.has(name) && !codeOnlyAllowed.has(name))
  .sort();
const missingFromCode = [...documented]
  .filter((name) => !required.has(name) && !docsOnlyAllowed.has(name))
  .sort();

if (missingFromDocs.length > 0 || missingFromCode.length > 0) {
  console.error("check-env-docs: FAILED\n");
  if (missingFromDocs.length > 0) {
    console.error(
      `${missingFromDocs.length} variable(s) a running process reads but .env.example does not document:\n`,
    );
    for (const name of missingFromDocs) console.error(`  ✗ ${name}`);
    console.error("");
  }
  if (missingFromCode.length > 0) {
    console.error(
      `${missingFromCode.length} variable(s) .env.example documents but nothing reads:\n`,
    );
    for (const name of missingFromCode) console.error(`  ✗ ${name}`);
    console.error("");
  }
  console.error(
    "Fix by adding/removing the variable, or — if this is a deliberate, justified exception — " +
      "add it to ALLOWLIST in scripts/ops/check-env-docs.mjs with a reason.",
  );
  process.exitCode = 1;
} else {
  console.error(
    `check-env-docs: passed — ${required.size} code-required variable(s) all documented, ` +
      `${ALLOWLIST.docsOnly.length} intentional docs-only exception(s) accounted for.`,
  );
}
