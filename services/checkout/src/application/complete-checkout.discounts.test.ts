import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import type { DiscountSnapshot } from "../domain/value-objects/discount-snapshot";
import { ShippingSelection } from "../domain/value-objects/selections";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CompleteCheckout } from "./complete-checkout.use-case";
import type { DiscountUsagePort, OrderCreationPort, PromotionValidationPort } from "./ports";

class FakeSessions implements CheckoutSessionRepository {
  readonly store = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const tenPercent: DiscountSnapshot = {
  applied: [
    {
      promotionId: "p-1",
      couponId: "c-1",
      code: "SALE10",
      title: "SALE10",
      discountClass: "order",
      amountMinor: 1_000,
    },
  ],
  orderDiscountMinor: 1_000,
  shippingDiscountMinor: 0,
  codeStatuses: [{ code: "SALE10", applicable: true }],
  lineAllocations: [{ lineRef: "0", amountMinor: 1_000 }],
};

const clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

function setup(options: { evaluateTo: DiscountSnapshot; usageFails?: boolean }) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "s-1",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("prod-1", 2, 5_000, "EGP"))]);
  const address = must(
    CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  session.setShippingAddress(address);
  session.setBillingAddress(address);
  session.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP")));
  session.enterDiscountCode("SALE10");
  session.applyDiscountSnapshot(tenPercent);
  session.recalculateTotals("evt-0", new Date(0));
  sessions.store.set("cs-1", session);

  const created: Parameters<OrderCreationPort["create"]>[0][] = [];
  const orderCreation: OrderCreationPort = {
    async create(input) {
      created.push(input);
      return { orderRef: "order-1" };
    },
  };
  const promotionValidation: PromotionValidationPort = {
    async validate() {
      return { valid: true, discountMinor: 0 };
    },
    async evaluate() {
      return options.evaluateTo;
    },
  };
  const usage: Parameters<DiscountUsagePort["record"]>[0][] = [];
  const discountUsage: DiscountUsagePort = {
    async record(input) {
      usage.push(input);
      if (options.usageFails === true) throw new Error("coupons down");
    },
  };
  const complete = new CompleteCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    orderCreation,
    promotionValidation,
    discountUsage,
  });
  return {
    session,
    created,
    usage,
    run: () =>
      complete.execute({ tenantId: "t1", checkoutSessionId: "cs-1", idempotencyKey: "k-1" }),
  };
}

describe("CompleteCheckout — discounts (Phase 2)", () => {
  it("places the order with its discounts and records their use once", async () => {
    const t = setup({ evaluateTo: tenPercent });
    const result = await t.run();
    expect(result.ok).toBe(true);
    expect(t.created[0]?.discounts).toEqual(tenPercent.applied);
    expect(t.created[0]?.totals.discountMinor).toBe(1_000);
    expect(t.usage).toEqual([{ tenantId: "t1", orderRef: "order-1", applied: tenPercent.applied }]);
  });

  it("refuses to place the order when the discounts changed, and shows the new total", async () => {
    const t = setup({
      evaluateTo: {
        ...tenPercent,
        applied: [],
        orderDiscountMinor: 0,
        codeStatuses: [{ code: "SALE10", applicable: false, reason: "usage_limit_reached" }],
      },
    });
    const result = await t.run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/^DISCOUNTS_CHANGED/);
    expect(t.created).toHaveLength(0);
    expect(t.session.state.isOpen).toBe(true);
    expect(t.session.totals?.discountMinor).toBe(0);
  });

  it("still places the order when recording the usage fails", async () => {
    const t = setup({ evaluateTo: tenPercent, usageFails: true });
    const result = await t.run();
    expect(result.ok).toBe(true);
    expect(t.session.orderRef).toBe("order-1");
  });
});
