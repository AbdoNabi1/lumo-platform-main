import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOT_TENANT_PINS,
  EVENT_PATH_TENANT_PINS,
  TENANT_DEFAULT_ID_SITES,
  assertWorkerTenantModeSupported,
} from "./tenant-mode-guard";

const CLASSIFICATION_TABLE = "apps/runtime/src/tenant-mode-guard.ts";
const repoRoot = resolve(__dirname, "..", "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "coverage", ".next", ".turbo"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every non-test, non-comment source line that references TENANT_DEFAULT_ID. */
function codeReferences(): { file: string; line: string }[] {
  const found: { file: string; line: string }[] = [];
  for (const root of ["apps", "services", "packages"]) {
    for (const path of sourceFiles(join(repoRoot, root))) {
      const file = relative(repoRoot, path).split(sep).join("/");
      if (file === CLASSIFICATION_TABLE) continue; // the table itself names the symbol
      for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
        if (!raw.includes("TENANT_DEFAULT_ID")) continue;
        const line = raw.trim();
        if (/^(\*|\/\/|\/\*)/.test(line)) continue; // comment-only lines are not references
        found.push({ file, line });
      }
    }
  }
  return found;
}

describe("TENANT_DEFAULT_ID classification (T10.4 / T10.7)", () => {
  it("classifies every non-comment reference — an unclassified one fails this test", () => {
    const actual = codeReferences().map((r) => `${r.file} :: ${r.line}`);
    const expected = TENANT_DEFAULT_ID_SITES.map((s) => `${s.file} :: ${s.line}`);
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it("has exactly one request-path site, and it is the admin API composition in api.ts", () => {
    const requestPath = TENANT_DEFAULT_ID_SITES.filter((s) => s.class === "request-path");
    expect(requestPath.map((s) => s.file)).toEqual(["apps/runtime/src/api.ts"]);
  });

  it("registers every event-path pin, so the worker guard names all of them", () => {
    const pinnedFiles = new Set(
      TENANT_DEFAULT_ID_SITES.filter((s) => s.class === "event-path-pin").map((s) => s.file),
    );
    const registered = new Set(EVENT_PATH_TENANT_PINS.map((p) => p.file));
    expect(registered).toEqual(pinnedFiles);
  });

  it("has NO event-path pin left (G-64): a new one must be classified here AND make the guard refuse", () => {
    expect(TENANT_DEFAULT_ID_SITES.filter((s) => s.class === "event-path-pin")).toEqual([]);
    expect(EVENT_PATH_TENANT_PINS).toEqual([]);
  });

  it("no event consumer reads TENANT_DEFAULT_ID — structurally, not by the table's say-so", () => {
    const consumerFiles = codeReferences()
      .map((r) => r.file)
      .filter(
        (f) =>
          /\/consumers\//.test(f) ||
          /\.consumers?\.ts$/.test(f) ||
          /\/interfaces\//.test(f) ||
          f === "apps/runtime/src/security/wire-security-identity.ts" ||
          f === "apps/runtime/src/tracking/tracking-ingest.ts",
      );
    expect(consumerFiles).toEqual([]);
  });

  it("the boot-time blockers the guard names are exactly the boot-pin sites", () => {
    const sites = new Set(
      TENANT_DEFAULT_ID_SITES.filter((s) => s.class === "boot-pin").map((s) => s.file),
    );
    expect(new Set(BOOT_TENANT_PINS.map((p) => p.file))).toEqual(sites);
  });

  it("has NO boot-time pin left (T10.6): provisioning runs the baseline per tenant", () => {
    expect(BOOT_TENANT_PINS).toEqual([]);
    expect(TENANT_DEFAULT_ID_SITES.filter((s) => s.class === "boot-pin")).toEqual([]);
  });

  it("the one remaining bootstrapSecurity call is classified as the platform tenant's, not a pin", () => {
    const site = TENANT_DEFAULT_ID_SITES.find((s) => s.line.includes("bootstrapSecurity"));
    expect(site?.class).toBe("platform-boot");
    expect(site?.file).toBe("apps/runtime/src/security/wire-security-provisioning.ts");
  });
});

describe("assertWorkerTenantModeSupported", () => {
  const off = { SECURITY_PRINCIPAL_PROVISIONING: false } as const;
  const on = { SECURITY_PRINCIPAL_PROVISIONING: true } as const;

  it("allows single mode, with or without provisioning", () => {
    expect(() => assertWorkerTenantModeSupported("single", off)).not.toThrow();
    expect(() => assertWorkerTenantModeSupported("single", on)).not.toThrow();
  });

  it("allows multi mode when nothing in the worker is still pinned to one tenant", () => {
    expect(() => assertWorkerTenantModeSupported("multi", off)).not.toThrow();
  });

  it("allows multi with principal provisioning on: the baseline is provisioned per tenant (T10.6)", () => {
    expect(() => assertWorkerTenantModeSupported("multi", on)).not.toThrow();
  });

  it("still refuses multi with provisioning on, and names the site, if a boot pin is registered", () => {
    const registered = [
      { file: "apps/runtime/src/security/new-boot.ts", what: "boots one tenant" },
    ];
    expect(() => assertWorkerTenantModeSupported("multi", on, [], registered)).toThrow(
      /new-boot\.ts/,
    );
    // A boot pin only blocks while its feature is on: with provisioning off it never runs.
    expect(() => assertWorkerTenantModeSupported("multi", off, [], registered)).not.toThrow();
  });

  it("refuses multi and names the site if an event-path pin is ever registered again", () => {
    const registered = [{ file: "apps/runtime/src/consumers/new.consumers.ts", what: "x" }];
    expect(() => assertWorkerTenantModeSupported("multi", off, registered)).toThrow(
      /new\.consumers\.ts/,
    );
  });

  it("is what startWorker runs first: the guard is called before anything is built", () => {
    const worker = readFileSync(join(repoRoot, "apps/runtime/src/worker.ts"), "utf8");
    const call = worker.indexOf("assertWorkerTenantModeSupported(config.TENANT_MODE, config)");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(worker.indexOf("core ?? buildRuntimeCore(config)"));
  });
});
