import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { NotFoundError, ValidationError } from "@platform/utils";
import { InMemoryTaxSettingsRepository } from "../infrastructure/in-memory-tax-settings-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import {
  DeleteTaxRegion,
  GetTaxSettings,
  UpdateTaxSettings,
  UpsertTaxRegion,
} from "./tax-settings.use-cases";

const T1 = "tenant-1";
const T2 = "tenant-2";

function harness() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const settings = new InMemoryTaxSettingsRepository();
  const deps = { settings, unitOfWork: new InMemoryUnitOfWork(), idGenerator };
  return {
    settings,
    get: new GetTaxSettings(deps),
    update: new UpdateTaxSettings(deps),
    upsert: new UpsertTaxRegion(deps),
    remove: new DeleteTaxRegion(deps),
  };
}

async function failure(promise: Promise<{ ok: boolean; error?: unknown }>) {
  const result = await promise;
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("GetTaxSettings", () => {
  it("answers the defaults before anything is saved: prices include tax, shipping untaxed, no regions", async () => {
    const result = await harness().get.execute({ tenantId: T1 });

    expect(result).toEqual({
      ok: true,
      value: { pricesIncludeTax: true, chargeTaxOnShipping: false, regions: [] },
    });
  });
});

describe("UpdateTaxSettings", () => {
  it("saves the two switches and leaves the regions alone", async () => {
    const h = harness();
    await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [],
    });

    const result = await h.update.execute({
      tenantId: T1,
      pricesIncludeTax: false,
      chargeTaxOnShipping: true,
    });

    expect(result.ok && result.value).toMatchObject({
      pricesIncludeTax: false,
      chargeTaxOnShipping: true,
      regions: [{ countryCode: "EG", rateBasisPoints: 1400 }],
    });
  });
});

describe("UpsertTaxRegion / DeleteTaxRegion", () => {
  it("adds a country with a province override, then replaces it", async () => {
    const h = harness();

    const added = await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
    });
    expect(added.ok && added.value.regions).toEqual([
      {
        countryCode: "EG",
        rateBasisPoints: 1400,
        provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
      },
    ]);

    const replaced = await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1500,
      provinces: [],
    });
    expect(replaced.ok && replaced.value.regions).toEqual([
      { countryCode: "EG", rateBasisPoints: 1500, provinces: [] },
    ]);
  });

  it("refuses a country that is not real, naming it", async () => {
    const error = await failure(
      harness().upsert.execute({
        tenantId: T1,
        countryCode: "ZZ",
        rateBasisPoints: 100,
        provinces: [],
      }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((error as ValidationError).fields)).toContain("ZZ");
  });

  it("refuses a province override that does not belong to the country", async () => {
    const error = await failure(
      harness().upsert.execute({
        tenantId: T1,
        countryCode: "EG",
        rateBasisPoints: 1400,
        provinces: [{ code: "SA-01", rateBasisPoints: 100 }],
      }),
    );

    expect(error).toBeInstanceOf(ValidationError);
  });

  it("refuses province overrides for a country that has no province data", async () => {
    const error = await failure(
      harness().upsert.execute({
        tenantId: T1,
        countryCode: "US",
        rateBasisPoints: 700,
        provinces: [{ code: "US-CA", rateBasisPoints: 800 }],
      }),
    );

    expect(error).toBeInstanceOf(ValidationError);
  });

  it("refuses a rate above 100% from the aggregate and stores nothing", async () => {
    const h = harness();
    const error = await failure(
      h.upsert.execute({ tenantId: T1, countryCode: "EG", rateBasisPoints: 10_001, provinces: [] }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    const read = await h.get.execute({ tenantId: T1 });
    expect(read.ok && read.value.regions).toEqual([]);
  });

  it("removes a region, and answers not found for one it does not hold", async () => {
    const h = harness();
    await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [],
    });

    expect((await h.remove.execute({ tenantId: T1, countryCode: "EG" })).ok).toBe(true);
    expect(await failure(h.remove.execute({ tenantId: T1, countryCode: "EG" }))).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("keeps each tenant's tax to itself", async () => {
    const h = harness();
    await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [],
    });
    await h.update.execute({ tenantId: T1, pricesIncludeTax: false, chargeTaxOnShipping: false });

    const other = await h.get.execute({ tenantId: T2 });

    expect(other).toEqual({
      ok: true,
      value: { pricesIncludeTax: true, chargeTaxOnShipping: false, regions: [] },
    });
    expect(await failure(h.remove.execute({ tenantId: T2, countryCode: "EG" }))).toBeInstanceOf(
      NotFoundError,
    );
  });
});
