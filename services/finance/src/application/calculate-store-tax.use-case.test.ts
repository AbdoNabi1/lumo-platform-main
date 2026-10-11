import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { ValidationError } from "@platform/utils";
import { InMemoryTaxSettingsRepository } from "../infrastructure/in-memory-tax-settings-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CalculateStoreTax } from "./calculate-store-tax.use-case";
import { UpdateTaxSettings, UpsertTaxRegion } from "./tax-settings.use-cases";

const T1 = "tenant-1";
const T2 = "tenant-2";

function harness() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const settings = new InMemoryTaxSettingsRepository();
  const deps = { settings, unitOfWork: new InMemoryUnitOfWork(), idGenerator };
  return {
    calculate: new CalculateStoreTax(deps),
    upsert: new UpsertTaxRegion(deps),
    update: new UpdateTaxSettings(deps),
  };
}

const lines = [
  { unitPriceMinor: 5700, quantity: 2, taxable: true },
  { unitPriceMinor: 50_000, quantity: 1, taxable: false },
];

describe("CalculateStoreTax (Plan 3C)", () => {
  it("charges nothing for a shop with no tax region, and says prices include tax (the default)", async () => {
    const result = await harness().calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "EG" },
      shippingMinor: 5000,
    });

    expect(result).toEqual({ ok: true, value: { taxMinor: 0, included: true } });
  });

  it("works out inclusive tax on the taxable lines at the country's rate", async () => {
    const h = harness();
    await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [],
    });

    const result = await h.calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "EG" },
      shippingMinor: 5000,
    });

    // 114.00 at 14% inclusive holds 14.00; the 500.00 non-taxable line adds nothing; shipping is untaxed.
    expect(result).toEqual({ ok: true, value: { taxMinor: 1400, included: true } });
  });

  it("uses a province rate over the country rate, and adds shipping tax only when the shop charges it", async () => {
    const h = harness();
    await h.update.execute({ tenantId: T1, pricesIncludeTax: false, chargeTaxOnShipping: true });
    await h.upsert.execute({
      tenantId: T1,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
    });

    const cairo = await h.calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "EG", province: "EG-C" },
      shippingMinor: 5000,
    });
    const giza = await h.calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "EG", province: "EG-GZ" },
      shippingMinor: 5000,
    });

    // exclusive: 11,400 + 5,000 shipping = 16,400 taxable
    expect(cairo).toEqual({ ok: true, value: { taxMinor: 1640, included: false } });
    expect(giza).toEqual({ ok: true, value: { taxMinor: 2296, included: false } });
  });

  it("reads only the calling tenant's settings", async () => {
    const h = harness();
    await h.upsert.execute({
      tenantId: T2,
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [],
    });

    const result = await h.calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "EG" },
      shippingMinor: 0,
    });

    expect(result.ok && result.value.taxMinor).toBe(0);
  });

  it("refuses a destination with no country, and a negative shipping price", async () => {
    const h = harness();

    const noCountry = await h.calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "" },
      shippingMinor: 0,
    });
    const negative = await h.calculate.execute({
      tenantId: T1,
      lines,
      destination: { country: "EG" },
      shippingMinor: -1,
    });

    expect(!noCountry.ok && noCountry.error).toBeInstanceOf(ValidationError);
    expect(!negative.ok && negative.error).toBeInstanceOf(ValidationError);
  });
});
