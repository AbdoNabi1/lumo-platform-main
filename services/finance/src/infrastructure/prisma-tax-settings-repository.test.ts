import { describe, expect, it } from "vitest";
import type { Database, TransactionClient } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { TaxSettings } from "../domain/tax-settings";
import { PrismaTaxSettingsRepository } from "./prisma-tax-settings-repository";

type Row = Record<string, unknown>;

/** A tiny stand-in for the two Prisma delegates, honouring only the `where` keys it is given. */
function fakeClient() {
  const settings: Row[] = [];
  const regions: Row[] = [];
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (typeof value === "object" && value !== null && "notIn" in value) {
        return !(value as { notIn: unknown[] }).notIn.includes(row[key]);
      }
      return row[key] === value;
    });
  const client = {
    taxSettings: {
      findFirst: async ({ where }: { where: Row }) =>
        settings.find((row) => matches(row, where)) ?? null,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const found = settings.find((row) => matches(row, where));
        if (found === undefined) settings.push({ ...create });
        else Object.assign(found, update);
      },
    },
    taxRegion: {
      findMany: async ({ where }: { where: Row }) => regions.filter((row) => matches(row, where)),
      deleteMany: async ({ where }: { where: Row }) => {
        const keep = regions.filter((row) => !matches(row, where));
        regions.splice(0, regions.length, ...keep);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const found = regions.filter((row) => matches(row, where));
        for (const row of found) Object.assign(row, data);
        return { count: found.length };
      },
      create: async ({ data }: { data: Row }) => {
        regions.push({ ...data });
      },
    },
  };
  return { client: client as unknown as TransactionClient, settings, regions };
}

const repo = () => new PrismaTaxSettingsRepository({ prisma: {} as unknown as Database });

function filled(): TaxSettings {
  const s = TaxSettings.defaults();
  s.setFlags({ pricesIncludeTax: false, chargeTaxOnShipping: true });
  s.upsertRegion(UniqueEntityId.from("r-1"), {
    countryCode: "EG",
    rateBasisPoints: 1400,
    provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
  });
  return s;
}

describe("PrismaTaxSettingsRepository (Plan 3C)", () => {
  it("writes the flags and the regions under the caller's tenant", async () => {
    const { client, settings, regions } = fakeClient();

    await repo().save(filled(), "tenant-a", client);

    expect(settings).toEqual([
      { tenantId: "tenant-a", pricesIncludeTax: false, chargeTaxOnShipping: true },
    ]);
    expect(regions).toEqual([
      {
        id: "r-1",
        tenantId: "tenant-a",
        countryCode: "EG",
        rateBasisPoints: 1400,
        provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
      },
    ]);
  });

  it("reads back an equal aggregate", async () => {
    const { client } = fakeClient();
    await repo().save(filled(), "tenant-a", client);

    const found = await repo().get("tenant-a", client);

    expect(found?.pricesIncludeTax).toBe(false);
    expect(found?.chargeTaxOnShipping).toBe(true);
    expect(found?.regionFor("EG")).toMatchObject({
      rateBasisPoints: 1400,
      provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
    });
  });

  it("is null for a shop that has saved nothing, and never shows another tenant's rows", async () => {
    const { client } = fakeClient();
    await repo().save(filled(), "tenant-a", client);

    expect(await repo().get("tenant-b", client)).toBeNull();
  });

  it("a second save changes a region in place and drops one that left", async () => {
    const { client, regions } = fakeClient();
    const s = filled();
    s.upsertRegion(UniqueEntityId.from("r-2"), {
      countryCode: "SA",
      rateBasisPoints: 1500,
      provinces: [],
    });
    await repo().save(s, "tenant-a", client);

    s.upsertRegion(UniqueEntityId.from("r-9"), {
      countryCode: "EG",
      rateBasisPoints: 1200,
      provinces: [],
    });
    s.removeRegion("SA");
    await repo().save(s, "tenant-a", client);

    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      id: "r-1",
      countryCode: "EG",
      rateBasisPoints: 1200,
      provinces: [],
    });
  });

  it("does not touch another tenant's regions when saving", async () => {
    const { client, regions } = fakeClient();
    await repo().save(filled(), "tenant-b", client);

    await repo().save(TaxSettings.defaults(), "tenant-a", client);

    expect(regions.filter((r) => r["tenantId"] === "tenant-b")).toHaveLength(1);
  });

  it("refuses to write outside a transaction", async () => {
    await expect(repo().save(filled(), "tenant-a")).rejects.toThrow(/transaction/i);
  });
});
