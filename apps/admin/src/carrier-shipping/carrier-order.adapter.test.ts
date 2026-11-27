import { beforeEach, expect, it, vi } from "vitest";
import type { OrderController } from "@platform/orders";
import type { PaymentController } from "@platform/payments";
import { CarrierOrderAdapter } from "./carrier-order.adapter";

beforeEach(() => {
  expect.hasAssertions();
});
it("derives order payment history and resolves line images in the order tenant", async () => {
  const getOrder = vi.fn().mockResolvedValue({
    status: 200,
    body: {
      id: { toString: () => "o-1" },
      orderNumber: { value: "1001" },
      history: [{ type: "paid" }],
      totalAmount: () => ({ amountMinor: 25000 }),
      currency: "EGP",
      paymentRef: "pi-1",
      shippingAddress: { line1: "Street", city: "Cairo", country: "EG" },
      items: [
        {
          snapshot: { productId: "p-1", variantRef: "v-1", name: "Shirt", variantTitle: "Blue" },
          quantity: 2,
        },
      ],
    },
  });
  const lineImageUrls = vi.fn().mockResolvedValue(new Map([["p-1:v-1", "https://example.com/a"]]));
  const adapter = new CarrierOrderAdapter({
    orders: { getOrder } as Pick<OrderController, "getOrder">,
    payments: {} as PaymentController,
    lineImageUrls,
  });
  expect(await adapter.read("t-1", "o-1")).toEqual(
    expect.objectContaining({
      orderId: "o-1",
      orderNumber: "1001",
      paymentStatus: "paid",
      open: true,
      totalMinor: 25000,
      items: [
        {
          productId: "p-1",
          name: "Shirt",
          variantTitle: "Blue",
          quantity: 2,
          imageUrl: "https://example.com/a",
        },
      ],
    }),
  );
  expect(getOrder).toHaveBeenCalledWith({ tenantId: "t-1", orderId: "o-1" });
  expect(lineImageUrls).toHaveBeenCalledWith("t-1", [{ productId: "p-1", variantId: "v-1" }]);
});
it("reads COD intent currency and amount in tenant scope", async () => {
  const getPaymentIntent = vi.fn().mockResolvedValue({
    status: 200,
    body: {
      provider: "cod",
      status: { value: "created" },
      amount: { amountMinor: 25000, currency: "EGP" },
    },
  });
  const adapter = new CarrierOrderAdapter({
    orders: {} as OrderController,
    payments: { getPaymentIntent } as Pick<PaymentController, "getPaymentIntent">,
    lineImageUrls: vi.fn(),
  });
  expect(await adapter.codIntent("t-1", "pi-1")).toEqual({
    provider: "cod",
    status: "created",
    amountMinor: 25000,
    currency: "EGP",
  });
  expect(getPaymentIntent).toHaveBeenCalledWith({ tenantId: "t-1", paymentIntentId: "pi-1" });
});
