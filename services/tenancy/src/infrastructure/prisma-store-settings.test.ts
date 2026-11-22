import { beforeEach, describe, expect, it } from "vitest";
import type { Database, TransactionClient } from "@platform/db";
import { StoreSettings } from "../domain/store-settings";
import { PrismaStoreSettingsRepository } from "./prisma-repositories";

interface Call {
  readonly op: string;
  readonly args: unknown;
}

interface FakeOptions {
  /** What `upsert` returns; defaults to the merged `create`/`update` data over the stored row. */
  readonly upsertRow?: Record<string, unknown>;
  readonly createManyCount?: number;
  readonly updateManyCount?: number;
}

function fakeClient(row: Record<string, unknown> | null, options: FakeOptions = {}) {
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
        const { create, update } = args as {
          create?: Record<string, unknown>;
          update?: Record<string, unknown>;
        };
        return (
          options.upsertRow ?? {
            siteType: "store",
            siteTypeSettledAt: null,
            ...row,
            ...create,
            ...update,
          }
        );
      },
      createMany: async (args: unknown) => {
        calls.push({ op: "createMany", args });
        return { count: options.createManyCount ?? 0 };
      },
      updateMany: async (args: unknown) => {
        calls.push({ op: "updateMany", args });
        return { count: options.updateManyCount ?? 0 };
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

const AT = new Date("2026-11-20T10:00:00.000Z");

describe("PrismaStoreSettingsRepository", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("reads the row of the tenant it is asked about, scoped to that tenant, and maps it", async () => {
    const { client, calls } = fakeClient({
      tenantId: "tenant-a",
      storeName: "Lumo",
      contactEmail: null,
      currency: "SAR",
      timezone: "Asia/Riyadh",
      weightUnit: "g",
      siteType: "store",
      siteTypeSettledAt: null,
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

  it("scopes a save made without a transaction to the tenant it is given", async () => {
    const { client, calls } = fakeClient(null);
    await new PrismaStoreSettingsRepository(deps(client)).save(
      "tenant-c",
      StoreSettings.defaults().withSetupGuideDismissed(new Date("2026-10-16T10:00:00.000Z")),
    );
    expect(calls.map((call) => call.op)).toEqual(["set_config", "upsert"]);
    expect(calls[0]?.args).toBe("tenant-c");
    expect(calls[1]?.args).toMatchObject({
      where: { tenantId: "tenant-c" },
      create: { tenantId: "tenant-c", setupGuideDismissedAt: new Date("2026-10-16T10:00:00.000Z") },
    });
  });

  it("save never writes the site-type columns, on create or on update", async () => {
    const { client, calls } = fakeClient(null);
    await new PrismaStoreSettingsRepository(deps(client)).save(
      "tenant-a",
      StoreSettings.defaults().withSiteType("lead_site"),
    );
    const args = calls.find((call) => call.op === "upsert")?.args as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(Object.keys(args.create)).not.toContain("siteType");
    expect(Object.keys(args.create)).not.toContain("siteTypeSettledAt");
    expect(Object.keys(args.update)).not.toContain("siteType");
    expect(Object.keys(args.update)).not.toContain("siteTypeSettledAt");
    expect(args.create.tenantId).toBe("tenant-a");
  });

  it("modify reads, changes and upserts in one tenant scope and reports the persisted row", async () => {
    const stored = {
      tenantId: "tenant-a",
      storeName: "Lumo",
      contactEmail: null,
      currency: "SAR",
      timezone: "Asia/Riyadh",
      weightUnit: "g",
      siteType: "store",
      siteTypeSettledAt: null,
    };
    const { client, calls } = fakeClient(stored, {
      upsertRow: { ...stored, siteType: "lead_site", siteTypeSettledAt: AT },
    });
    const result = await new PrismaStoreSettingsRepository(deps(client)).modify(
      "tenant-a",
      (current) => current,
    );
    expect(calls.map((call) => call.op)).toEqual(["set_config", "findFirst", "upsert"]);
    expect(calls[0]?.args).toBe("tenant-a");
    expect(result.siteType).toBe("lead_site");
    expect(result.currency).toBe("SAR");
  });

  it("modify starts from the defaults when the shop has no row", async () => {
    const { client, calls } = fakeClient(null);
    let seen: StoreSettings | undefined;
    await new PrismaStoreSettingsRepository(deps(client)).modify("tenant-a", (current) => {
      seen = current;
      return current;
    });
    expect(seen?.currency).toBe("EGP");
    expect(calls.map((call) => call.op)).toEqual(["set_config", "findFirst", "upsert"]);
  });

  it("settleSignupSiteType creates the settled row when none exists", async () => {
    const { client, calls } = fakeClient(
      { siteType: "lead_site", siteTypeSettledAt: AT },
      { createManyCount: 1 },
    );
    const settled = await new PrismaStoreSettingsRepository(deps(client)).settleSignupSiteType(
      "tenant-b",
      "lead_site",
      AT,
    );
    expect(settled).toBe("lead_site");
    expect(calls).toEqual([
      { op: "set_config", args: "tenant-b" },
      {
        op: "createMany",
        args: {
          data: [{ tenantId: "tenant-b", siteType: "lead_site", siteTypeSettledAt: AT }],
          skipDuplicates: true,
        },
      },
      { op: "findFirst", args: { where: { tenantId: "tenant-b" } } },
    ]);
  });

  it("settleSignupSiteType only updates an unsettled row, then reports what is persisted", async () => {
    const { client, calls } = fakeClient(
      { siteType: "store", siteTypeSettledAt: AT },
      { createManyCount: 0, updateManyCount: 0 },
    );
    const settled = await new PrismaStoreSettingsRepository(deps(client)).settleSignupSiteType(
      "tenant-b",
      "lead_site",
      AT,
    );
    expect(settled).toBe("store");
    expect(calls.map((call) => call.op)).toEqual([
      "set_config",
      "createMany",
      "updateMany",
      "findFirst",
    ]);
    expect(calls[2]?.args).toEqual({
      where: { tenantId: "tenant-b", siteTypeSettledAt: null },
      data: { siteType: "lead_site", siteTypeSettledAt: AT },
    });
  });

  it("rejects a stored row with an unknown site_type", async () => {
    const { client } = fakeClient({
      tenantId: "tenant-a",
      storeName: "",
      contactEmail: null,
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
      siteType: "shop",
      siteTypeSettledAt: null,
    });
    await expect(new PrismaStoreSettingsRepository(deps(client)).get("tenant-a")).rejects.toThrow(
      /site_type/,
    );
  });
});
