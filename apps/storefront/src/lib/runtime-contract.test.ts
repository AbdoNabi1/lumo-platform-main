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
 *
 * Review M-3: the storefront -> admin direction covers EVERY `/public/…` call in storefront source,
 * checked against every public route in `apps/admin/src/http`, so a misspelt path is caught however
 * it is spelt. The admin -> storefront direction stays on the two files whose routes only the
 * storefront uses. Comments are stripped before scanning, so a path in prose is never a call.
 */

const SRC_DIR = path.resolve(__dirname, "..");
const ADMIN_HTTP_DIR = path.resolve(__dirname, "../../../admin/src/http");
/** Preflight 11: the shell routes, and (Part 2) the policy and page routes kept in their own file. */
const STOREFRONT_ROUTES_FILES = ["public-online-store-routes.ts", "public-content-routes.ts"].map(
  (file) => path.join(ADMIN_HTTP_DIR, file),
);

/** A path parameter, whatever each side names it: `:type` on the admin, `${type}` in a fetch. */
const PARAM = ":param";
const ADMIN_PARAM = /:\w+/g;
const TEMPLATE_PARAM = /\$\{[^}]*\}/g;

/**
 * A call to a public route: a string or template literal that is (or, after `/api/v1`, continues
 * as) a `/public/<family>…` path. The path must start right after a quote, a backtick or `/api/v1`.
 */
const CALL = /(?:["'`]|\/api\/v1)(\/public\/[\w-]+(?:[\w/-]|\$\{[^}]*\})*)/g;

/**
 * Removes `//` and `/* *\/` comments and keeps string and template literals whole, so a `//` inside
 * `"http://…"` is not a comment. A scanner, not a parser: good enough for this source tree, and the
 * self-test below pins the cases that matter.
 */
const COMMENT_OR_STRING =
  /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
function stripComments(text: string): string {
  return text.replace(COMMENT_OR_STRING, (_match, literal: string | undefined) => literal ?? "");
}

/** Every non-test source file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

type AdminRoute = { method: string; path: string; version: number; file: string };

/** `{ method, path, version }` of each `defineRoute({...})` in an admin file, read off the text. */
function routesIn(file: string): AdminRoute[] {
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
}

/** The public paths one source text calls, comments stripped, parameters as `:param`. */
function callsIn(text: string): string[] {
  return [...stripComments(text).matchAll(CALL)].map((match) =>
    match[1]!.replace(TEMPLATE_PARAM, PARAM),
  );
}

/** The calls in one source text that no served route answers. */
function unservedCalls(text: string, served: ReadonlySet<string>): string[] {
  return callsIn(text).filter((call) => !served.has(call));
}

/** Each public call the storefront makes: its path and the file it is in. */
function storefrontCalls(): { path: string; file: string; text: string }[] {
  return sourceFiles(SRC_DIR).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return callsIn(text).map((call) => ({
      path: call,
      file: path.relative(SRC_DIR, file).replaceAll("\\", "/"),
      text,
    }));
  });
}

describe("storefront <-> admin API: the public online-store, policy and page routes", () => {
  /** The routes only the storefront uses: each must be called. */
  const routes = STOREFRONT_ROUTES_FILES.flatMap(routesIn);
  /** Every public route the admin API serves: each storefront call must be one of them. */
  const publicRoutes = sourceFiles(ADMIN_HTTP_DIR)
    .flatMap(routesIn)
    .filter((r) => r.path.startsWith("/public/"));
  const calls = storefrontCalls();

  it("reads the admin route tables and the storefront's calls (not an empty comparison)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(new Set(routes.map((r) => r.file)).size).toBe(STOREFRONT_ROUTES_FILES.length);
    expect(publicRoutes.length).toBeGreaterThan(routes.length);
    expect(new Set(publicRoutes.map((r) => r.file)).size).toBeGreaterThan(2);
    // Every family the storefront calls, not only the online-store, policy and page ones.
    expect(calls.length).toBeGreaterThanOrEqual(40);
    expect(calls.some((c) => c.path.startsWith("/public/carts"))).toBe(true);
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

  it("flags a misspelt path and ignores commented ones (review M-3 self-test)", () => {
    const served = new Set(["/public/policies/:param", "/public/store"]);
    const source = [
      "fetchJson(shopId, `/public/policy/${type}`);",
      "fetch(`${RUNTIME_API_URL}/api/v1/public/store`);",
      '// fetch("/public/commented-out");',
      "/* `/public/also-commented` */",
      'const url = "http://x.example/api/v1/public/store";',
    ].join("\n");
    expect(unservedCalls(source, served)).toEqual(["/public/policy/:param"]);
  });

  it("serves every route as version 1, the /api/v1 the storefront calls", () => {
    expect(routes.every((r) => r.version === 1)).toBe(true);
  });

  it("every public path the storefront calls is a route the admin API serves", () => {
    const served = new Set(publicRoutes.map((r) => r.path));
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
