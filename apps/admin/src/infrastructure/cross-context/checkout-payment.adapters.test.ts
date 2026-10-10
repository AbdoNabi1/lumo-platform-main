import { describe, expect, it, vi } from "vitest";
import type { OrderController } from "@platform/orders";
import type { PaymentController } from "@platform/payments";
import type { Logger } from "@platform/utils";
import { CheckoutPaymentInitiationAdapter } from "./checkout-payment.adapters";

type Payments = Pick<PaymentController, "createIntentLifecycle">;
type Orders = Pick<OrderController, "recordCheckoutPayment">;

const input = {
  tenantId: "tenant-a",
  orderRef: "order-1",
  provider: "cod",
  amountMinor: 3998,
  currency: "EGP",
};

function silentLogger() {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return log as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

function intentCreated(): Payments {
  return {
    createIntentLifecycle: vi.fn().mockResolvedValue({
      status: 201,
      body: { paymentIntentId: "intent-1", status: "created", provider: "cod" },
    }),
  };
}

describe("CheckoutPaymentInitiationAdapter (Plan 3B: link the payment to its order)", () => {
  it("tells Orders which payment was opened, right after Payments answers 201", async () => {
    const orders: Orders = {
      recordCheckoutPayment: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    };
    const adapter = new CheckoutPaymentInitiationAdapter(intentCreated(), orders, silentLogger());

    const opened = await adapter.initiate(input);

    expect(opened).toEqual({ paymentIntentId: "intent-1", status: "created", provider: "cod" });
    expect(orders.recordCheckoutPayment).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      orderId: "order-1",
      paymentRef: "intent-1",
    });
  });

  it("still returns the intent when Orders refuses the link, and logs the order id only", async () => {
    const orders: Orders = {
      recordCheckoutPayment: vi
        .fn()
        .mockResolvedValue({ status: 409, body: { message: "Cannot record for guest@x.com" } }),
    };
    const logger = silentLogger();
    const adapter = new CheckoutPaymentInitiationAdapter(intentCreated(), orders, logger);

    const opened = await adapter.initiate(input);

    expect(opened.paymentIntentId).toBe("intent-1");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toEqual({ orderId: "order-1", status: 409 });
  });

  it("still returns the intent when the Orders call itself throws, and logs the order id only", async () => {
    const orders: Orders = {
      recordCheckoutPayment: vi.fn().mockRejectedValue(new Error("boom: guest@x.com")),
    };
    const logger = silentLogger();
    const adapter = new CheckoutPaymentInitiationAdapter(intentCreated(), orders, logger);

    const opened = await adapter.initiate(input);

    expect(opened.paymentIntentId).toBe("intent-1");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toEqual({ orderId: "order-1" });
    expect(message).not.toContain("guest@x.com");
  });

  it("does not touch Orders when Payments refuses to open the intent", async () => {
    const payments: Payments = {
      createIntentLifecycle: vi
        .fn()
        .mockResolvedValue({ status: 409, body: { message: "method not enabled" } }),
    };
    const orders: Orders = { recordCheckoutPayment: vi.fn() };
    const adapter = new CheckoutPaymentInitiationAdapter(payments, orders, silentLogger());

    await expect(adapter.initiate(input)).rejects.toThrow("method not enabled");

    expect(orders.recordCheckoutPayment).not.toHaveBeenCalled();
  });
});
