import { describe, expect, it } from "vitest";
import type { OrderController } from "@platform/orders";
import { PaymentsOrdersAdapter } from "./payments-orders.adapter";

interface GetOrderCall {
  readonly orderId: string;
}

interface FakeCalls {
  readonly getOrder: GetOrderCall[];
}

/**
 * A fake `OrderController` narrowed to `getOrder` (the only method this adapter is allowed to
 * call) PLUS every state-mutating method (`markPaid`/`advance`/`refund`), each of which throws if
 * invoked — proving the adapter's "never mutate" design constraint the same way Task 12a's
 * throwing-fake style proves negative claims elsewhere in this codebase: if the adapter ever
 * called a mutating method, this test would fail loudly instead of silently passing.
 */
function fakeOrderController(
  calls: FakeCalls,
  options: { found?: boolean } = {},
): Pick<OrderController, "getOrder" | "markPaid" | "advance" | "refund"> {
  const found = options.found ?? true;
  return {
    async getOrder(input) {
      calls.getOrder.push(input);
      if (!found) {
        return { status: 404, body: { code: "NOT_FOUND", message: "Order not found" } };
      }
      return {
        status: 200,
        body: { orderId: input.orderId, customerRef: "customer-1", status: "created" },
      };
    },
    markPaid() {
      throw new Error(
        "fakeOrderController: markPaid must never be called by PaymentsOrdersAdapter",
      );
    },
    advance() {
      throw new Error("fakeOrderController: advance must never be called by PaymentsOrdersAdapter");
    },
    refund() {
      throw new Error("fakeOrderController: refund must never be called by PaymentsOrdersAdapter");
    },
  };
}

function emptyCalls(): FakeCalls {
  return { getOrder: [] };
}

describe("PaymentsOrdersAdapter (Payments -> Orders, C-3)", () => {
  it("looks up the order by orderRef and resolves without throwing when the order exists", async () => {
    const calls = emptyCalls();
    const orders = fakeOrderController(calls);
    const adapter = new PaymentsOrdersAdapter(orders);

    await expect(adapter.reportPaymentOutcome("ORD-1001", "captured")).resolves.toBeUndefined();

    expect(calls.getOrder).toEqual([{ orderId: "ORD-1001" }]);
  });

  it("propagates a lookup failure (no swallowing here — the call site already swallows)", async () => {
    const calls = emptyCalls();
    const orders = fakeOrderController(calls, { found: false });
    const adapter = new PaymentsOrdersAdapter(orders);

    await expect(adapter.reportPaymentOutcome("ORD-9999", "captured")).rejects.toThrow();
    expect(calls.getOrder).toEqual([{ orderId: "ORD-9999" }]);
  });

  it("never calls a state-mutating Orders method, even for a 'captured' status transition", async () => {
    const calls = emptyCalls();
    // Every mutating method on this fake throws if invoked (see fakeOrderController) — reaching
    // this line for every status below, including "captured", proves none of them were called.
    const orders = fakeOrderController(calls);
    const adapter = new PaymentsOrdersAdapter(orders);

    await adapter.reportPaymentOutcome("ORD-2002", "created");
    await adapter.reportPaymentOutcome("ORD-2002", "capture_requested");
    await adapter.reportPaymentOutcome("ORD-2002", "captured");
    await adapter.reportPaymentOutcome("ORD-2002", "refunded");

    expect(calls.getOrder).toHaveLength(4);
  });
});
