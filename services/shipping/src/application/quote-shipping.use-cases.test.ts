import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { ValidationError } from "@platform/utils";
import { InMemoryShippingZoneRepository } from "../infrastructure/in-memory-shipping-zone-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ListShippableCountries, QuoteShippingRates } from "./quote-shipping.use-cases";
import { AddRate, CreateZone } from "./shipping-zones.use-cases";

const T1 = "tenant-1";
const T2 = "tenant-2";

function harness() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const zones = new InMemoryShippingZoneRepository();
  const deps = { zones, unitOfWork: new InMemoryUnitOfWork(), idGenerator };
  const create = new CreateZone(deps);
  const addRate = new AddRate(deps);
  return {
    quote: new QuoteShippingRates({ zones }),
    countries: new ListShippableCountries({ zones }),
    async zone(
      tenantId: string,
      name: string,
      countries: { code: string; provinces: string[] | null }[],
      rates: { name: string; priceMinor: number; condition?: never }[] = [],
    ) {
      const made = await create.execute({ tenantId, name, countries });
      if (!made.ok) throw made.error;
      for (const rate of rates) {
        const added = await addRate.execute({ tenantId, zoneId: made.value.id, ...rate });
        if (!added.ok) throw added.error;
      }
      return made.value.id;
    },
  };
}

const line = (overrides: Record<string, unknown> = {}) => ({
  unitPriceMinor: 10_000,
  quantity: 1,
  requiresShipping: true,
  weightGrams: 500,
  ...overrides,
});

describe("QuoteShippingRates (Plan 3C)", () => {
  it("quotes the rates of the zone the address falls in, cheapest first", async () => {
    const h = harness();
    await h.zone(
      T1,
      "Cairo",
      [{ code: "EG", provinces: ["EG-C"] }],
      [
        { name: "Express", priceMinor: 10_000 },
        { name: "Standard", priceMinor: 5000 },
      ],
    );
    await h.zone(
      T1,
      "Rest of Egypt",
      [{ code: "EG", provinces: ["EG-GZ"] }],
      [{ name: "Egypt", priceMinor: 7500 }],
    );

    const cairo = await h.quote.execute({
      tenantId: T1,
      address: { country: "EG", province: "EG-C" },
      lines: [line()],
    });
    const giza = await h.quote.execute({
      tenantId: T1,
      address: { country: "EG", province: "EG-GZ" },
      lines: [line()],
    });

    expect(cairo.ok && cairo.value.rates.map((r) => [r.name, r.priceMinor])).toEqual([
      ["Standard", 5000],
      ["Express", 10_000],
    ]);
    expect(giza.ok && giza.value.rates.map((r) => [r.name, r.priceMinor])).toEqual([
      ["Egypt", 7500],
    ]);
  });

  it("returns no rates when the shop does not ship to the address", async () => {
    const h = harness();
    await h.zone(T1, "Saudi", [{ code: "SA", provinces: null }], [{ name: "Std", priceMinor: 1 }]);

    const result = await h.quote.execute({
      tenantId: T1,
      address: { country: "FR" },
      lines: [line()],
    });

    expect(result).toEqual({ ok: true, value: { rates: [] } });
  });

  it("answers the implicit free rate when nothing in the cart needs shipping", async () => {
    const h = harness();

    const result = await h.quote.execute({
      tenantId: T1,
      address: { country: "FR" },
      lines: [line({ requiresShipping: false })],
    });

    expect(result.ok && result.value.rates).toEqual([
      { id: "none", name: "No shipping required", priceMinor: 0, description: null },
    ]);
  });

  it("never quotes another tenant's zones", async () => {
    const h = harness();
    await h.zone(T2, "Theirs", [{ code: "EG", provinces: null }], [{ name: "Std", priceMinor: 1 }]);

    const result = await h.quote.execute({
      tenantId: T1,
      address: { country: "EG" },
      lines: [line()],
    });

    expect(result.ok && result.value.rates).toEqual([]);
  });

  it("refuses an address with no country", async () => {
    const result = await harness().quote.execute({
      tenantId: T1,
      address: { country: "" },
      lines: [line()],
    });

    expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
  });
});

describe("ListShippableCountries (Plan 3C)", () => {
  it("lists the countries of the shop's zones, once each, sorted", async () => {
    const h = harness();
    await h.zone(T1, "Cairo", [{ code: "EG", provinces: ["EG-C"] }]);
    await h.zone(T1, "Rest of Egypt", [{ code: "EG", provinces: ["EG-GZ"] }]);
    await h.zone(T1, "Gulf", [
      { code: "SA", provinces: null },
      { code: "AE", provinces: null },
    ]);

    const result = await h.countries.execute({ tenantId: T1 });

    expect(result).toEqual({
      ok: true,
      value: { countries: ["AE", "EG", "SA"], restOfWorld: false },
    });
  });

  it("says rest of world when a zone covers it", async () => {
    const h = harness();
    await h.zone(T1, "Saudi", [{ code: "SA", provinces: null }]);
    await h.zone(T1, "World", [{ code: "*", provinces: null }]);

    const result = await h.countries.execute({ tenantId: T1 });

    expect(result).toEqual({ ok: true, value: { countries: ["SA"], restOfWorld: true } });
  });

  it("is empty for a shop that ships nowhere yet, and per tenant", async () => {
    const h = harness();
    await h.zone(T2, "Theirs", [{ code: "EG", provinces: null }]);

    expect(await h.countries.execute({ tenantId: T1 })).toEqual({
      ok: true,
      value: { countries: [], restOfWorld: false },
    });
  });
});
