import { describe, expect, it, vi } from "vitest";
import type { PaymentController } from "@platform/payments";
import type { Logger } from "@platform/utils";
import { OrdersPaymentVoidAdapter } from "./orders-payment-void.adapter";

type Payments = Pick<PaymentController, "getPaymentIntent" | "advance">;

function logger() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  log.child.mockReturnValue(log);
  return log as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

/** `getPaymentIntent` answers with the intent entity: its status is a value object with `.value`. */
function paymentsWith(status: string, advance = vi.fn().mockResolvedValue({ status: 200 })) {
  const payments: Payments = {
    getPaymentIntent: vi.fn().mockResolvedValue({
      status: 200,
      body: { id: { toString: () => "intent-1" }, status: { value: status }, provider: "cod" },
    }),
    advance,
  };
  return { payments, advance };
}

describe("OrdersPaymentVoidAdapter (G-126: cancel an unpaid order's payment intent)", () => {
  it("cancels an intent that is still only created, through Payments' own transition", async () => {
    const { payments, advance } = paymentsWith("created");

    await new OrdersPaymentVoidAdapter(payments, logger()).voidPayment("intent-1", "tenant-a");

    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      paymentIntentId: "intent-1",
      toStatus: "cancelled",
    });
  });

  it.each(["captured", "refunded", "partially_refunded", "closed", "cancelled", "failed"])(
    "leaves an intent that is already %s alone",
    async (status) => {
      const { payments, advance } = paymentsWith(status);

      await new OrdersPaymentVoidAdapter(payments, logger()).voidPayment("intent-1", "tenant-a");

      expect(advance).not.toHaveBeenCalled();
    },
  );

  it("does not cancel an authorized intent: nothing here releases the hold at the PSP, so it says so", async () => {
    const { payments, advance } = paymentsWith("authorized");
    const log = logger();

    await new OrdersPaymentVoidAdapter(payments, log).voidPayment("intent-1", "tenant-a");

    expect(advance).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("logs and carries on when the intent cannot be read", async () => {
    const payments: Payments = {
      getPaymentIntent: vi.fn().mockResolvedValue({ status: 404, body: {} }),
      advance: vi.fn(),
    };
    const log = logger();

    await expect(
      new OrdersPaymentVoidAdapter(payments, log).voidPayment("intent-1", "tenant-a"),
    ).resolves.toBeUndefined();

    expect(payments.advance).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("logs and carries on when Payments refuses or fails the cancellation, with ids only", async () => {
    const advance = vi
      .fn()
      .mockResolvedValue({ status: 409, body: { message: "Cannot cancel for guest@x.com" } });
    const { payments } = paymentsWith("created", advance);
    const log = logger();

    await expect(
      new OrdersPaymentVoidAdapter(payments, log).voidPayment("intent-1", "tenant-a"),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("guest@x.com");
  });

  it("never throws, even when Payments throws", async () => {
    const payments: Payments = {
      getPaymentIntent: vi.fn().mockRejectedValue(new Error("boom")),
      advance: vi.fn(),
    };
    const log = logger();

    await expect(
      new OrdersPaymentVoidAdapter(payments, log).voidPayment("intent-1", "tenant-a"),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
