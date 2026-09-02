import { describe, expect, it } from "vitest";
import { CheckoutAddress, CheckoutItem, CheckoutTotals } from "@platform/checkout";
import type { OrderController } from "@platform/orders";
import { OrderCreationAdapter } from "./order-creation.adapter";

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function checkoutItem(
  productRef: string,
  quantity: number,
  unitPriceAmountMinor: number,
  currency: string,
): CheckoutItem {
  return must(CheckoutItem.create(productRef, quantity, unitPriceAmountMinor, currency));
}

function checkoutAddress(overrides: Partial<Parameters<typeof CheckoutAddress.create>[0]> = {}) {
  return must(
    CheckoutAddress.create({
      line1: "1 Main St",
      line2: "Suite 2",
      city: "Springfield",
      postalCode: "00000",
      country: "US",
      ...overrides,
    }),
  );
}

function checkoutTotals(): CheckoutTotals {
  return CheckoutTotals.assemble([checkoutItem("product-1", 2, 1000, "USD")], 100, 200, 50, "USD");
}

interface CreateFromCheckoutCall {
  readonly checkoutRef: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly {
    readonly productId: string;
    readonly name: string;
    readonly unitPriceAmountMinor: number;
    readonly quantity: number;
  }[];
  readonly billingAddress: {
    readonly line1: string;
    readonly city: string;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly shippingAddress: {
    readonly line1: string;
    readonly city: string;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly totals: {
    readonly subtotalMinor: number;
    readonly taxMinor: number;
    readonly shippingMinor: number;
    readonly discountMinor: number;
    readonly totalMinor: number;
  };
}

/**
 * A fake owning controller for `OrderController`, narrowed to `createFromCheckout` — the only
 * method this adapter calls. `onCall` lets a test capture the exact input sent, to confirm the
 * mapping (including the documented gaps) is threaded through rather than stubbed.
 */
function fakeOrderController(
  calls: CreateFromCheckoutCall[],
  options: { status?: number; body?: unknown } = {},
): Pick<OrderController, "createFromCheckout"> {
  const status = options.status ?? 201;
  return {
    async createFromCheckout(input) {
      calls.push(input as unknown as CreateFromCheckoutCall);
      if (status !== 201) {
        return { status, body: options.body ?? { code: "VALIDATION", message: "bad input" } };
      }
      return {
        status: 201,
        body: { orderId: "order-1", orderNumber: "ORD-1", status: "created" },
      };
    },
  };
}

describe("OrderCreationAdapter (Checkout -> Orders, C-2)", () => {
  it("throws, without fabricating a customerRef, when the checkout session is a guest session", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls);
    const adapter = new OrderCreationAdapter(orders);

    await expect(
      adapter.create({
        checkoutSessionId: "checkout-guest-1",
        customerRef: undefined,
        currency: "USD",
        items: [checkoutItem("product-1", 1, 1000, "USD")],
        billingAddress: checkoutAddress(),
        shippingAddress: checkoutAddress(),
        totals: checkoutTotals(),
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow(/checkout-guest-1/);
    expect(calls).toEqual([]);
  });

  it("maps checkoutSessionId/customerRef/currency and returns orderId as orderRef on success", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls);
    const adapter = new OrderCreationAdapter(orders);

    const result = await adapter.create({
      checkoutSessionId: "checkout-1",
      customerRef: "customer-1",
      currency: "USD",
      items: [checkoutItem("product-1", 2, 1000, "USD")],
      billingAddress: checkoutAddress(),
      shippingAddress: checkoutAddress(),
      totals: checkoutTotals(),
      idempotencyKey: "idem-1",
    });

    expect(result).toEqual({ orderRef: "order-1" });
    expect(calls[0]?.checkoutRef).toBe("checkout-1");
    expect(calls[0]?.customerRef).toBe("customer-1");
    expect(calls[0]?.currency).toBe("USD");
  });

  it("maps CheckoutItem.productRef to BOTH productId and name (no display name available)", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls);
    const adapter = new OrderCreationAdapter(orders);

    await adapter.create({
      checkoutSessionId: "checkout-1",
      customerRef: "customer-1",
      currency: "USD",
      items: [checkoutItem("product-shoe", 3, 1500, "USD")],
      billingAddress: checkoutAddress(),
      shippingAddress: checkoutAddress(),
      totals: checkoutTotals(),
      idempotencyKey: "idem-1",
    });

    expect(calls[0]?.items).toEqual([
      { productId: "product-shoe", name: "product-shoe", unitPriceAmountMinor: 1500, quantity: 3 },
    ]);
  });

  it("drops CheckoutAddress.line2 (Orders' address input has no field for it)", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls);
    const adapter = new OrderCreationAdapter(orders);

    await adapter.create({
      checkoutSessionId: "checkout-1",
      customerRef: "customer-1",
      currency: "USD",
      items: [checkoutItem("product-1", 1, 1000, "USD")],
      billingAddress: checkoutAddress({ line1: "Billing St", line2: "Apt 4" }),
      shippingAddress: checkoutAddress({ line1: "Shipping St", line2: "Unit 9" }),
      totals: checkoutTotals(),
      idempotencyKey: "idem-1",
    });

    expect(calls[0]?.billingAddress).toEqual({
      line1: "Billing St",
      city: "Springfield",
      postalCode: "00000",
      country: "US",
    });
    expect((calls[0]?.billingAddress as { line2?: string }).line2).toBeUndefined();
    expect(calls[0]?.shippingAddress).toEqual({
      line1: "Shipping St",
      city: "Springfield",
      postalCode: "00000",
      country: "US",
    });
  });

  it("maps the full totals breakdown through unchanged", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls);
    const adapter = new OrderCreationAdapter(orders);

    await adapter.create({
      checkoutSessionId: "checkout-1",
      customerRef: "customer-1",
      currency: "USD",
      items: [checkoutItem("product-1", 2, 1000, "USD")],
      billingAddress: checkoutAddress(),
      shippingAddress: checkoutAddress(),
      totals: checkoutTotals(),
      idempotencyKey: "idem-1",
    });

    // checkoutTotals(): subtotal 2*1000=2000, tax 100, shipping 200, discount 50, total 2250
    expect(calls[0]?.totals).toEqual({
      subtotalMinor: 2000,
      taxMinor: 100,
      shippingMinor: 200,
      discountMinor: 50,
      totalMinor: 2250,
    });
  });

  it("throws, naming the checkout session and response body, on an unexpected non-201 status", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls, {
      status: 422,
      body: { code: "VALIDATION", message: "invalid totals" },
    });
    const adapter = new OrderCreationAdapter(orders);

    await expect(
      adapter.create({
        checkoutSessionId: "checkout-bad-1",
        customerRef: "customer-1",
        currency: "USD",
        items: [checkoutItem("product-1", 1, 1000, "USD")],
        billingAddress: checkoutAddress(),
        shippingAddress: checkoutAddress(),
        totals: checkoutTotals(),
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow(/checkout-bad-1/);
  });
});
