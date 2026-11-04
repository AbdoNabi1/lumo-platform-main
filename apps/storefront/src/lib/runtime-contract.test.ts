// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Final review M-7: the storefront and the admin API agree on the public online-store paths only
 * through two separate tests, each pinning its own side, so a rename on one side could be "fixed" in
 * that side's test alone while every storefront started answering 503. This one reads BOTH sides'
 * source text (as admin-web's `route-contract.test.ts` does: no backend package is imported) and ties
 * them: every path the storefront calls must be a route the admin API serves, and every route the
 * admin API serves for the storefront must be used by it. Text, not execution: no mocks to drift.
 */

const SRC_DIR = path.resolve(__dirname, "..");
const ROUTES_FILE = path.resolve(
  __dirname,
  "../../../admin/src/http/public-online-store-routes.ts",
);

/** Every non-test source file under the storefront's `src`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** `{ method, path, version }` of each `defineRoute({...})` in the admin file, read off the text. */
function adminRoutes(): { method: string; path: string; version: number }[] {
  const text = readFileSync(ROUTES_FILE, "utf8");
  const found = [
    ...text.matchAll(
      /defineRoute\(\{\s*method:\s*"(\w+)",\s*path:\s*"([^"]+)",\s*version:\s*(\d+)/g,
    ),
  ];
  return found.map(([, method, route, version]) => ({
    method: method!,
    path: route!,
    version: Number(version),
  }));
}

/** Each fetch the storefront makes to a public online-store route: its path and the file it is in. */
function storefrontCalls(): { path: string; file: string; text: string }[] {
  return sourceFiles(SRC_DIR).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/\/api\/v1(\/public\/online-store[\w/-]*)/g)].map((match) => ({
      path: match[1]!,
      file: path.relative(SRC_DIR, file).replaceAll("\\", "/"),
      text,
    }));
  });
}

describe("storefront <-> admin API: the public online-store routes", () => {
  const routes = adminRoutes();
  const calls = storefrontCalls();

  it("reads the admin route table and the storefront's calls (not an empty comparison)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("serves every route as version 1, the /api/v1 the storefront calls", () => {
    expect(routes.every((r) => r.version === 1)).toBe(true);
  });

  it("every path the storefront calls is a route the admin API serves", () => {
    const served = new Set(routes.map((r) => r.path));
    for (const call of calls) {
      expect(served.has(call.path), `${call.file} calls ${call.path}`).toBe(true);
    }
  });

  it("every route the admin API serves here is called by the storefront", () => {
    const called = new Set(calls.map((c) => c.path));
    for (const route of routes) {
      expect(called.has(route.path), `${route.method} ${route.path} is unused`).toBe(true);
    }
  });

  it("the unlock route is a POST and the storefront posts to it; the reads are GETs", () => {
    const methodOf = new Map(routes.map((r) => [r.path, r.method]));
    expect(methodOf.get("/public/online-store/unlock")).toBe("POST");
    expect(methodOf.get("/public/online-store")).toBe("GET");
    expect(methodOf.get("/public/online-store/access")).toBe("GET");
    const unlock = calls.find((c) => c.path === "/public/online-store/unlock");
    expect(unlock?.text).toMatch(/method:\s*"POST"/);
  });
});
