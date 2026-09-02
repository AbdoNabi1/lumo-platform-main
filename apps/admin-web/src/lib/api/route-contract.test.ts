import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type * as ClientModule from "./client";

/**
 * T6.2 (Phase 6 safety net): asserts every path this app's `lib/api/*.ts` files call actually
 * exists in `adminRoutes()` — turning "the frontend calls a route that was renamed/removed" from
 * a production 404 into a red CI run, per `docs/plans/PHASE-5-6-backlog.md`.
 *
 * Two halves, deliberately not sharing an execution environment:
 *
 * 1. **The real route table** (`realRoutes` below) is read as plain text, not imported. Importing
 *    `apps/admin/src/http/admin-routes.ts` here would drag `zod`/`@platform/http`/`@platform/*`
 *    into `admin-web`'s dependency graph for a test-only need — those packages are not declared
 *    dependencies of `admin-web` (by design: `admin-web` only ever talks to the runtime API over
 *    HTTP, never imports backend code — see `docs/plans/README.md`'s "Architecture you must
 *    respect"). `extractRoutes` instead walks every `apps/admin/src/http/*-routes.ts` file's
 *    source text for `defineRoute({ method, path, version, ... })` calls (brace-balanced, so
 *    nested `schema: {...}` objects don't truncate the match) and reads the three literal fields
 *    off each — no execution, no dependency on anything `defineRoute` itself pulls in.
 *
 * 2. **What this app actually calls** is captured by REAL execution: every exported function in
 *    every `lib/api/*.ts` file (this directory) is called with a "chameleon" placeholder for each
 *    argument — an object that is simultaneously callable, chainable through any property access,
 *    and stringifies to the fixed marker `PARAM` — while `./client`'s `getAdminApi`/
 *    `mutateAdminApi` are mocked to record the `path`/method they were called with instead of
 *    hitting the network. Real execution (rather than re-deriving path strings via a second,
 *    parallel regex pass) is what lets this survive helper functions like `orders.ts`'s
 *    `orderPath(orderId, suffix)` without special-casing them here: whatever the function actually
 *    builds is what gets captured, exactly as a real caller would send it.
 */

const HTTP_DIR = path.resolve(__dirname, "../../../../admin/src/http");
const API_DIR = __dirname;

interface RealRoute {
  readonly method: string;
  readonly version: number;
  readonly path: string;
  readonly file: string;
}

/**
 * Finds the text span of a balanced `{ ... }` starting at `openBraceIndex`, skipping over
 * string/template contents AND `//`/`/* *‍/` comments — every `defineRoute({...})` block in this
 * codebase carries doc comments, and prose apostrophes ("caller's", "doesn't") would otherwise be
 * misread as unterminated single-quoted strings, corrupting the brace count for the rest of the
 * file.
 */
function findMatchingBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces starting at index ${openBraceIndex}`);
}

function extractRoutesFromFile(filePath: string): RealRoute[] {
  const text = readFileSync(filePath, "utf8");
  const file = path.basename(filePath);
  const routes: RealRoute[] = [];
  const marker = "defineRoute({";
  let searchFrom = 0;
  for (;;) {
    const markerIndex = text.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;
    const openBrace = markerIndex + marker.length - 1;
    const closeBrace = findMatchingBrace(text, openBrace);
    const block = text.slice(openBrace, closeBrace + 1);
    searchFrom = closeBrace + 1;

    const methodMatch = /method:\s*"([A-Z]+)"/.exec(block);
    const pathMatch = /path:\s*"([^"]+)"/.exec(block);
    const versionMatch = /version:\s*(\d+)/.exec(block);
    if (methodMatch === null || pathMatch === null || versionMatch === null) {
      throw new Error(`${file}: defineRoute block at index ${markerIndex} is missing method/path/version`);
    }
    routes.push({
      method: methodMatch[1]!,
      path: pathMatch[1]!,
      version: Number(versionMatch[1]),
      file,
    });
  }
  return routes;
}

function loadRealRoutes(): readonly RealRoute[] {
  const files = readdirSync(HTTP_DIR).filter(
    (f) => f.endsWith("-routes.ts") && !f.endsWith(".test.ts"),
  );
  expect(files.length).toBeGreaterThan(30); // sanity: the http directory didn't move/empty out
  return files.flatMap((f) => extractRoutesFromFile(path.join(HTTP_DIR, f)));
}

/** `/api/v<version><path>`'s segments, e.g. `["", "api", "v1", "orders", ":orderId", "refund"]`. */
function realRouteSegments(route: RealRoute): readonly string[] {
  return `/api/v${route.version}${route.path}`.split("/");
}

/** A capture is a wildcard match against ANY real segment (static or `:param`) at that position — see the module doc comment for why this stays permissive rather than parsing param names out. */
function pathMatchesRoute(capturedSegments: readonly string[], route: RealRoute): boolean {
  const real = realRouteSegments(route);
  if (capturedSegments.length !== real.length) return false;
  return capturedSegments.every((seg, i) => seg === "PARAM" || seg === real[i]);
}

const PARAM = "PARAM";

/**
 * A placeholder that survives being: called, property-accessed (chained arbitrarily deep, e.g.
 * `query.first`), and coerced to a string (template interpolation, `String(x)`,
 * `encodeURIComponent(x)`) — always producing the literal text `PARAM`. Deliberately NOT
 * `Array.isArray`-true or thenable (`.then` is `undefined`) so callers that branch on those don't
 * follow a path this placeholder can't fake.
 */
function makeParamToken(): unknown {
  const target = function paramToken(): unknown {
    return proxy;
  };
  const handler: ProxyHandler<typeof target> = {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => PARAM;
      if (prop === "toString" || prop === "valueOf") return () => PARAM;
      if (prop === "then" || prop === Symbol.iterator) return undefined;
      return proxy;
    },
    apply() {
      return proxy;
    },
  };
  const proxy: unknown = new Proxy(target, handler);
  return proxy;
}

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly file: string;
  readonly fn: string;
}

const captures: Capture[] = [];
let currentFile = "";
let currentFn = "";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getAdminApi: vi.fn((requestPath: string) => {
      captures.push({ method: "GET", path: requestPath, file: currentFile, fn: currentFn });
      return Promise.resolve({ outcome: "error", message: "mocked" });
    }),
    mutateAdminApi: vi.fn(
      (requestPath: string, init: { readonly method: string }) => {
        captures.push({ method: init.method, path: requestPath, file: currentFile, fn: currentFn });
        return Promise.resolve({ outcome: "error", message: "mocked" });
      },
    ),
  };
});

async function callEveryExportedFunction(): Promise<void> {
  const files = readdirSync(API_DIR).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      f !== "client.ts" &&
      f !== "mutation.ts",
  );
  expect(files.length).toBeGreaterThan(20); // sanity: this directory didn't move/empty out

  for (const file of files) {
    currentFile = file;
    const moduleName = file.slice(0, -".ts".length);
    // The "../api/…" (not "./…") relative form is deliberate: Vite's dynamic-import-vars plugin
    // refuses a runtime-computed specifier that imports from a test file's own directory
    // ("Variable imports cannot import their own directory"); routing through the parent avoids
    // that restriction while resolving to the exact same file.
    const mod: Record<string, unknown> = await import(`../api/${moduleName}.ts`);
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;
      currentFn = name;
      const args = Array.from({ length: value.length }, () => makeParamToken());
      try {
        await value(...args);
      } catch {
        // Best-effort: a handful of functions need a shape the placeholder can't fake
        // (e.g. a real array to .map over before the path is even built). Whatever this
        // function reached before throwing is still captured; only that one call's remainder
        // is lost, not the module.
      }
    }
  }
}

describe("admin-web route contract (T6.2)", () => {
  it("every lib/api path exists in adminRoutes()", async () => {
    const realRoutes = loadRealRoutes();
    await callEveryExportedFunction();
    expect(captures.length).toBeGreaterThan(50); // sanity: the harness actually captured calls

    const misses = captures.filter((capture) => {
      const segments = capture.path.split("?")[0]!.split("/");
      return !realRoutes.some(
        (route) => route.method === capture.method && pathMatchesRoute(segments, route),
      );
    });

    if (misses.length > 0) {
      const detail = misses
        .map((m) => `  ${m.method} ${m.path}  (lib/api/${m.file} → ${m.fn}())`)
        .join("\n");
      throw new Error(
        `${misses.length} call(s) in lib/api/*.ts have no matching route in adminRoutes():\n${detail}`,
      );
    }
  });
});
