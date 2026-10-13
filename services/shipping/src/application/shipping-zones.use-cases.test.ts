import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { NotFoundError, ValidationError } from "@platform/utils";
import { InMemoryShippingZoneRepository } from "../infrastructure/in-memory-shipping-zone-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import {
  AddRate,
  CreateZone,
  DeleteRate,
  DeleteZone,
  ListZones,
  UpdateRate,
  UpdateZone,
} from "./shipping-zones.use-cases";

const T1 = "tenant-1";
const T2 = "tenant-2";

function harness() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const zones = new InMemoryShippingZoneRepository();
  const deps = { zones, unitOfWork: new InMemoryUnitOfWork(), idGenerator };
  return {
    zones,
    list: new ListZones(deps),
    create: new CreateZone(deps),
    update: new UpdateZone(deps),
    remove: new DeleteZone(deps),
    addRate: new AddRate(deps),
    updateRate: new UpdateRate(deps),
    removeRate: new DeleteRate(deps),
  };
}

type H = ReturnType<typeof harness>;

async function created(h: H, tenantId: string, name: string, countries: unknown[]) {
  const result = await h.create.execute({
    tenantId,
    name,
    countries: countries as never,
  });
  if (!result.ok) throw result.error;
  return result.value.id;
}

const cairo = [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }];

async function failure(promise: Promise<{ ok: boolean; error?: unknown }>) {
  const result = await promise;
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

function fieldsOf(error: unknown): { field: string; message: string }[] {
  expect(error).toBeInstanceOf(ValidationError);
  return [...(error as ValidationError).fields];
}

describe("CreateZone / ListZones", () => {
  it("creates a zone and lists it with its countries and no rates", async () => {
    const h = harness();
    const id = await created(h, T1, "Cairo and Giza", cairo);

    const result = await h.list.execute({ tenantId: T1 });

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            id,
            name: "Cairo and Giza",
            profile: "general",
            countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }],
            rates: [],
          },
        ],
      },
    });
  });

  it("lists zones in the order they were created", async () => {
    const h = harness();
    await created(h, T1, "B", [{ code: "SA", provinces: null }]);
    await created(h, T1, "A", [{ code: "AE", provinces: null }]);

    const result = await h.list.execute({ tenantId: T1 });

    expect(result.ok && result.value.items.map((z) => z.name)).toEqual(["B", "A"]);
  });

  it("keeps each tenant's zones to itself", async () => {
    const h = harness();
    await created(h, T1, "Mine", cairo);
    await created(h, T2, "Theirs", cairo);

    const mine = await h.list.execute({ tenantId: T1 });
    expect(mine.ok && mine.value.items.map((z) => z.name)).toEqual(["Mine"]);
  });

  it("refuses a country code that is not real, naming it", async () => {
    const h = harness();
    const error = await failure(
      h.create.execute({ tenantId: T1, name: "X", countries: [{ code: "ZZ", provinces: null }] }),
    );

    expect(fieldsOf(error)).toEqual([
      { field: "countries", message: expect.stringContaining("ZZ") },
    ]);
  });

  it("refuses a province that is not in that country's list", async () => {
    const h = harness();
    const error = await failure(
      h.create.execute({
        tenantId: T1,
        name: "X",
        countries: [{ code: "EG", provinces: ["SA-01"] }],
      }),
    );

    expect(fieldsOf(error)).toEqual([
      { field: "countries", message: expect.stringContaining("SA-01") },
    ]);
  });

  it("refuses provinces for a country that has no province data", async () => {
    const h = harness();
    const error = await failure(
      h.create.execute({
        tenantId: T1,
        name: "X",
        countries: [{ code: "US", provinces: ["US-CA"] }],
      }),
    );

    expect(fieldsOf(error)[0]?.field).toBe("countries");
  });

  it("accepts rest of world", async () => {
    const h = harness();
    expect(
      (
        await h.create.execute({
          tenantId: T1,
          name: "World",
          countries: [{ code: "*", provinces: null }],
        })
      ).ok,
    ).toBe(true);
  });

  it("returns the aggregate's own field errors (a blank name)", async () => {
    const h = harness();
    const error = await failure(h.create.execute({ tenantId: T1, name: " ", countries: cairo }));

    expect(fieldsOf(error)[0]?.field).toBe("name");
  });
});

describe("a country can only be in one zone (Shopify: 'A country can only be in one zone')", () => {
  it("refuses a whole country already held by another zone, naming that zone", async () => {
    const h = harness();
    await created(h, T1, "Saudi zone", [{ code: "SA", provinces: null }]);

    const error = await failure(
      h.create.execute({
        tenantId: T1,
        name: "Gulf",
        countries: [{ code: "SA", provinces: null }],
      }),
    );

    expect(fieldsOf(error)).toEqual([
      { field: "countries", message: expect.stringContaining('"Saudi zone"') },
    ]);
  });

  it("refuses a province already in another zone, and a whole country that contains it", async () => {
    const h = harness();
    await created(h, T1, "Cairo and Giza", cairo);

    const sameProvince = await failure(
      h.create.execute({
        tenantId: T1,
        name: "Cairo only",
        countries: [{ code: "EG", provinces: ["EG-C"] }],
      }),
    );
    const wholeCountry = await failure(
      h.create.execute({
        tenantId: T1,
        name: "All Egypt",
        countries: [{ code: "EG", provinces: null }],
      }),
    );

    expect(fieldsOf(sameProvince)[0]?.message).toContain("EG-C");
    expect(fieldsOf(sameProvince)[0]?.message).toContain('"Cairo and Giza"');
    expect(fieldsOf(wholeCountry)[0]?.message).toContain('"Cairo and Giza"');
  });

  it("allows other provinces of the same country in another zone, and the same country in another tenant", async () => {
    const h = harness();
    await created(h, T1, "Cairo and Giza", cairo);

    const rest = await h.create.execute({
      tenantId: T1,
      name: "Rest of Egypt",
      countries: [{ code: "EG", provinces: ["EG-ALX", "EG-ASN"] }],
    });
    const otherTenant = await h.create.execute({
      tenantId: T2,
      name: "Egypt",
      countries: [{ code: "EG", provinces: null }],
    });

    expect(rest.ok).toBe(true);
    expect(otherTenant.ok).toBe(true);
  });

  it("allows rest of world once only", async () => {
    const h = harness();
    await created(h, T1, "World", [{ code: "*", provinces: null }]);

    const error = await failure(
      h.create.execute({
        tenantId: T1,
        name: "World 2",
        countries: [{ code: "*", provinces: null }],
      }),
    );

    expect(fieldsOf(error)[0]?.message).toContain('"World"');
  });
});

describe("UpdateZone / DeleteZone", () => {
  it("renames a zone and changes its countries, without clashing with itself", async () => {
    const h = harness();
    const id = await created(h, T1, "Cairo", [{ code: "EG", provinces: ["EG-C"] }]);

    const result = await h.update.execute({
      tenantId: T1,
      zoneId: id,
      name: "Greater Cairo",
      countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ", "EG-KB"] }],
    });

    expect(result.ok).toBe(true);
    const listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items[0]).toMatchObject({
      name: "Greater Cairo",
      countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ", "EG-KB"] }],
    });
  });

  it("refuses to take a country another zone holds", async () => {
    const h = harness();
    await created(h, T1, "Saudi", [{ code: "SA", provinces: null }]);
    const id = await created(h, T1, "Egypt", [{ code: "EG", provinces: null }]);

    const error = await failure(
      h.update.execute({
        tenantId: T1,
        zoneId: id,
        name: "Egypt",
        countries: [{ code: "SA", provinces: null }],
      }),
    );

    expect(fieldsOf(error)[0]?.message).toContain('"Saudi"');
  });

  it("answers not found for an unknown zone and for another tenant's zone", async () => {
    const h = harness();
    const id = await created(h, T1, "Cairo", cairo);

    expect(
      await failure(
        h.update.execute({ tenantId: T1, zoneId: "nope", name: "X", countries: cairo as never }),
      ),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await failure(
        h.update.execute({ tenantId: T2, zoneId: id, name: "X", countries: cairo as never }),
      ),
    ).toBeInstanceOf(NotFoundError);
    expect(await failure(h.remove.execute({ tenantId: T2, zoneId: id }))).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("deletes a zone with its rates", async () => {
    const h = harness();
    const id = await created(h, T1, "Cairo", cairo);
    await h.addRate.execute({ tenantId: T1, zoneId: id, name: "Std", priceMinor: 5000 });

    expect((await h.remove.execute({ tenantId: T1, zoneId: id })).ok).toBe(true);

    const listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items).toEqual([]);
  });
});

describe("AddRate / UpdateRate / DeleteRate", () => {
  it("adds a rate with a condition and lists it under its zone", async () => {
    const h = harness();
    const zoneId = await created(h, T1, "Cairo", cairo);

    const added = await h.addRate.execute({
      tenantId: T1,
      zoneId,
      name: "Free over 1000",
      priceMinor: 0,
      condition: { type: "orderPrice", minMinor: 100_000 },
      description: "Orders over EGP 1,000",
    });

    expect(added.ok).toBe(true);
    const listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items[0]?.rates).toEqual([
      {
        id: added.ok ? added.value.id : "",
        name: "Free over 1000",
        priceMinor: 0,
        condition: { type: "orderPrice", minMinor: 100_000 },
        description: "Orders over EGP 1,000",
      },
    ]);
  });

  it("refuses an invalid rate with the field named, and stores nothing", async () => {
    const h = harness();
    const zoneId = await created(h, T1, "Cairo", cairo);

    const error = await failure(
      h.addRate.execute({ tenantId: T1, zoneId, name: "Bad", priceMinor: -5 }),
    );

    expect(fieldsOf(error)[0]?.field).toBe("priceMinor");
    const listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items[0]?.rates).toEqual([]);
  });

  it("updates and deletes a rate", async () => {
    const h = harness();
    const zoneId = await created(h, T1, "Cairo", cairo);
    const added = await h.addRate.execute({ tenantId: T1, zoneId, name: "Std", priceMinor: 5000 });
    const rateId = added.ok ? added.value.id : "";

    const updated = await h.updateRate.execute({
      tenantId: T1,
      zoneId,
      rateId,
      name: "Standard",
      priceMinor: 6000,
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    });
    expect(updated.ok).toBe(true);
    let listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items[0]?.rates[0]).toMatchObject({
      name: "Standard",
      priceMinor: 6000,
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    });

    expect((await h.removeRate.execute({ tenantId: T1, zoneId, rateId })).ok).toBe(true);
    listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items[0]?.rates).toEqual([]);
  });

  it("answers not found for an unknown zone or rate, and for another tenant's zone", async () => {
    const h = harness();
    const zoneId = await created(h, T1, "Cairo", cairo);

    expect(
      await failure(h.addRate.execute({ tenantId: T1, zoneId: "nope", name: "X", priceMinor: 1 })),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await failure(h.addRate.execute({ tenantId: T2, zoneId, name: "X", priceMinor: 1 })),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await failure(
        h.updateRate.execute({ tenantId: T1, zoneId, rateId: "nope", name: "X", priceMinor: 1 }),
      ),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await failure(h.removeRate.execute({ tenantId: T1, zoneId, rateId: "nope" })),
    ).toBeInstanceOf(NotFoundError);
  });
});

describe("CreateZone with rates", () => {
  it("creates a zone with two rates and lists them in order", async () => {
    const h = harness();
    const result = await h.create.execute({
      tenantId: T1,
      name: "Cairo and Giza",
      countries: cairo as never,
      rates: [
        { name: "Standard", priceMinor: 5000, description: "2-4 business days" },
        {
          name: "Free shipping",
          priceMinor: 0,
          condition: { type: "orderPrice", minMinor: 100_000 },
        },
      ],
    });
    expect(result.ok).toBe(true);

    const listed = await h.list.execute({ tenantId: T1 });

    expect(listed.ok && listed.value.items[0]?.rates).toEqual([
      {
        id: expect.any(String),
        name: "Standard",
        priceMinor: 5000,
        condition: { type: "none" },
        description: "2-4 business days",
      },
      {
        id: expect.any(String),
        name: "Free shipping",
        priceMinor: 0,
        condition: { type: "orderPrice", minMinor: 100_000 },
        description: null,
      },
    ]);
  });

  it.each([
    ["an empty name", { name: "  ", priceMinor: 5000 }],
    ["a negative price", { name: "Standard", priceMinor: -1 }],
  ])("saves no zone at all when a rate has %s", async (_label, bad) => {
    const h = harness();
    const error = await failure(
      h.create.execute({
        tenantId: T1,
        name: "Cairo and Giza",
        countries: cairo as never,
        rates: [{ name: "Standard", priceMinor: 5000 }, bad],
      }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    const listed = await h.list.execute({ tenantId: T1 });
    expect(listed.ok && listed.value.items).toEqual([]);
  });

  it("still creates a zone with no rates field, exactly as before", async () => {
    const h = harness();
    await created(h, T1, "Cairo and Giza", cairo);

    const listed = await h.list.execute({ tenantId: T1 });

    expect(listed.ok && listed.value.items[0]?.rates).toEqual([]);
  });
});
