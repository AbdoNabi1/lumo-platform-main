import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `next build` rejects a Client Component that takes a VALUE from a module importing the server-only
 * API client (`next/headers`) — CI failed on exactly this once (11790cfa). Only an erased
 * `import type` is safe from a `"use client"` file; client-safe values live in `lib/staff/*`. This
 * guard walks EVERY source file under `apps/admin-web/src` (the 1d guard in `lib/staff/roles.test.ts`
 * covers one folder only). A `lib/api/*` module that is pure data (it never reaches `next/headers`
 * through its own imports, e.g. `finance-read-models`, `security-transitions`) is not a violation.
 */
const SRC = join(process.cwd(), "src");

/** `import … from "@/lib/api/…"` (or a relative path into `lib/api/`) that is not `import type`, plus bare and re-exports. */
const VALUE_API_IMPORT =
  /^\s*(?:import\s+(?!type\b)[^;]*?\sfrom|import|export\s+(?!type\b)[^;]*?\sfrom)\s+["'](?:@\/lib\/api\/|(?:\.\.?\/)+(?:[\w-]+\/)*lib\/api\/)/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** Every `from "…"` / bare `import "…"` specifier that is not an erased `import type`. */
const VALUE_SPECIFIER =
  /^\s*(?:import\s+(?!type\b)(?:[^;]*?\sfrom\s+)?|export\s+(?!type\b)[^;]*?\sfrom\s+)["']([^"']+)["']/gm;

function resolveModule(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** True when the module's value imports reach `next/headers` (the server-only API client does). */
function reachesServerOnly(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(VALUE_SPECIFIER)) {
    const specifier = match[1] ?? "";
    if (specifier === "next/headers" || specifier === "server-only") return true;
    const next = resolveModule(specifier, file);
    if (next !== null && reachesServerOnly(next, seen)) return true;
  }
  return false;
}

/** The `lib/api/*` modules a client file value-imports that are NOT pure data. */
function serverOnlyApiImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(VALUE_SPECIFIER)) {
    const specifier = match[1] ?? "";
    if (!VALUE_API_IMPORT.test(`import x from "${specifier}";`)) continue;
    const target = resolveModule(specifier, file);
    if (target === null || reachesServerOnly(target)) found.push(specifier);
  }
  return found;
}

/** True when the file's first statement is the `"use client"` directive (comments aside). */
function isClientFile(source: string): boolean {
  const withoutComments = source.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*/, "");
  return /^\s*["']use client["']/.test(withoutComments);
}

describe('client boundary: no "use client" file value-imports @/lib/api/', () => {
  const files = sourceFiles(SRC);
  const clients = files.filter((file) => isClientFile(readFileSync(file, "utf8")));

  it("finds the source tree and a healthy number of Client Components", () => {
    expect.hasAssertions();
    expect(files.length).toBeGreaterThan(300);
    expect(clients.length).toBeGreaterThan(50);
  });

  it("recognises the directive and the import shapes it must refuse", () => {
    expect.hasAssertions();
    expect(isClientFile('"use client";\nimport x from "y";')).toBe(true);
    expect(isClientFile("// header\n/* c */\n'use client'\n")).toBe(true);
    expect(isClientFile('import x from "y";\n"use client";')).toBe(false);
    expect(isClientFile('"use server";')).toBe(false);
    expect(VALUE_API_IMPORT.test('import { STAFF_ROLES } from "@/lib/api/staff";')).toBe(true);
    expect(VALUE_API_IMPORT.test('import { a, type B } from "@/lib/api/staff";')).toBe(true);
    expect(VALUE_API_IMPORT.test('import "@/lib/api/staff";')).toBe(true);
    expect(VALUE_API_IMPORT.test('export { x } from "@/lib/api/staff";')).toBe(true);
    expect(VALUE_API_IMPORT.test('import { x } from "../../lib/api/staff";')).toBe(true);
    expect(VALUE_API_IMPORT.test('import type { B } from "@/lib/api/staff";')).toBe(false);
    expect(VALUE_API_IMPORT.test('export type { B } from "@/lib/api/staff";')).toBe(false);
    expect(VALUE_API_IMPORT.test('import { x } from "@/lib/staff/roles";')).toBe(false);
    expect(VALUE_API_IMPORT.test('import { x } from "@/app/account/security/actions";')).toBe(
      false,
    );
  });

  it("tells a pure-data lib/api module from one that reaches next/headers", () => {
    expect.hasAssertions();
    const api = (name: string) => join(SRC, "lib", "api", name);
    expect(reachesServerOnly(api("client.ts"))).toBe(true);
    expect(reachesServerOnly(api("staff.ts"))).toBe(true);
    expect(reachesServerOnly(api("two-step.ts"))).toBe(true);
    expect(reachesServerOnly(api("finance-read-models.ts"))).toBe(false);
    expect(reachesServerOnly(api("security-transitions.ts"))).toBe(false);
  });

  it("includes the Wave 1e Client Components", () => {
    expect.hasAssertions();
    const names = clients.map((file) => relative(SRC, file).split(sep).join("/"));
    expect(names).toContain("components/account/two-step-panel.tsx");
    expect(names).toContain("components/settings/users/two-step-policy-card.tsx");
    expect(names).toContain("app/login/verify/verify-code-form.tsx");
  });

  it.each(clients.map((file) => [relative(SRC, file).split(sep).join("/"), file] as const))(
    "%s has no non-type import of a server-only module from @/lib/api/",
    (_name, file) => {
      expect.hasAssertions();
      expect(serverOnlyApiImports(file)).toEqual([]);
    },
  );
});
