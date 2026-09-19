import { describe, expect, it } from "vitest";
import type { PaymentController } from "@platform/payments";
import { OrdersPaymentAdapter } from "./orders-payment.adapter";

interface CreateIntentCall {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

interface CaptureCall {
  readonly paymentIntentId: string;
}

interface FakeCalls {
  readonly sequence: string[];
  readonly createIntentLifecycle: CreateIntentCall[];
  readonly captureLifecycle: CaptureCall[];
}

/**
 * A fake `PaymentController` narrowed to `createIntentLifecycle`/`captureLifecycle` — the 2 methods
 * this adapter calls — recording both the sequence and the arguments of every call.
 */
function fakePaymentController(
  calls: FakeCalls,
  options: {
    createStatus?: number;
    captureStatus?: number;
    captureResultStatus?: string;
  } = {},
): Pick<PaymentController, "createIntentLifecycle" | "captureLifecycle"> {
  const createStatus = options.createStatus ?? 201;
  const captureStatus = options.captureStatus ?? 200;
  const captureResultStatus = options.captureResultStatus ?? "captured";
  let counter = 0;

  return {
    async createIntentLifecycle(input) {
      calls.sequence.push("createIntentLifecycle");
      calls.createIntentLifecycle.push(input);
      if (createStatus !== 201) {
        return { status: createStatus, body: { code: "VALIDATION", message: "bad input" } };
      }
      counter += 1;
      return {
        status: 201,
        body: {
          paymentIntentId: `pi-${counter}`,
          status: "created",
          providerIntentId: `provider-pi-${counter}`,
        },
      };
    },
    async captureLifecycle(input) {
      calls.sequence.push("captureLifecycle");
      calls.captureLifecycle.push(input);
      if (captureStatus !== 200) {
        return { status: captureStatus, body: { code: "CONFLICT", message: "cannot capture" } };
      }
      return {
        status: 200,
        body: { paymentIntentId: input.paymentIntentId, status: captureResultStatus },
      };
    },
  };
}

function emptyCalls(): FakeCalls {
  return { sequence: [], createIntentLifecycle: [], captureLifecycle: [] };
}

describe("OrdersPaymentAdapter (Orders -> Payments, C-3)", () => {
  it("chains createIntentLifecycle -> captureLifecycle in order", async () => {
    const calls = emptyCalls();
    const payments = fakePaymentController(calls);
    const adapter = new OrdersPaymentAdapter(payments);

    await adapter.requestCapture("ORD-1001", 5_000, "USD", "tenant-a");

    expect(calls.sequence).toEqual(["createIntentLifecycle", "captureLifecycle"]);
    expect(calls.captureLifecycle[0]?.paymentIntentId).toBe("pi-1");
  });

  it("maps orderId/amountMinor/currency directly into CreatePaymentIntentLifecycleInput", async () => {
    const calls = emptyCalls();
    const payments = fakePaymentController(calls);
    const adapter = new OrdersPaymentAdapter(payments);

    await adapter.requestCapture("ORD-2002", 12_345, "EUR", "tenant-a");

    expect(calls.createIntentLifecycle[0]).toEqual({
      tenantId: "tenant-a",
      orderRef: "ORD-2002",
      amountMinor: 12_345,
      currency: "EUR",
    });
  });

  it("returns the created paymentIntentId as paymentRef on a successful capture", async () => {
    const calls = emptyCalls();
    const payments = fakePaymentController(calls);
    const adapter = new OrdersPaymentAdapter(payments);

    const result = await adapter.requestCapture("ORD-3003", 1_000, "USD", "tenant-a");

    expect(result).toEqual({ paymentRef: "pi-1" });
  });

  it("propagates a createIntentLifecycle failure without calling captureLifecycle", async () => {
    const calls = emptyCalls();
    const payments = fakePaymentController(calls, { createStatus: 422 });
    const adapter = new OrdersPaymentAdapter(payments);

    await expect(adapter.requestCapture("ORD-4004", 1_000, "USD", "tenant-a")).rejects.toThrow();
    expect(calls.sequence).toEqual(["createIntentLifecycle"]);
  });

  it("propagates a captureLifecycle transport failure (non-200 status) after a successful create", async () => {
    const calls = emptyCalls();
    const payments = fakePaymentController(calls, { captureStatus: 409 });
    const adapter = new OrdersPaymentAdapter(payments);

    await expect(adapter.requestCapture("ORD-5005", 1_000, "USD", "tenant-a")).rejects.toThrow();
    expect(calls.sequence).toEqual(["createIntentLifecycle", "captureLifecycle"]);
  });

  it('throws, without fabricating a paymentRef, when capture does not reach status "captured"', async () => {
    const calls = emptyCalls();
    const payments = fakePaymentController(calls, { captureResultStatus: "capture_requested" });
    const adapter = new OrdersPaymentAdapter(payments);

    await expect(adapter.requestCapture("ORD-6006", 1_000, "USD", "tenant-a")).rejects.toThrow(
      /capture_requested/,
    );
  });
});

describe("OrdersPaymentAdapter tenant (ADR-0014)", () => {
  it("passes the per-call tenant to both Payments calls", async () => {
    const calls = emptyCalls();
    const adapter = new OrdersPaymentAdapter(fakePaymentController(calls));

    await adapter.requestCapture("ORD-9", 100, "USD", "tenant-b");

    expect(calls.createIntentLifecycle[0]).toMatchObject({ tenantId: "tenant-b" });
    expect(calls.captureLifecycle[0]).toMatchObject({ tenantId: "tenant-b" });
  });
});
