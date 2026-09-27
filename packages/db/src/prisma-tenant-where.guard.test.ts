import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * WP-10 definition of done — the Prisma tenant filter, guarded uniformly.
 *
 * RLS protects nothing on the application's path today (ADR-0014 point 6), so `where: { tenantId }` in
 * each repository is the only wall between tenants. Before this guard, removing that filter from the
 * orders, catalog or inventory repositories turned NOTHING red: only finance accounts and security
 * principals had a fake-backed isolation test. `scripts/dev/check-prisma-tenant-where.mjs` closes that
 * for every repository at once; this file proves the script itself can fail (a guard that cannot fail is
 * worse than none) and that the real tree currently passes it.
 */
interface Scan {
  violations: string[];
  stale: string[];
  open: Array<[string, { cls: string; reason: string }]>;
}
type Scanner = (root: string) => Scan;

const repoRoot = resolve(__dirname, "..", "..", "..");
async function scanner(): Promise<Scanner> {
  const url = pathToFileURL(join(repoRoot, "scripts", "dev", "check-prisma-tenant-where.mjs")).href;
  return ((await import(/* @vite-ignore */ url)) as { scanPrismaTenantWhere: Scanner })
    .scanPrismaTenantWhere;
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "prisma-where-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}
const repo = (body: string) => ({
  "services/widgets/src/infrastructure/prisma-widget-repository.ts": `
    export class R {
      async f(id: string, tenantId: string) {
        ${body}
      }
    }`,
});

describe("check-prisma-tenant-where: the real tree", () => {
  it("has no Prisma read/update/delete without a tenant in its where, and no stale exemption", async () => {
    const result = (await scanner())(repoRoot);
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it("has no KNOWN GAPS left open (G-75, G-76 closed 2026-09-27)", async () => {
    const { open } = (await scanner())(repoRoot);
    expect(open.map(([key]) => key)).toEqual([]);
  });

  it.each([
    [
      "orders findById",
      "services/orders/src/infrastructure/prisma-order-repository.ts",
      "where: { id, tenantId },",
      "where: { id },",
    ],
    [
      "catalog product findById",
      "services/catalog/src/infrastructure/prisma-catalog-repositories.ts",
      "where: { id, tenantId, deletedAt: null },\n        include: { variants: true },",
      "where: { id, deletedAt: null },\n        include: { variants: true },",
    ],
    [
      "inventory findById",
      "services/inventory/src/infrastructure/prisma-inventory-item-repository.ts",
      "where: { id, tenantId },\n        include: { reservations: true },",
      "where: { id },\n        include: { reservations: true },",
    ],
    [
      "tracking appendHistory/get base-row lookup (G-75)",
      "apps/runtime/src/tracking/prisma-event-record-store.ts",
      "where: { tenantId: input.tenantId, eventId: input.eventId },",
      "where: { eventId: input.eventId },",
    ],
    [
      "catalog productVariant upsert-by-id-alone (G-76)",
      "services/catalog/src/infrastructure/prisma-catalog-repositories.ts",
      "where: { id: row.id, tenantId },",
      "where: { id: row.id },",
    ],
    [
      "payments refund upsert-by-id-alone (G-76)",
      "services/payments/src/infrastructure/prisma-payment-intent-repository.ts",
      "where: { id: refund.id, tenantId },",
      "where: { id: refund.id },",
    ],
  ])(
    "the exact mutation that used to be invisible is caught: %s loses its tenant filter",
    async (_label, file, from, to) => {
      // Line endings are normalised first. git is configured with core.autocrlf=true on Windows, so
      // on a fresh clone every source file is CRLF while the multi-line snippets above are written
      // with LF — without this, two of these cases fail for a reason that has nothing to do with the
      // tenant filter they exist to guard, which is the worst possible failure mode for a guard test.
      const original = readFileSync(join(repoRoot, file), "utf8").replaceAll("\r\n", "\n");
      expect(original).toContain(from);
      const root = fixture({ [file]: original.replace(from, to) });
      const { violations } = (await scanner())(root);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain(file);
    },
  );
});

describe("check-prisma-tenant-where: it can fail", () => {
  it("accepts a where that names the tenant", async () => {
    const root = fixture(repo("return this.db.widget.findFirst({ where: { id, tenantId } });"));
    expect((await scanner())(root).violations).toEqual([]);
  });

  it.each([
    ["findFirst without the tenant", "return this.db.widget.findFirst({ where: { id } });"],
    ["findMany with no where", "return this.db.widget.findMany({ orderBy: { id: 'asc' } });"],
    ["findMany with no arguments", "return this.db.widget.findMany();"],
    ["count with no arguments", "return this.db.widget.count();"],
    [
      "updateMany without the tenant",
      "return this.db.widget.updateMany({ where: { id, version: 1 }, data: {} });",
    ],
    ["deleteMany without the tenant", "return this.db.widget.deleteMany({ where: { id } });"],
    [
      "upsert addressed by id alone",
      "return this.db.widget.upsert({ where: { id }, create: { tenantId }, update: {} });",
    ],
    [
      "the tenant only in `data`, not in where",
      "return this.db.widget.update({ where: { id }, data: { tenantId } });",
    ],
    [
      "the tenant only in a nested include",
      "return this.db.widget.findFirst({ where: { id }, include: { rows: { where: { tenantId } } } });",
    ],
    [
      "a where built elsewhere that never mentions the tenant",
      "const where = { id };\n return this.db.widget.findFirst({ where });",
    ],
  ])("flags %s", async (_label, body) => {
    const root = fixture(repo(body));
    const { violations } = (await scanner())(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("widget.");
  });

  it("follows a shorthand where to the const that builds it", async () => {
    const root = fixture(
      repo("const where = { tenantId, id };\n return this.db.widget.findFirst({ where });"),
    );
    expect((await scanner())(root).violations).toEqual([]);
  });

  it("ignores create, and ignores calls that are not Prisma-shaped (Map.delete, prose)", async () => {
    const root = fixture(
      repo(
        "this.store.delete(id);\n // this.db.widget.findMany({ where: { id } })\n return this.db.widget.create({ data: { tenantId } });",
      ),
    );
    expect((await scanner())(root).violations).toEqual([]);
  });
});
