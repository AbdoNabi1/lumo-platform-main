import { beforeEach, describe, expect, it } from "vitest";

import { PrismaTrackingRegistryStore } from "./tracking-registry";
import { fakeTrackingDb } from "./testing/fake-tracking-db";

beforeEach(() => {
  expect.hasAssertions();
});

const AT = new Date("2026-11-24T10:00:00.000Z");
let counter = 0;
const ids = { generate: () => `id-${String((counter += 1))}` };

function row(key: string, version: number) {
  return {
    kind: "destination" as const,
    key,
    version,
    status: "active",
    value: { key },
    at: AT,
  };
}

describe("PrismaTrackingRegistryStore.withTenantRegistryTransaction", () => {
  it("takes the per-tenant advisory lock first, with the key as a bound parameter", async () => {
    const db = fakeTrackingDb();
    const store = new PrismaTrackingRegistryStore(db.prisma as never, ids);

    await store.withTenantRegistryTransaction("t-1", async (writer) => {
      await writer.loadAll();
    });

    expect(db.statements.map((s) => s.sql)).toEqual([
      "SELECT set_config('app.tenant_id', ?, true)",
      "SELECT pg_advisory_xact_lock(hashtext(?))",
    ]);
    expect(db.statements.map((s) => s.values)).toEqual([["t-1"], ["tracking-registry:t-1"]]);
  });

  it("appends and loads on the transaction client, naming the tenant", async () => {
    const db = fakeTrackingDb();
    const store = new PrismaTrackingRegistryStore(db.prisma as never, ids);

    await store.withTenantRegistryTransaction("t-1", async (writer) => {
      await writer.append(row("meta.capi", 1));
      expect((await writer.loadAll()).map((r) => `${r.key}@${String(r.version)}`)).toEqual([
        "meta.capi@1",
      ]);
    });
    await store.withTenantRegistryTransaction("t-2", async (writer) => {
      expect(await writer.loadAll()).toEqual([]);
    });

    expect(db.entries.map((e) => [e.tenantId, e.key, e.version, e.status])).toEqual([
      ["t-1", "meta.capi", 1, "active"],
    ]);
    expect(db.entries[0]?.registeredAt).toEqual(AT);
  });

  it("rolls every earlier append back when a later one fails", async () => {
    const db = fakeTrackingDb();
    const store = new PrismaTrackingRegistryStore(db.prisma as never, ids);
    db.failCreateNumber = 3;

    await expect(
      store.withTenantRegistryTransaction("t-1", async (writer) => {
        await writer.append(row("a", 1));
        await writer.append(row("b", 1));
        await writer.append(row("c", 1));
      }),
    ).rejects.toThrow("registry write failed");

    expect(db.entries).toEqual([]);
  });

  it("serializes two transactions of one tenant, so the second reads what the first wrote", async () => {
    const db = fakeTrackingDb();
    const store = new PrismaTrackingRegistryStore(db.prisma as never, ids);
    const seen: number[] = [];

    const run = (): Promise<void> =>
      store.withTenantRegistryTransaction("t-1", async (writer) => {
        const rows = await writer.loadAll();
        seen.push(rows.length);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await writer.append(row("meta.capi", rows.length + 1));
      });

    await Promise.all([run(), run()]);

    expect(seen).toEqual([0, 1]);
    expect(db.entries.map((e) => e.version)).toEqual([1, 2]);
  });
});
