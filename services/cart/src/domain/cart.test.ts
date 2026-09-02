import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "./cart";
import { Quantity } from "./value-objects/quantity";

function ref(value: string): ProductRef {
  const result = ProductRef.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function qty(value: number): Quantity {
  const result = Quantity.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function money(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function cart(): Cart {
  return Cart.create(UniqueEntityId.from("cart-1"), "customer-1", "session-1", "USD");
}

function guestCart(id = "cart-guest"): Cart {
  return Cart.create(UniqueEntityId.from(id), undefined, "session-guest", "USD");
}

describe("Cart", () => {
  it("merges quantities for the same product and totals the lines", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(2), money(1000));
    c.addItem(UniqueEntityId.from("li-2"), ref("p1"), qty(3), money(1000)); // merges
    c.addItem(UniqueEntityId.from("li-3"), ref("p2"), qty(1), money(500));

    expect(c.items).toHaveLength(2);
    expect(c.totalAmount().amountMinor).toBe(5 * 1000 + 500);
  });

  it("rejects items in a different currency", () => {
    const c = cart();
    const eur = Money.create(1000, "EUR");
    if (!eur.ok) throw new Error("invalid fixture");
    expect(() => c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), eur.value)).toThrow(
      BusinessRuleError,
    );
  });

  it("checks out a non-empty cart, emitting cart.checked_out", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(2), money(1000));
    c.checkOut("evt-1", new Date(0));

    expect(c.status).toBe("checked_out");
    const events = c.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("cart.checked_out");
  });

  it("rejects checking out an empty cart", () => {
    const c = cart();
    expect(() => c.checkOut("evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects modifications after checkout", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), money(1000));
    c.checkOut("evt-1", new Date(0));
    expect(() => c.addItem(UniqueEntityId.from("li-2"), ref("p2"), qty(1), money(500))).toThrow(
      BusinessRuleError,
    );
  });

  it("abandons an active cart, emitting cart.abandoned", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), money(1000));
    c.abandon("evt-1", new Date(0));

    expect(c.status).toBe("abandoned");
    expect(c.pullDomainEvents()[0]?.eventName).toBe("cart.abandoned");
  });

  it("supports a guest cart (no customerRef) and assigning a customer to it", () => {
    const g = guestCart();
    expect(g.isGuest).toBe(true);
    expect(g.customerRef).toBeUndefined();

    g.assignCustomer("customer-9");
    expect(g.isGuest).toBe(false);
    expect(g.customerRef).toBe("customer-9");
    expect(() => g.assignCustomer("customer-10")).toThrow(BusinessRuleError);
  });

  it("merges a guest cart's lines into a customer cart, emitting cart.merged", () => {
    const customer = cart();
    customer.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), money(1000));
    const guest = guestCart();
    guest.addItem(UniqueEntityId.from("li-2"), ref("p1"), qty(2), money(1000)); // merges qty on p1
    guest.addItem(UniqueEntityId.from("li-3"), ref("p2"), qty(1), money(500));

    customer.merge(guest, "evt-merge", new Date(0));

    expect(customer.items).toHaveLength(2);
    expect(customer.totalAmount().amountMinor).toBe(3 * 1000 + 500);
    const events = customer.pullDomainEvents();
    expect(events.some((e) => e.eventName === "cart.merged")).toBe(true);
  });

  it("rejects merging carts with different currencies", () => {
    const customer = cart();
    const eurGuest = Cart.create(UniqueEntityId.from("cart-eur"), undefined, "session-eur", "EUR");
    expect(() => customer.merge(eurGuest, "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("replaces an item's variant, preserving cart integrity", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(2), money(1000));
    c.replaceItemVariant(UniqueEntityId.from("li-2"), "p1", ref("p1-large"), qty(1), money(1200));

    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.productRef.value).toBe("p1-large");
  });

  it("clears all lines from an active cart", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), money(1000));
    c.clear();
    expect(c.items).toHaveLength(0);
  });

  it("locks and unlocks a cart, emitting cart.locked", () => {
    const c = cart();
    c.lock("evt-1", new Date(0));
    expect(c.status).toBe("locked");
    expect(c.pullDomainEvents()[0]?.eventName).toBe("cart.locked");
    expect(() => c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), money(1000))).toThrow(
      BusinessRuleError,
    );

    c.unlock();
    expect(c.status).toBe("active");
  });

  it("saves a cart for later and restores it, emitting cart.saved", () => {
    const c = cart();
    c.saveForLater("evt-1", new Date(0));
    expect(c.status).toBe("saved");
    expect(c.pullDomainEvents()[0]?.eventName).toBe("cart.saved");

    c.restore();
    expect(c.status).toBe("active");
  });

  it("expires a live cart, emitting cart.expired, and rejects expiring a terminal cart", () => {
    const c = cart();
    c.addItem(UniqueEntityId.from("li-1"), ref("p1"), qty(1), money(1000));
    c.checkOut("evt-checkout", new Date(0));
    expect(() => c.expire("evt-1", new Date(0))).toThrow(BusinessRuleError);

    const c2 = cart();
    c2.expire("evt-2", new Date(0));
    expect(c2.status).toBe("expired");
    expect(c2.pullDomainEvents()[0]?.eventName).toBe("cart.expired");
  });
});
