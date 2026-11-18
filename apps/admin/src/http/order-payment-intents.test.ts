import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import { paymentIntentsOfOrders } from "./order-payment-intents";

const principal = { id: "staff-1", kind: "staff", roles: ["admin"] } as never;
const order = (paymentRef: string | undefined) => ({ paymentRef }) as unknown as Order;

function adminAnswering(response: { status: number; body: unknown }) {
  const paymentIntentsOf = vi.fn().mockResolvedValue(response);
  return { admin: { orders: { paymentIntentsOf } } as unknown as WiredAdmin, paymentIntentsOf };
}

describe("paymentIntentsOfOrders", () => {
  it("reads every linked payment of the page in ONE call, deduped, and indexes them by id", async () => {
    const intent = { id: "i-1", orderRef: "o-1" };
    const { admin, paymentIntentsOf } = adminAnswering({ status: 200, body: [intent] });

    const found = await paymentIntentsOfOrders(admin, principal, "t-1", [
      order("i-1"),
      order(undefined),
      order("i-1"),
    ]);

    expect(paymentIntentsOf).toHaveBeenCalledTimes(1);
    expect(paymentIntentsOf).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      paymentIntentIds: ["i-1"],
    });
    expect(found.ok && found.byId.get("i-1")).toEqual(intent);
  });

  it("makes no call when no order has a linked payment", async () => {
    const { admin, paymentIntentsOf } = adminAnswering({ status: 200, body: [] });
    const found = await paymentIntentsOfOrders(admin, principal, "t-1", [order(undefined)]);
    expect(found.ok).toBe(true);
    expect(paymentIntentsOf).not.toHaveBeenCalled();
  });

  it("answers a failed read as the failure, never as 'no payments'", async () => {
    const { admin } = adminAnswering({ status: 503, body: { message: "down" } });
    const found = await paymentIntentsOfOrders(admin, principal, "t-1", [order("i-1")]);
    expect(found).toEqual({ ok: false, response: { status: 503, body: { message: "down" } } });
  });
});
