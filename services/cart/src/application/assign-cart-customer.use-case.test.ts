import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "../domain/cart";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { Quantity } from "../domain/value-objects/quantity";
import { AssignCartCustomer } from "./assign-cart-customer.use-case";

/**
 * `AssignCartCustomer` (T5.17) — the login-time promotion of a guest cart to a customer's cart.
 * The interesting cases are the two the domain method alone cannot express: a repeat login by the
 * SAME customer must succeed (idempotent, no-op), while a re-assignment to a DIFFERENT customer
 * must be refused rather than silently re-homing someone's cart.
 */

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function guestCartWithOneItem(sessionRef = "session-1"): Cart {
  const cart = Cart.create(UniqueEntityId.from("cart-1"), undefined, sessionRef, "USD");
  cart.addItem(
    UniqueEntityId.from("item-1"),
    must(ProductRef.create("product-1")),
    must(Quantity.create(2)),
    must(Money.create(1500, "USD")),
  );
  return cart;
}

const notFoundBySession = async () => {
  throw new Error("findBySessionRef() not used by AssignCartCustomer");
};
const notListed = async () => {
  throw new Error("list() not used by AssignCartCustomer");
};

function repoFor(cart: Cart | null): {
  repo: {
    findById: () => Promise<Cart | null>;
    findBySessionRef: typeof notFoundBySession;
    save: (c: Cart) => Promise<void>;
    list: typeof notListed;
  };
  saved: Cart[];
} {
  const saved: Cart[] = [];
  return {
    repo: {
      findById: async () => cart,
      findBySessionRef: notFoundBySession,
      save: async (c: Cart) => {
        saved.push(c);
      },
      list: notListed,
    },
    saved,
  };
}

function useCaseFor(cart: Cart | null): {
  useCase: AssignCartCustomer;
  saved: Cart[];
} {
  const { repo, saved } = repoFor(cart);
  return {
    useCase: new AssignCartCustomer({ carts: repo, unitOfWork: new InMemoryUnitOfWork() }),
    saved,
  };
}

describe("AssignCartCustomer", () => {
  it("promotes a guest cart in place — same cart id, same sessionRef, lines untouched", async () => {
    const cart = guestCartWithOneItem();
    const { useCase, saved } = useCaseFor(cart);

    const result = await useCase.execute({ cartId: "cart-1", customerRef: "customer-9" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      cartId: "cart-1",
      customerRef: "customer-9",
      assigned: true,
    });
    expect(cart.customerRef).toBe("customer-9");
    expect(cart.isGuest).toBe(false);
    // Promotion in place: nothing about the cart's identity or contents changed.
    expect(cart.id.toString()).toBe("cart-1");
    expect(cart.sessionRef).toBe("session-1");
    expect(cart.items).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it("is idempotent for the SAME customer — a second login does not fail and does not re-save", async () => {
    const cart = guestCartWithOneItem();
    cart.assignCustomer("customer-9");
    const { useCase, saved } = useCaseFor(cart);

    const result = await useCase.execute({ cartId: "cart-1", customerRef: "customer-9" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assigned).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it("refuses to re-home a cart already owned by a DIFFERENT customer (409, not a silent takeover)", async () => {
    const cart = guestCartWithOneItem();
    cart.assignCustomer("customer-9");
    const { useCase, saved } = useCaseFor(cart);

    const result = await useCase.execute({ cartId: "cart-1", customerRef: "customer-INTRUDER" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BUSINESS_RULE");
    expect(cart.customerRef).toBe("customer-9");
    expect(saved).toHaveLength(0);
  });

  it("404s for an unknown cart id", async () => {
    const { useCase } = useCaseFor(null);

    const result = await useCase.execute({ cartId: "nope", customerRef: "customer-9" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("rejects an empty customerRef before touching the repository", async () => {
    const cart = guestCartWithOneItem();
    const { useCase, saved } = useCaseFor(cart);

    const result = await useCase.execute({ cartId: "cart-1", customerRef: "  " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(cart.customerRef).toBeUndefined();
    expect(saved).toHaveLength(0);
  });
});
