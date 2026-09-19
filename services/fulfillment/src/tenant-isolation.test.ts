import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { wireFulfillment } from "./composition";
import { FulfillmentOrder } from "./domain/fulfillment-order";
import { FulfillmentItem } from "./domain/value-objects/fulfillment-item";
import { InMemoryFulfillmentOrderRepository } from "./infrastructure/in-memory-fulfillment-order-repository";
import { InMemoryProcessedCarrierWebhookStore } from "./infrastructure/in-memory-port-adapters";
import { FulfillmentEventTranslator } from "./infrastructure/fulfillment-event-translator";

/**
 * ADR-0014 (WP-10, T10.3): one Fulfillment composition serves every tenant. The carrier-webhook
 * dedup store used to key on `(carrier, eventId)` alone — tenant A's event id marked tenant B's
 * identical id as already processed, so B's webhook was silently dropped.
 */
function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-12T00:00:00.000Z") };

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

function newOrder(id: string): FulfillmentOrder {
  return FulfillmentOrder.create(UniqueEntityId.from(id), "order-1", [
    unwrap(FulfillmentItem.create(unwrap(ProductRef.create("product-1")), 1)),
  ]);
}

async function dispatchedOrder(
  app: ReturnType<typeof wireFulfillment>,
  tenantId: string,
): Promise<string> {
  const created = await app.fulfillment.create({
    tenantId,
    orderRef: "order-1",
    items: [{ productRef: "product-1", quantity: 1 }],
  });
  const id = (created.body as { fulfillmentOrderId: string }).fulfillmentOrderId;
  await app.fulfillment.reserve({ tenantId, fulfillmentOrderId: id });
  for (const toStatus of [
    "picking_started",
    "picking_completed",
    "packing_started",
    "packing_completed",
  ] as const) {
    await app.fulfillment.advance({ tenantId, fulfillmentOrderId: id, toStatus });
  }
  await app.fulfillment.ship({ tenantId, fulfillmentOrderId: id });
  await app.fulfillment.advance({
    tenantId,
    fulfillmentOrderId: id,
    toStatus: "shipment_dispatched",
  });
  return id;
}

describe("fulfillment tenant isolation (ADR-0014)", () => {
  it("tenant A's carrier event id does not mark tenant B's identical id as processed", async () => {
    const store = new InMemoryProcessedCarrierWebhookStore();
    await store.markProcessed("ups", "evt-1", "tenant-a");

    expect(await store.hasProcessed("ups", "evt-1", "tenant-a")).toBe(true);
    expect(await store.hasProcessed("ups", "evt-1", "tenant-b")).toBe(false);
  });

  it("RecordCarrierWebhook processes tenant B's webhook after tenant A handled the same event id", async () => {
    const app = wireFulfillment({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    const idA = await dispatchedOrder(app, "tenant-a");
    const idB = await dispatchedOrder(app, "tenant-b");
    const hook = (tenantId: string, fulfillmentOrderId: string) =>
      app.fulfillment.recordWebhook({
        tenantId,
        fulfillmentOrderId,
        carrier: "ups",
        eventId: "evt-shared",
        kind: "in_transit",
      });

    const a = await hook("tenant-a", idA);
    const b = await hook("tenant-b", idB);
    const aReplay = await hook("tenant-a", idA);

    expect((a.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((b.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((b.body as { status: string }).status).toBe("in_transit");
    expect((aReplay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("two tenants sharing one repository and an identical order ref never see each other's rows", async () => {
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new FulfillmentEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "fulfillment",
    });
    const repo = new InMemoryFulfillmentOrderRepository({
      outbox,
      context: rootEventContext(sequentialIds()),
    });
    await repo.save(newOrder("fo-1"), "tenant-a");

    expect(await repo.findById("fo-1", "tenant-b")).toBeNull();
    expect(await repo.findByOrderRef("order-1", "tenant-b")).toBeNull();
    expect(await repo.findByOrderRef("order-1", "tenant-a")).not.toBeNull();
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("fulfillment", async (outbox, tenantId) => {
      const repo = new InMemoryFulfillmentOrderRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const order = newOrder("fo-1");
      order.transition("reservation_requested", "evt-1", new Date(0));
      await repo.save(order, tenantId);
    });
  });
});
