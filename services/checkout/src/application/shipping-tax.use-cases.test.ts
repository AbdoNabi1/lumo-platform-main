import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import {
  SelectShipping,
  SetBillingAddress,
  SetShippingAddress,
} from "./checkout-details.use-cases";
import {
  RecalculateTotals,
  RequestShippingQuote,
  RequestTaxCalculation,
} from "./checkout-orchestration.use-cases";
import type { ShippingCalculationPort, ShippingQuote, TaxCalculationPort } from "./ports";

class FakeSessions implements CheckoutSessionRepository {
  readonly store = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

const clock = { now: () => new Date("2026-10-11T00:00:00.000Z") };
let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

const quotes: ShippingQuote[] = [
  { method: "rate-std", name: "Standard", rateAmountMinor: 5000, description: "2–4 days" },
  { method: "rate-fast", name: "Express", rateAmountMinor: 10_000 },
];

function setup(options: { province?: string; country?: string } = {}) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "s-1",
    "EGP",
  );
  const item = CheckoutItem.create("prod-1", 2, 5700, "EGP", {
    variantRef: "var-1",
    sku: "SKU",
    title: "Tee",
    variantTitle: null,
  });
  if (!item.ok) throw item.error;
  session.loadItems([item.value]);
  const address = CheckoutAddress.create({
    line1: "1 Main St",
    city: "Cairo",
    postalCode: "11511",
    country: options.country ?? "EG",
    ...(options.province === undefined ? {} : { province: options.province }),
  });
  if (!address.ok) throw address.error;
  session.setShippingAddress(address.value);
  sessions.store.set("cs-1", session);

  const quoteCalls: unknown[][] = [];
  const shippingCalculation: ShippingCalculationPort = {
    async quote(...args) {
      quoteCalls.push(args);
      return quotes;
    },
  };
  const taxCalls: unknown[][] = [];
  let taxResult = { taxMinor: 1400, included: true };
  const taxCalculation: TaxCalculationPort = {
    async calculate(...args) {
      taxCalls.push(args);
      return taxResult;
    },
  };
  const base = { sessions, unitOfWork: new InMemoryUnitOfWork(), idGenerator, clock };
  return {
    session,
    sessions,
    quoteCalls,
    taxCalls,
    setTax: (result: { taxMinor: number; included: boolean }) => (taxResult = result),
    quote: new RequestShippingQuote({ sessions, shippingCalculation }),
    select: new SelectShipping({ sessions, unitOfWork: base.unitOfWork, shippingCalculation }),
    tax: new RequestTaxCalculation({ ...base, taxCalculation }),
    recalc: new RecalculateTotals(base),
    setShipping: new SetShippingAddress({ sessions, unitOfWork: base.unitOfWork }),
    setBilling: new SetBillingAddress({ sessions, unitOfWork: base.unitOfWork }),
  };
}

const ids = { tenantId: "t1", checkoutSessionId: "cs-1" };

describe("RequestShippingQuote (Plan 3C)", () => {
  it("asks Shipping with the address (country, province, postal code) and the session's lines", async () => {
    const s = setup({ province: "EG-C" });

    const result = await s.quote.execute(ids);

    expect(result.ok && result.value.quotes).toEqual(quotes);
    const [address, items, currency, tenantId] = s.quoteCalls[0] as [
      { country: string; province?: string; postalCode: string },
      CheckoutItem[],
      string,
      string,
    ];
    expect(address).toMatchObject({ country: "EG", province: "EG-C", postalCode: "11511" });
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(2);
    expect(currency).toBe("EGP");
    expect(tenantId).toBe("t1");
  });

  it("returns no quotes when the port has none, so the shopper is told shipping is unavailable", async () => {
    const s = setup();
    const empty = new RequestShippingQuote({
      sessions: s.sessions,
      shippingCalculation: { quote: async () => [] },
    });

    const result = await empty.execute(ids);

    expect(result.ok && result.value.quotes).toEqual([]);
  });
});

describe("SelectShipping (Plan 3C)", () => {
  it("matches the chosen rate by its id and snapshots its name, description and price", async () => {
    const s = setup({ province: "EG-C" });

    const result = await s.select.execute({ ...ids, method: "rate-std" });

    expect(result.ok).toBe(true);
    expect(s.session.shippingSelection).toMatchObject({
      method: "rate-std",
      rateAmountMinor: 5000,
      name: "Standard",
      description: "2–4 days",
    });
  });

  it("refuses a forged rate id with a validation error and selects nothing", async () => {
    const s = setup({ province: "EG-C" });

    const result = await s.select.execute({ ...ids, method: "rate-forged" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    expect(s.session.shippingSelection).toBeUndefined();
  });

  it("re-quotes server-side, with the session's own address and lines", async () => {
    const s = setup({ province: "EG-GZ" });

    await s.select.execute({ ...ids, method: "rate-fast" });

    const [address] = s.quoteCalls[0] as [{ province?: string }];
    expect(address.province).toBe("EG-GZ");
  });
});

describe("RequestTaxCalculation (Plan 3C)", () => {
  it("asks Finance with the lines, the destination and the chosen shipping price", async () => {
    const s = setup({ province: "EG-C" });
    await s.select.execute({ ...ids, method: "rate-std" });

    const result = await s.tax.execute(ids);

    expect(result.ok && result.value.taxMinor).toBe(1400);
    const [items, destination, shippingMinor, currency, tenantId] = s.taxCalls[0] as [
      CheckoutItem[],
      { country: string; province?: string },
      number,
      string,
      string,
    ];
    expect(items).toHaveLength(1);
    expect(destination).toMatchObject({ country: "EG", province: "EG-C" });
    expect(shippingMinor).toBe(5000);
    expect(currency).toBe("EGP");
    expect(tenantId).toBe("t1");
  });

  it("tells Finance the order discount the session holds, so the tax follows the discounted prices", async () => {
    const s = setup({ province: "EG-C" });
    s.session.applyPromotionSnapshot(2000);

    await s.tax.execute(ids);

    expect((s.taxCalls[0] as unknown[])[5]).toEqual({ orderMinor: 2000, shippingMinor: 0 });
  });

  it("sends no discount when the session holds none", async () => {
    const s = setup();

    await s.tax.execute(ids);

    expect((s.taxCalls[0] as unknown[])[5]).toEqual({ orderMinor: 0, shippingMinor: 0 });
  });

  it("sends zero shipping when none has been chosen yet", async () => {
    const s = setup();

    await s.tax.execute(ids);

    expect((s.taxCalls[0] as unknown[])[2]).toBe(0);
  });

  it("keeps an included tax out of the grand total, and an added tax in it", async () => {
    const included = setup({ province: "EG-C" });
    await included.select.execute({ ...ids, method: "rate-std" });
    await included.tax.execute(ids);
    await included.recalc.execute(ids);
    expect(included.session.totals).toMatchObject({
      subtotalMinor: 11_400,
      shippingMinor: 5000,
      taxMinor: 1400,
      taxIncluded: true,
      totalMinor: 11_400 + 5000,
      shippingName: "Standard",
    });

    const added = setup({ province: "EG-C" });
    added.setTax({ taxMinor: 1596, included: false });
    await added.select.execute({ ...ids, method: "rate-std" });
    await added.tax.execute(ids);
    await added.recalc.execute(ids);
    expect(added.session.totals).toMatchObject({
      taxMinor: 1596,
      taxIncluded: false,
      totalMinor: 11_400 + 5000 + 1596,
    });
  });

  it("keeps the included flag when the shipping choice changes and totals are recalculated", async () => {
    const s = setup({ province: "EG-C" });
    await s.select.execute({ ...ids, method: "rate-std" });
    await s.tax.execute(ids);
    await s.select.execute({ ...ids, method: "rate-fast" });
    await s.recalc.execute(ids);

    expect(s.session.totals).toMatchObject({
      taxIncluded: true,
      shippingMinor: 10_000,
      totalMinor: 11_400 + 10_000,
    });
  });
});

describe("the shipping and billing address — province (Plan 3C)", () => {
  const address = { line1: "1 Main St", city: "Cairo", postalCode: "11511" };

  it("requires a province for a country that has province data", async () => {
    const s = setup();

    const result = await s.setShipping.execute({ ...ids, ...address, country: "EG" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(JSON.stringify(result.error)).toContain("province");
    }
  });

  it("accepts a province of that country, for shipping and for billing", async () => {
    const s = setup();

    expect(
      (await s.setShipping.execute({ ...ids, ...address, country: "EG", province: "EG-GZ" })).ok,
    ).toBe(true);
    expect(s.session.shippingAddress?.province).toBe("EG-GZ");
    expect(
      (await s.setBilling.execute({ ...ids, ...address, country: "SA", province: "SA-01" })).ok,
    ).toBe(true);
    expect(s.session.billingAddress?.province).toBe("SA-01");
  });

  it("refuses a province that belongs to another country", async () => {
    const s = setup();

    const result = await s.setShipping.execute({
      ...ids,
      ...address,
      country: "EG",
      province: "SA-01",
    });

    expect(result.ok).toBe(false);
  });

  it("needs no province for a country without province data, and refuses one it was given", async () => {
    const s = setup();

    expect((await s.setShipping.execute({ ...ids, ...address, country: "US" })).ok).toBe(true);
    const withProvince = await s.setShipping.execute({
      ...ids,
      ...address,
      country: "US",
      province: "US-CA",
    });
    expect(withProvince.ok).toBe(false);
  });
});
