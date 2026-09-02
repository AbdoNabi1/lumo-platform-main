#!/usr/bin/env node
// C-01 fitness function — the missing guard that let `DIRECT_URL` (main.prisma's
// `directUrl = env("DIRECT_URL")`, added in Phase A.43) go unset in every workflow that runs the
// Prisma CLI, so `prisma migrate deploy`/`validate` failed with P1012 ("Environment variable not
// found") wherever it was invoked outside a developer's own `.env.local` — Railway's
// `preDeployCommand`, `.github/workflows/deploy.yml`'s migrate job, and `db-integration.yml`.
//
// Extracts every `env("X")` reference from `packages/db/prisma/schema/*.prisma` and fails loudly,
// listing every missing name at once, if any is unset in the current process environment. Run this
// as the FIRST step of any job that invokes the Prisma CLI — before `prisma generate`, which
// silently tolerates an unresolved datasource block (it doesn't validate the connection string),
// masking the exact failure this script exists to catch early.
//
// Usage: node scripts/ops/check-prisma-env.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(__dirname, "..", "..", "packages", "db", "prisma", "schema");

const ENV_CALL = /\benv\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g;

function findRequiredEnvVars() {
  const names = new Set();
  for (const entry of readdirSync(schemaDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".prisma")) continue;
    const content = readFileSync(join(schemaDir, entry.name), "utf8");
    for (const match of content.matchAll(ENV_CALL)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

const required = findRequiredEnvVars();
const missing = required.filter((name) => {
  const value = process.env[name];
  return value === undefined || value.length === 0;
});

if (missing.length > 0) {
  console.error(
    `check-prisma-env: FAILED — ${missing.length} of ${required.length} variable(s) referenced by ` +
      `env() in packages/db/prisma/schema/*.prisma are unset:\n`,
  );
  for (const name of missing) console.error(`  ✗ ${name}`);
  console.error(
    "\nThe Prisma CLI validates the full datasource block on every invocation (generate, validate, " +
      "migrate deploy, migrate diff), not only when a variable is actually used by the command you're " +
      "running — an unset one fails schema validation (P1012) before anything else runs.",
  );
  process.exitCode = 1;
} else {
  console.error(
    `check-prisma-env: passed — all ${required.length} schema-referenced variable(s) are set ` +
      `(${required.join(", ")}).`,
  );
}
