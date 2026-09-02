import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture fitness test (D-058 / docs/platform/03-CUSTOMER_360_SPEC.md §3): Customer 360 is a
 * read-model-first intelligence context — it must never depend on a business context (it consumes
 * their published events, never their packages), and it must reuse `@platform/tracking`'s identity
 * stitching through its public barrel only, never a deep import into `src/pipeline/*` — the frozen
 * Tracking Platform's package.json#exports maps only `"."`, so a deep import would already fail
 * module resolution at runtime; this test catches it at review time instead.
 */
const BUSINESS_CONTEXTS = [
  "@platform/finance",
  "@platform/orders",
  "@platform/catalog",
  "@platform/inventory",
  "@platform/payments",
  "@platform/pricing",
  "@platform/identity",
  "@platform/cart",
  "@platform/checkout",
  "@platform/media",
];

const root = join(dirname(fileURLToPath(import.meta.url)));

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("Customer 360 architecture boundary", () => {
  it("declares no dependency on any business context", () => {
    const pkgPath = join(root, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const context of BUSINESS_CONTEXTS) {
      expect(deps, `Customer 360 must not depend on ${context}`).not.toContain(context);
    }
  });

  it("imports @platform/tracking only through its public barrel", () => {
    const deepImport = /from\s+["']@platform\/tracking\/(?!index)[^"']*["']/;
    for (const file of collectTsFiles(root)) {
      const content = readFileSync(file, "utf8");
      expect(deepImport.test(content), `${file} deep-imports @platform/tracking`).toBe(false);
    }
  });
});
