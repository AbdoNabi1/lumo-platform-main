import { describe, expect, it } from "vitest";
import type { Database, TransactionClient } from "@platform/db";
import { StoreSettings } from "../domain/store-settings";
import { PrismaStoreSettingsRepository } from "./prisma-repositories";

interface Call {
  readonly op: string;
  readonly args: unknown;
}

function fakeClient(row: Record<string, unknown> | null) {
  const calls: Call[] = [];
  const client = {
    // `runReadScoped` opens a transaction on the database handle and sets the tenant first.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "set_config", args: values[0] });
      return 1;
    },
    storeSettings: {
      findFirst: async (args: unknown) => {
        calls.push({ op: "findFirst", args });
        return row;
      },
      upsert: async (args: unknown) => {
        calls.push({ op: "upsert", args });
        return row;
      },
    },
  };
  return { client: client as unknown as Database, calls };
}

const deps = (prisma: Database) => ({
  prisma,
  tenantId: "deployment-tenant",
  outbox: undefined as never,
  context: undefined as never,
});

describe("PrismaStoreSettingsRepository", () => {
  it("reads the row of the tenant it is asked about, scoped to that tenant, and maps it", async () => {
    const { client, calls } = fakeClient({
      tenantId: "tenant-a",
      storeName: "Lumo",
      contactEmail: null,
      currency: "SAR",
      timezone: "Asia/Riyadh",
      weightUnit: "g",
    });
    const found = await new PrismaStoreSettingsRepository(deps(client)).get("tenant-a");
    expect(found?.currency).toBe("SAR");
    expect(calls).toEqual([
      { op: "set_config", args: "tenant-a" },
      { op: "findFirst", args: { where: { tenantId: "tenant-a" } } },
    ]);
  });

  it("reuses the caller's transaction instead of opening a scoped read", async () => {
    const { client, calls } = fakeClient(null);
    await new PrismaStoreSettingsRepository(deps(client)).get(
      "tenant-b",
      client as never as TransactionClient,
    );
    expect(calls).toEqual([{ op: "findFirst", args: { where: { tenantId: "tenant-b" } } }]);
  });

  it("returns null when the shop has no row", async () => {
    const { client } = fakeClient(null);
    expect(await new PrismaStoreSettingsRepository(deps(client)).get("tenant-a")).toBeNull();
  });

  it("upserts under the tenant id it is given, not the one it was built for", async () => {
    const { client, calls } = fakeClient(null);
    const settings = StoreSettings.defaults();
    await new PrismaStoreSettingsRepository(deps(client)).save(
      "tenant-a",
      settings,
      client as never as TransactionClient,
    );
    expect(calls[0]?.op).toBe("upsert");
    expect(calls[0]?.args).toMatchObject({
      where: { tenantId: "tenant-a" },
      create: { tenantId: "tenant-a", currency: "EGP" },
      update: { currency: "EGP" },
    });
  });
});
