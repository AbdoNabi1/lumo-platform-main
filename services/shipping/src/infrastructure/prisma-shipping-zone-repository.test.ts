import { describe, expect, it } from "vitest";
import type { Database, TransactionClient } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { ShippingZone } from "../domain/shipping-zone";
import { PrismaShippingZoneRepository } from "./prisma-shipping-zone-repository";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the two Prisma delegates, honouring only the `where` keys it is given. */
function fakeClient() {
  const zones: Row[] = [];
  const rates: Row[] = [];
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (typeof value === "object" && value !== null && "notIn" in value) {
        return !(value as { notIn: unknown[] }).notIn.includes(row[key]);
      }
      return row[key] === value;
    });
  const delegate = (table: Row[]) => ({
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const found = table.filter((row) => matches(row, where));
      for (const row of found) Object.assign(row, data);
      return { count: found.length };
    },
    create: async ({ data }: { data: Row }) => {
      table.push({ ...data });
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = table.filter((row) => !matches(row, where));
      const count = table.length - keep.length;
      table.splice(0, table.length, ...keep);
      return { count };
    },
    findFirst: async ({ where }: { where: Row }) => {
      const row = table.find((candidate) => matches(candidate, where));
      return row === undefined
        ? null
        : { ...row, rates: rates.filter((r) => r["zoneId"] === row["id"]) };
    },
    findMany: async ({ where }: { where: Row }) =>
      table
        .filter((candidate) => matches(candidate, where))
        .map((row) => ({ ...row, rates: rates.filter((r) => r["zoneId"] === row["id"]) })),
  });
  const client = { shippingZone: delegate(zones), shippingRate: delegate(rates) };
  return { client: client as unknown as TransactionClient, zones, rates };
}

const repo = () => new PrismaShippingZoneRepository({ prisma: {} as unknown as Database });

function zone(): ShippingZone {
  const z = ShippingZone.create(UniqueEntityId.from("z-1"), {
    name: "Cairo",
    countries: [{ code: "EG", provinces: ["EG-C"] }],
  });
  z.addRate(UniqueEntityId.from("r-1"), {
    name: "Free over 1000",
    priceMinor: 0,
    condition: { type: "orderPrice", minMinor: 100_000 },
  });
  z.addRate(UniqueEntityId.from("r-2"), {
    name: "Light",
    priceMinor: 5000,
    condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    description: "2-4 days",
  });
  return z;
}

describe("PrismaShippingZoneRepository (Plan 3C)", () => {
  it("writes the zone and its rates under the caller's tenant, bounds as bigint", async () => {
    const { client, zones, rates } = fakeClient();

    await repo().save(zone(), "tenant-a", client);

    expect(zones).toEqual([
      expect.objectContaining({
        id: "z-1",
        tenantId: "tenant-a",
        name: "Cairo",
        profile: "general",
      }),
    ]);
    expect(rates).toEqual([
      expect.objectContaining({
        id: "r-1",
        tenantId: "tenant-a",
        zoneId: "z-1",
        conditionType: "order_price",
        conditionMin: 100_000n,
        conditionMax: null,
      }),
      expect.objectContaining({
        id: "r-2",
        conditionType: "weight",
        conditionMin: 0n,
        conditionMax: 5000n,
        description: "2-4 days",
      }),
    ]);
  });

  it("reads back an equal aggregate", async () => {
    const { client } = fakeClient();
    await repo().save(zone(), "tenant-a", client);

    const found = await repo().findById("z-1", "tenant-a", client);

    expect(found?.name).toBe("Cairo");
    expect(found?.countries).toEqual([{ code: "EG", provinces: ["EG-C"] }]);
    expect(found?.rates.map((r) => [r.name, r.priceMinor, r.condition, r.description])).toEqual([
      ["Free over 1000", 0, { type: "orderPrice", minMinor: 100_000 }, null],
      ["Light", 5000, { type: "weight", minGrams: 0, maxGrams: 5000 }, "2-4 days"],
    ]);
  });

  it("never finds or lists another tenant's zone", async () => {
    const { client } = fakeClient();
    await repo().save(zone(), "tenant-a", client);

    expect(await repo().findById("z-1", "tenant-b", client)).toBeNull();
    expect(await repo().list("tenant-b", client)).toEqual([]);
    expect(await repo().list("tenant-a", client)).toHaveLength(1);
  });

  it("a second save updates in place and drops the rate that left the aggregate", async () => {
    const { client, zones, rates } = fakeClient();
    const z = zone();
    await repo().save(z, "tenant-a", client);

    z.rename("Greater Cairo");
    z.removeRate("r-1");
    z.updateRate("r-2", { name: "Light plus", priceMinor: 6000 });
    await repo().save(z, "tenant-a", client);

    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ name: "Greater Cairo" });
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({
      id: "r-2",
      name: "Light plus",
      priceMinor: 6000,
      conditionType: "none",
    });
  });

  it("deletes the zone and its rates for the caller's tenant only", async () => {
    const { client, zones, rates } = fakeClient();
    await repo().save(zone(), "tenant-a", client);

    await repo().delete("z-1", "tenant-b", client);
    expect(zones).toHaveLength(1);

    await repo().delete("z-1", "tenant-a", client);
    expect(zones).toEqual([]);
    expect(rates).toEqual([]);
  });

  it("refuses to write outside a transaction", async () => {
    await expect(repo().save(zone(), "tenant-a")).rejects.toThrow(/transaction/i);
    await expect(repo().delete("z-1", "tenant-a")).rejects.toThrow(/transaction/i);
  });
});
