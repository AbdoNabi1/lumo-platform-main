import { describe, expect, it } from "vitest";
import { tenantRowIsolationCases, type TenantRowStore } from "./tenant-isolation";

/**
 * The harness's own proof-of-life: a correct store passes every case, and each deliberately leaky
 * store is caught by the case that targets that leak. If a case could not fail, an "all green"
 * run of every context suite built on it would mean nothing.
 */
interface Row {
  readonly tenant: string;
  readonly key: string;
  marker: string;
}

type Leak = "none" | "read" | "list" | "count" | "update" | "remove" | "overwrite";

function store(leak: Leak): TenantRowStore {
  const rows: Row[] = [];
  const visible = (tenant: string, ignoreTenant: boolean) =>
    rows.filter((r) => ignoreTenant || r.tenant === tenant);
  return {
    async insert(tenant, key, marker) {
      // `overwrite`: the natural key alone identifies the row, so a second tenant clobbers the first.
      const existing = rows.find(
        (r) => r.key === key && (leak === "overwrite" || r.tenant === tenant),
      );
      if (existing !== undefined) existing.marker = marker;
      else rows.push({ tenant, key, marker });
    },
    async find(tenant, key) {
      return visible(tenant, leak === "read").find((r) => r.key === key)?.marker ?? null;
    },
    async list(tenant) {
      return visible(tenant, leak === "list").map((r) => r.marker);
    },
    async count(tenant) {
      return visible(tenant, leak === "count").length;
    },
    async update(tenant, key, marker) {
      const row = visible(tenant, leak === "update").find((r) => r.key === key);
      if (row === undefined) throw new Error("not found");
      row.marker = marker;
    },
    async remove(tenant, key) {
      const row = visible(tenant, leak === "remove").find((r) => r.key === key);
      if (row !== undefined) rows.splice(rows.indexOf(row), 1);
    },
  };
}

async function failures(leak: Leak): Promise<string[]> {
  const cases = tenantRowIsolationCases({
    context: "self-test",
    layer: leak,
    make: () => store(leak),
  });
  const failed: string[] = [];
  for (const c of cases) {
    try {
      await c.run();
    } catch {
      failed.push(c.name.split(": ")[1] ?? c.name);
    }
  }
  return failed;
}

describe("tenantRowIsolationCases can fail", () => {
  it("passes a correctly tenant-scoped store", async () => {
    expect(await failures("none")).toEqual([]);
  });

  it.each([
    ["read", "A cannot read B's row"],
    ["list", "A cannot read B's row"],
    ["update", "A cannot write B's row"],
    ["remove", "A cannot delete B's row"],
    ["count", "A cannot count B's rows"],
    ["overwrite", "the same key under two tenants"],
  ] as const)("catches a store that leaks on %s", async (leak, expected) => {
    const failed = await failures(leak);
    expect(failed.some((name) => name.startsWith(expected))).toBe(true);
  });

  it("a count that ignores the tenant is caught even when list is correct", async () => {
    const failed = await failures("count");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("cannot count");
  });
});
