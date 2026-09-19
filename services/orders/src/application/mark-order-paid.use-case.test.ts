import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { MarkOrderPaid } from "./mark-order-paid.use-case";
import { PlaceOrder } from "./place-order.use-case";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import type { PaymentTruthShadowObservation, PaymentTruthShadowPort } from "./payment-truth-shadow";
import type { PaymentVerificationPort } from "./ports";

const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };

function sequentialIds(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

function wire(shadow?: PaymentTruthShadowPort, paymentVerification?: PaymentVerificationPort) {
  const idGenerator = sequentialIds();
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new OrderEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "orders",
  });
  const orders = new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) });
  const unitOfWork = new InMemoryUnitOfWork();
  const placeOrder = new PlaceOrder({ orders, unitOfWork, idGenerator, clock });
  const markOrderPaid = new MarkOrderPaid({
    orders,
    unitOfWork,
    idGenerator,
    clock,
    shadow,
    paymentVerification,
  });
  return { placeOrder, markOrderPaid };
}

async function placeAnOrder(placeOrder: PlaceOrder): Promise<string> {
  const placed = await placeOrder.execute({
    tenantId: "tenant-a",
    customerRef: "customer-1",
    currency: "USD",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
    shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
  });
  if (!placed.ok) throw new Error("setup failed");
  return placed.value.orderId;
}

describe("MarkOrderPaid (Sprint A1 — Payment Truth Foundation)", () => {
  it("succeeds without a shadow port wired (default, no behavior change)", async () => {
    const { placeOrder, markOrderPaid } = wire();
    const orderId = await placeAnOrder(placeOrder);

    const result = await markOrderPaid.execute({
      tenantId: "tenant-a",
      orderId,
      paymentRef: "payment-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("paid");
  });

  it("calls the shadow port's observe exactly once after a successful completePayment", async () => {
    const observations: PaymentTruthShadowObservation[] = [];
    const shadow: PaymentTruthShadowPort = { observe: (o) => observations.push(o) };
    const { placeOrder, markOrderPaid } = wire(shadow);
    const orderId = await placeAnOrder(placeOrder);

    await markOrderPaid.execute({ tenantId: "tenant-a", orderId, paymentRef: "payment-1" });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual({ orderId, paymentRef: "payment-1", resultingStatus: "paid" });
  });

  it("never calls the shadow port when completePayment fails", async () => {
    const observations: PaymentTruthShadowObservation[] = [];
    const shadow: PaymentTruthShadowPort = { observe: (o) => observations.push(o) };
    const { markOrderPaid } = wire(shadow);

    const result = await markOrderPaid.execute({
      tenantId: "tenant-a",
      orderId: "missing-order",
      paymentRef: "payment-1",
    });

    expect(result.ok).toBe(false);
    expect(observations).toHaveLength(0);
  });

  it("succeeds without a payment-verification port wired (default, no behavior change)", async () => {
    const { placeOrder, markOrderPaid } = wire();
    const orderId = await placeAnOrder(placeOrder);

    const result = await markOrderPaid.execute({
      tenantId: "tenant-a",
      orderId,
      paymentRef: "payment-1",
    });

    expect(result.ok).toBe(true);
  });

  it("succeeds when the payment-verification port confirms a captured payment", async () => {
    const paymentVerification: PaymentVerificationPort = { hasCapturedPayment: async () => true };
    const { placeOrder, markOrderPaid } = wire(undefined, paymentVerification);
    const orderId = await placeAnOrder(placeOrder);

    const result = await markOrderPaid.execute({
      tenantId: "tenant-a",
      orderId,
      paymentRef: "payment-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("paid");
  });

  it("rejects with a validation error when the payment-verification port cannot confirm it, before touching the order", async () => {
    const observations: PaymentTruthShadowObservation[] = [];
    const shadow: PaymentTruthShadowPort = { observe: (o) => observations.push(o) };
    const paymentVerification: PaymentVerificationPort = { hasCapturedPayment: async () => false };
    const { placeOrder, markOrderPaid } = wire(shadow, paymentVerification);
    const orderId = await placeAnOrder(placeOrder);

    const result = await markOrderPaid.execute({
      tenantId: "tenant-a",
      orderId,
      paymentRef: "fake-ref",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    // Rejected before completePayment ever ran — the shadow port (which only observes successful
    // completions) was never called either, confirming the order itself was never touched.
    expect(observations).toHaveLength(0);
  });

  it("passes both orderId and paymentRef to the payment-verification port", async () => {
    const seen: { orderId: string; paymentRef: string }[] = [];
    const paymentVerification: PaymentVerificationPort = {
      hasCapturedPayment: async (orderId, paymentRef) => {
        seen.push({ orderId, paymentRef });
        return true;
      },
    };
    const { placeOrder, markOrderPaid } = wire(undefined, paymentVerification);
    const orderId = await placeAnOrder(placeOrder);

    await markOrderPaid.execute({ tenantId: "tenant-a", orderId, paymentRef: "payment-xyz" });

    expect(seen).toEqual([{ orderId, paymentRef: "payment-xyz" }]);
  });
});
