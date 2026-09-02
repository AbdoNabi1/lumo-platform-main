import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Price } from "./price";
import { PriceList } from "./price-list";
import { Currency } from "./value-objects/currency";

function usd(amount: number): Money {
  const money = Money.create(amount, "USD");
  if (!money.ok) throw new Error("invalid fixture");
  return money.value;
}

function productRef(): ProductRef {
  const ref = ProductRef.create("product-1");
  if (!ref.ok) throw new Error("invalid fixture");
  return ref.value;
}

describe("Price", () => {
  it("emits price.changed when the amount changes", () => {
    const price = Price.create(UniqueEntityId.from("price-1"), "list-1", productRef(), usd(1999));
    price.change(usd(1799), "evt-1", new Date("2026-06-30T00:00:00.000Z"));

    expect(price.amount.amountMinor).toBe(1799);
    const events = price.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("price.changed");
  });

  it("rejects a compare-at in a different currency (base-currency-guarded)", () => {
    const eur = Money.create(1500, "EUR");
    if (!eur.ok) throw new Error("invalid fixture");
    expect(() =>
      Price.create(UniqueEntityId.from("price-2"), "list-1", productRef(), usd(1999), {
        compareAt: eur.value,
      }),
    ).toThrow(BusinessRuleError);
  });

  it("rejects a cost in a different currency on change (base-currency-guarded)", () => {
    const price = Price.create(UniqueEntityId.from("price-3"), "list-1", productRef(), usd(1999));
    const eur = Money.create(500, "EUR");
    if (!eur.ok) throw new Error("invalid fixture");
    expect(() => price.change(usd(1799), "evt-1", new Date(0), { cost: eur.value })).toThrow(
      BusinessRuleError,
    );
  });

  it("rejects an inverted effective window", () => {
    const price = Price.create(UniqueEntityId.from("price-4"), "list-1", productRef(), usd(1999));
    expect(() => price.setEffectiveWindow(new Date("2026-08-01"), new Date("2026-07-01"))).toThrow(
      BusinessRuleError,
    );
  });

  it("publishes a draft price and rejects double publish", () => {
    const price = Price.create(UniqueEntityId.from("price-5"), "list-1", productRef(), usd(1999));
    expect(price.status).toBe("draft");
    price.publish("evt-1", new Date(0));
    expect(price.status).toBe("published");
    expect(() => price.publish("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("reports isScheduled when the effective window starts in the future", () => {
    const price = Price.create(UniqueEntityId.from("price-6"), "list-1", productRef(), usd(1999));
    price.setEffectiveWindow(new Date("2026-08-01"), undefined);
    expect(price.isScheduled(new Date("2026-07-01"))).toBe(true);
    expect(price.isScheduled(new Date("2026-09-01"))).toBe(false);
  });
});

describe("PriceList", () => {
  it("activates a draft and rejects double activation", () => {
    const currency = Currency.create("USD");
    if (!currency.ok) throw new Error("invalid fixture");
    const list = PriceList.create(UniqueEntityId.from("list-1"), "Retail", currency.value);

    expect(list.status).toBe("draft");
    list.activate();
    expect(list.status).toBe("active");
    expect(() => list.activate()).toThrow(BusinessRuleError);
  });
});
