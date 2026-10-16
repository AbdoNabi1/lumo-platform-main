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
  tenantId: "tenant-a",
  outbox: undefined as never,
  context: undefined as never,
});

describe("PrismaStoreSettingsRepository", () => {
  it("reads only its own tenant's row and maps it", async () => {
    const { client, calls } = fakeClient({
      tenantId: "tenant-a",
      storeName: "Lumo",
      contactEmail: null,
      currency: "SAR",
      timezone: "Asia/Riyadh",
      weightUnit: "g",
    });
    const found = await new PrismaStoreSettingsRepository(deps(client)).get();
    expect(found?.currency).toBe("SAR");
    expect(calls[0]).toEqual({ op: "findFirst", args: { where: { tenantId: "tenant-a" } } });
  });

  it("returns null when the shop has no row", async () => {
    const { client } = fakeClient(null);
    expect(await new PrismaStoreSettingsRepository(deps(client)).get()).toBeNull();
  });

  it("upserts under its own tenant id", async () => {
    const { client, calls } = fakeClient(null);
    const settings = StoreSettings.defaults();
    await new PrismaStoreSettingsRepository(deps(client)).save(
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
