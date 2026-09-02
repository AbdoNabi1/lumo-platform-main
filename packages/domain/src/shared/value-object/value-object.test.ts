import { describe, expect, it } from "vitest";
import { ValueObject } from "./value-object";

interface MoneyProps {
  amount: number;
  currency: string;
}

class Money extends ValueObject<MoneyProps> {
  static of(amount: number, currency: string): Money {
    return new Money({ amount, currency });
  }
}

class Weight extends ValueObject<MoneyProps> {
  static of(amount: number, currency: string): Weight {
    return new Weight({ amount, currency });
  }
}

interface BasketProps {
  items: string[];
  meta: { gift: boolean };
}

class Basket extends ValueObject<BasketProps> {
  static of(items: string[], gift: boolean): Basket {
    return new Basket({ items, meta: { gift } });
  }
}

describe("ValueObject", () => {
  it("is equal by structural value", () => {
    expect(Money.of(10, "USD").equals(Money.of(10, "USD"))).toBe(true);
    expect(Money.of(10, "USD").equals(Money.of(11, "USD"))).toBe(false);
  });

  it("is not equal to a different value-object type with identical props", () => {
    expect(Money.of(10, "USD").equals(Weight.of(10, "USD"))).toBe(false);
  });

  it("is not equal to null or undefined", () => {
    expect(Money.of(1, "USD").equals(undefined)).toBe(false);
  });

  it("freezes props (immutability)", () => {
    const money = Money.of(5, "USD");
    // `props` is `protected` on `ValueObject` — the `unknown` hop is needed to reach it from a
    // test (a plain `{ props }` view can't be structurally compatible with a protected member).
    expect(Object.isFrozen((money as unknown as { props: MoneyProps }).props)).toBe(true);
  });

  it("deeply freezes nested arrays and objects", () => {
    const basket = Basket.of(["toy-1"], true);
    const props = (basket as unknown as { props: BasketProps }).props;

    expect(Object.isFrozen(props)).toBe(true);
    expect(Object.isFrozen(props.items)).toBe(true);
    expect(Object.isFrozen(props.meta)).toBe(true);
    expect(() => props.items.push("toy-2")).toThrow();
    expect(() => {
      props.meta.gift = false;
    }).toThrow();
  });
});
