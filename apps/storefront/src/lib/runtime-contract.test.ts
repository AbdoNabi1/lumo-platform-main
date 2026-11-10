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
/** Preflight 11: the shell routes, and (Part 2) the policy and page routes kept in their own file. */
const ROUTES_FILES = [
  "../../../admin/src/http/public-online-store-routes.ts",
  "../../../admin/src/http/public-content-routes.ts",
].map((file) => path.resolve(__dirname, file));

/** A path parameter, whatever each side names it: `:type` on the admin, `${type}` in a fetch. */
const PARAM = ":param";
const ADMIN_PARAM = /:\w+/g;
const TEMPLATE_PARAM = /\$\{[^}]*\}/g;

/**
 * A call to a public online-store, policy or page route: a string or template literal that is (or,
 * after `/api/v1`, continues as) the path. Prose such as "GET /public/pages" in a comment is not a
 * call, because the path must start right after a quote, a backtick or `/api/v1`.
 */
const CALL =
  /(?:["'`]|\/api\/v1)(\/public\/(?:online-store|policies|pages)(?:[\w/-]|\$\{[^}]*\})*)/g;

/** Every non-test source file under the storefront's `src`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** `{ method, path, version }` of each `defineRoute({...})` in the admin files, read off the text. */
function adminRoutes(): { method: string; path: string; version: number; file: string }[] {
  return ROUTES_FILES.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const found = [
      ...text.matchAll(
        /defineRoute\(\{\s*method:\s*"(\w+)",\s*path:\s*"([^"]+)",\s*version:\s*(\d+)/g,
      ),
    ];
    return found.map(([, method, route, version]) => ({
      method: method!,
      path: route!.replace(ADMIN_PARAM, PARAM),
      version: Number(version),
      file: path.basename(file),
    }));
  });
}

/** Each fetch the storefront makes to one of those routes: its path and the file it is in. */
function storefrontCalls(): { path: string; file: string; text: string }[] {
  return sourceFiles(SRC_DIR).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(CALL)].map((match) => ({
      path: match[1]!.replace(TEMPLATE_PARAM, PARAM),
      file: path.relative(SRC_DIR, file).replaceAll("\\", "/"),
      text,
    }));
  });
}

describe("storefront <-> admin API: the public online-store, policy and page routes", () => {
  const routes = adminRoutes();
  const calls = storefrontCalls();

  it("reads the admin route tables and the storefront's calls (not an empty comparison)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(new Set(routes.map((r) => r.file)).size).toBe(ROUTES_FILES.length);
  });

  it("matches a parameter on either side as one segment (the content routes)", () => {
    const served = new Set(routes.map((r) => r.path));
    for (const route of ["/public/policies/:param", "/public/pages/:param", "/public/pages"]) {
      expect(served.has(route), route).toBe(true);
    }
    const sample = "f(`${base}/api/v1/public/pages/${encodeURIComponent(h)}`)";
    expect([...sample.matchAll(CALL)].map((m) => m[1])).toEqual([
      "/public/pages/${encodeURIComponent(h)}",
    ]);
    expect([..."x(`/public/policies/${type}`)".matchAll(CALL)].map((m) => m[1])).toEqual([
      "/public/policies/${type}",
    ]);
    expect([..."// GET /public/pages/:handle".matchAll(CALL)]).toEqual([]);
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
    for (const read of ["/public/policies/:param", "/public/pages/:param", "/public/pages"]) {
      expect(methodOf.get(read), read).toBe("GET");
    }
    const unlock = calls.find((c) => c.path === "/public/online-store/unlock");
    expect(unlock?.text).toMatch(/method:\s*"POST"/);
  });
});
