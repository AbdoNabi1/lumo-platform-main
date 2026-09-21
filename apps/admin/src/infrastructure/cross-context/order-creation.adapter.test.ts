import { describe, expect, it } from "vitest";
import { CheckoutAddress, CheckoutItem, CheckoutTotals } from "@platform/checkout";
import type { CustomerController } from "@platform/identity";
import type { OrderController } from "@platform/orders";
import { ValidationError } from "@platform/utils";
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

interface ResolveCall {
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
}

/**
 * A fake Identity controller narrowed to `resolveGuestCustomer`. Returns a distinct customer id per
 * (tenant, email) pair — like the real thing — so a tenant-blind adapter would be caught.
 */
function fakeCustomers(options: { status?: number; body?: unknown } = {}) {
  const calls: ResolveCall[] = [];
  const customers: Pick<CustomerController, "resolveGuestCustomer"> = {
    async resolveGuestCustomer(input) {
      calls.push(input);
      if (options.status !== undefined && options.status !== 200) {
        return { status: options.status, body: options.body ?? { code: "CONFLICT" } };
      }
      return {
        status: 200,
        body: { customerId: `customer:${input.tenantId}:${input.email}`, created: true },
      };
    },
  };
  return { customers, calls };
}

function guestInput(overrides: Partial<Parameters<OrderCreationAdapter["create"]>[0]> = {}) {
  return {
    tenantId: "tenant-local",
    checkoutSessionId: "checkout-guest-1",
    customerRef: undefined,
    contactEmail: "guest@example.com",
    currency: "USD",
    items: [checkoutItem("product-1", 1, 1000, "USD")],
    billingAddress: checkoutAddress(),
    shippingAddress: checkoutAddress(),
    totals: checkoutTotals(),
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("OrderCreationAdapter (Checkout -> Orders, C-2) — guest checkout (WP-1, G-52)", () => {
  it("resolves a guest customer from the contact email and places the order against that id", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const { customers, calls: resolves } = fakeCustomers();
    const adapter = new OrderCreationAdapter(fakeOrderController(calls), customers);

    const result = await adapter.create(guestInput());

    expect(result).toEqual({ orderRef: "order-1" });
    expect(resolves).toHaveLength(1);
    expect(resolves[0]?.email).toBe("guest@example.com");
    expect(calls[0]?.customerRef).toBe("customer:tenant-local:guest@example.com");
  });

  it("scopes the resolution to the session's tenant, never a default (ADR-0014)", async () => {
    const { customers, calls: resolves } = fakeCustomers();
    const orderCalls: CreateFromCheckoutCall[] = [];
    const adapter = new OrderCreationAdapter(fakeOrderController(orderCalls), customers);

    await adapter.create(guestInput({ tenantId: "tenant-a" }));
    await adapter.create(guestInput({ tenantId: "tenant-b" }));

    expect(resolves.map((c) => c.tenantId)).toEqual(["tenant-a", "tenant-b"]);
    expect(orderCalls[0]?.customerRef).not.toBe(orderCalls[1]?.customerRef);
  });

  it("does not resolve a guest customer when the session already has a customerRef", async () => {
    const { customers, calls: resolves } = fakeCustomers();
    const orderCalls: CreateFromCheckoutCall[] = [];
    const adapter = new OrderCreationAdapter(fakeOrderController(orderCalls), customers);

    await adapter.create(guestInput({ customerRef: "customer-1", contactEmail: "other@x.com" }));

    expect(resolves).toEqual([]);
    expect(orderCalls[0]?.customerRef).toBe("customer-1");
  });

  it("throws a ValidationError (a 4xx, not a 500) when a guest session has no contact email", async () => {
    const { customers, calls: resolves } = fakeCustomers();
    const orderCalls: CreateFromCheckoutCall[] = [];
    const adapter = new OrderCreationAdapter(fakeOrderController(orderCalls), customers);

    const attempt = adapter.create(guestInput({ contactEmail: undefined }));

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toThrow(/checkout-guest-1/);
    expect(resolves).toEqual([]);
    expect(orderCalls).toEqual([]);
  });

  it("creates no order when the guest customer cannot be resolved", async () => {
    const { customers } = fakeCustomers({ status: 409 });
    const orderCalls: CreateFromCheckoutCall[] = [];
    const adapter = new OrderCreationAdapter(fakeOrderController(orderCalls), customers);

    await expect(adapter.create(guestInput())).rejects.toThrow(/checkout-guest-1/);
    expect(orderCalls).toEqual([]);
  });

  it("derives a display name from the email's local part", async () => {
    const { customers, calls: resolves } = fakeCustomers();
    const adapter = new OrderCreationAdapter(fakeOrderController([]), customers);

    await adapter.create(guestInput({ contactEmail: "jane.doe@example.com" }));

    expect(resolves[0]?.name).toBe("jane.doe");
  });
});

describe("OrderCreationAdapter (Checkout -> Orders, C-2)", () => {
  it("maps checkoutSessionId/customerRef/currency and returns orderId as orderRef on success", async () => {
    const calls: CreateFromCheckoutCall[] = [];
    const orders = fakeOrderController(calls);
    const adapter = new OrderCreationAdapter(orders, fakeCustomers().customers);

    const result = await adapter.create({
      tenantId: "tenant-local",
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
    const adapter = new OrderCreationAdapter(orders, fakeCustomers().customers);

    await adapter.create({
      tenantId: "tenant-local",
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
    const adapter = new OrderCreationAdapter(orders, fakeCustomers().customers);

    await adapter.create({
      tenantId: "tenant-local",
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
    const adapter = new OrderCreationAdapter(orders, fakeCustomers().customers);

    await adapter.create({
      tenantId: "tenant-local",
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
    const adapter = new OrderCreationAdapter(orders, fakeCustomers().customers);

    await expect(
      adapter.create({
        tenantId: "tenant-local",
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
