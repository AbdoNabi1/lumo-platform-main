import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The "Architecture boundary" gate the Sprint 3.2 report claims ("Analytics declares no
 * dependency on any business context"). D-064's core principle: Analytics consumes business read
 * models by string name/field only, never by import — enforced here rather than left to review.
 */
const ALLOWED_PLATFORM_DEPENDENCIES = new Set([
  "@platform/clickhouse",
  "@platform/domain",
  "@platform/types",
  "@platform/utils",
]);

const PACKAGE_ROOT = join(__dirname, "..");
const SRC_ROOT = join(PACKAGE_ROOT, "src");
const IMPORT_PATTERN = /from\s+["'](@platform\/[a-z0-9-]+)/g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("Architecture boundary (D-064: no business-context dependency)", () => {
  it("declares only kernel packages in package.json dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    const platformDeps = Object.keys(pkg.dependencies ?? {}).filter((name) =>
      name.startsWith("@platform/"),
    );
    const disallowed = platformDeps.filter((name) => !ALLOWED_PLATFORM_DEPENDENCIES.has(name));
    expect(disallowed).toEqual([]);
  });

  it("imports no business-context package anywhere in src/", () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const content = readFileSync(file, "utf-8");
      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const importedPackage = match[1]!;
        if (!ALLOWED_PLATFORM_DEPENDENCIES.has(importedPackage)) {
          violations.push(`${file}: ${importedPackage}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
