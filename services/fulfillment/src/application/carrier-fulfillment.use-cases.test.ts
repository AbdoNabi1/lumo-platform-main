import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { err, ok, type Result } from "@platform/types";
import { NotFoundError, type DomainError } from "@platform/utils";
import { FulfillmentOrder } from "../domain/fulfillment-order";
import { FulfillmentItem } from "../domain/value-objects/fulfillment-item";
import type { FulfillmentStatusValue } from "../domain/value-objects/fulfillment-status";
import { FulfillmentEventTranslator } from "../infrastructure/fulfillment-event-translator";
import { InMemoryFulfillmentOrderRepository } from "../infrastructure/in-memory-fulfillment-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import {
  AttachCarrierShipment,
  DetachCarrierShipment,
  MirrorShipmentStatus,
  PrepareForCarrierShipment,
} from "./carrier-fulfillment.use-cases";
import type { FulfillmentOrderStatusOutput } from "./create-fulfillment.use-case";
import type { InventoryPort, NotificationPort, OrdersPort, ReservationResult } from "./ports";
import { RequestReservation } from "./request-reservation.use-case";

beforeEach(() => {
  expect.hasAssertions();
});

const T = "tenant-a";
const clock: Clock = { now: () => new Date("2026-11-12T10:00:00.000Z") };

/** Records the `toStatus` of every event an aggregate holds at save time (the status trail). */
class TrailRepository extends InMemoryFulfillmentOrderRepository {
  trail: string[] = [];
  override async save(order: FulfillmentOrder, tenantId: string, tx?: unknown): Promise<void> {
    for (const event of order.domainEvents) {
      this.trail.push((event as unknown as { data: { toStatus: string } }).data.toStatus);
    }
    await super.save(order, tenantId, tx);
  }
}

class ScriptedInventory implements InventoryPort {
  calls = 0;
  private readonly result: ReservationResult;
  constructor(result: ReservationResult) {
    this.result = result;
  }
  reserve(): Promise<ReservationResult> {
    this.calls += 1;
    return Promise.resolve(this.result);
  }
}

function must<V>(r: { ok: boolean; value?: V }): V {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

const CHAIN: readonly FulfillmentStatusValue[] = [
  "reservation_requested",
  "confirmed",
  "picking_started",
  "picking_completed",
  "packing_started",
  "packing_completed",
  "shipment_created",
  "tracking_assigned",
];

function harness(reserve: ReservationResult, extras: { failingNotify?: boolean } = {}) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new FulfillmentEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "fulfillment",
  });
  const repo = new TrailRepository({ outbox, context: rootEventContext(idGenerator) });
  const reported: string[] = [];
  const ordersPort: OrdersPort = {
    reportFulfillmentOutcome: (_ref: string, status: string) => {
      if (extras.failingNotify === true) return Promise.reject(new Error("orders down"));
      reported.push(status);
      return Promise.resolve();
    },
  };
  const notifications: NotificationPort = { notify: () => Promise.resolve() };
  const inventory = new ScriptedInventory(reserve);
  const deps = {
    fulfillmentOrders: repo,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    ordersPort,
    notifications,
  };
  const requestReservation = new RequestReservation({ ...deps, inventoryPort: inventory });
  const h = {
    repo,
    inventory,
    reported,
    prepare: new PrepareForCarrierShipment({ ...deps, requestReservation }),
    attach: new AttachCarrierShipment(deps),
    detach: new DetachCarrierShipment(deps),
    mirror: new MirrorShipmentStatus(deps),
    deps,
    /** Seeds an order already walked to `status`; the trail is cleared afterwards. */
    async seed(orderRef: string, status: FulfillmentStatusValue): Promise<string> {
      const item = must(FulfillmentItem.create(must(ProductRef.create("product-1")), 1));
      const id = `ff-${orderRef}`;
      const order = FulfillmentOrder.create(UniqueEntityId.from(id), orderRef, [item]);
      if (status === "failed") {
        order.requestReservation("s", clock.now());
        order.failReservation("x", "s", clock.now());
      } else if (status !== "created") {
        for (const step of CHAIN.slice(0, CHAIN.indexOf(status) + 1)) {
          order.transition(step, "s", clock.now());
        }
      }
      await repo.save(order, T);
      repo.trail = [];
      return id;
    },
    createOrder: (orderRef: string) => h.seed(orderRef, "created"),
    packedOrder: (orderRef: string) => h.seed(orderRef, "packing_completed"),
    async attachedOrder(orderRef: string): Promise<string> {
      const id = await h.packedOrder(orderRef);
      must(await h.attach.execute(attachInput(id)));
      h.repo.trail = [];
      return id;
    },
    async order(id: string): Promise<FulfillmentOrder> {
      const found = await repo.findById(id, T);
      if (found === null) throw new Error("missing order");
      return found;
    },
    async statusAfterMirror(id: string, shipmentStatus: string): Promise<string> {
      const r = must(
        await h.mirror.execute({ tenantId: T, fulfillmentOrderId: id, shipmentStatus }),
      );
      return r.status;
    },
  };
  return h;
}

function attachInput(id: string, trackingNumber = "5108002") {
  return {
    tenantId: T,
    fulfillmentOrderId: id,
    carrier: "bosta",
    carrierShipmentId: "del-1",
    trackingNumber,
  };
}

function message(r: Result<unknown, DomainError>): string {
  return r.ok ? "" : r.error.message;
}

describe("PrepareForCarrierShipment (9a.3)", () => {
  it("walks a new fulfillment order through reservation to packing_completed", async () => {
    const h = harness({ confirmed: true });
    const id = await h.createOrder("order-1");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
    expect(h.repo.trail).toEqual([
      "reservation_requested",
      "confirmed",
      "picking_started",
      "picking_completed",
      "packing_started",
      "packing_completed",
    ]);
    expect(h.reported.at(-1)).toBe("packing_completed");
  });

  it("is STOCK_NOT_RESERVED when inventory refuses", async () => {
    const h = harness({ confirmed: false, reason: "out of stock" });
    const id = await h.createOrder("order-1");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(!result.ok && result.error.message).toMatch(/^STOCK_NOT_RESERVED:/);
    expect((await h.order(id)).status.value).toBe("failed");
  });

  it("retries a failed reservation", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "failed");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
  });

  it("resumes from picking_started without asking inventory again", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "picking_started");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
    expect(h.inventory.calls).toBe(0);
    expect(h.repo.trail).toEqual(["picking_completed", "packing_started", "packing_completed"]);
  });

  it.each(["packing_completed", "shipment_created", "tracking_assigned"] as const)(
    "leaves %s untouched",
    async (status) => {
      const h = harness({ confirmed: true });
      const id = await h.seed("order-1", status);
      const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
      expect(result.ok && result.value.status).toBe(status);
      expect(h.repo.trail).toEqual([]);
    },
  );

  it("refuses a status that cannot ship", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "tracking_assigned");
    const order = await h.order(id);
    order.transition("shipment_dispatched", "x", clock.now());
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(message(result)).toMatch(/^FULFILLMENT_NOT_SHIPPABLE:/);
  });

  it("is SHIPMENT_IN_PROGRESS when a concurrent reservation won the race (F19)", async () => {
    const h = harness({ confirmed: true });
    const id = await h.createOrder("order-1");
    const racing = {
      execute: (): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> =>
        Promise.resolve(ok({ fulfillmentOrderId: id, status: "reservation_requested" })),
    };
    const prepare = new PrepareForCarrierShipment({ ...h.deps, requestReservation: racing });
    const result = await prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(message(result)).toMatch(/^SHIPMENT_IN_PROGRESS:/);
  });

  it("passes a reservation error through", async () => {
    const h = harness({ confirmed: true });
    const failing = { execute: () => Promise.resolve(err(new NotFoundError("gone"))) };
    const prepare = new PrepareForCarrierShipment({ ...h.deps, requestReservation: failing });
    const id = await h.createOrder("order-1");
    const result = await prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });

  it("is NOT_FOUND for an unknown order and for another tenant's order", async () => {
    const h = harness({ confirmed: true });
    const id = await h.createOrder("order-1");
    const unknown = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: "nope" });
    const other = await h.prepare.execute({ tenantId: "tenant-b", fulfillmentOrderId: id });
    expect(!unknown.ok && unknown.error.code).toBe("NOT_FOUND");
    expect(!other.ok && other.error.code).toBe("NOT_FOUND");
  });

  it("refuses the walk when the reservation step claims confirmed but the order is not", async () => {
    const h = harness({ confirmed: true });
    const id = await h.createOrder("order-1");
    const vanishing = {
      execute: (): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> =>
        Promise.resolve(ok({ fulfillmentOrderId: id, status: "confirmed" })),
    };
    const prepare = new PrepareForCarrierShipment({ ...h.deps, requestReservation: vanishing });
    const result = await prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    // The stub says confirmed but the order is still `created`: the walk refuses it.
    expect(message(result)).toMatch(/^FULFILLMENT_NOT_SHIPPABLE:/);
  });

  it("does not fail the result when the best-effort notification fails", async () => {
    const h = harness({ confirmed: true }, { failingNotify: true });
    const id = await h.seed("order-2", "confirmed");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
    expect(h.reported).toEqual([]);
  });
});

describe("Attach / Detach (Ruling 35, 9a.3)", () => {
  it("attach is idempotent for the same tracking number; detach clears it back to packing_completed", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const input = attachInput(id);
    expect((await h.attach.execute(input)).ok).toBe(true);
    expect((await h.attach.execute(input)).ok).toBe(true);
    expect((await h.order(id)).trackingNumber?.value).toBe("5108002");
    expect((await h.order(id)).carrierReference?.carrierShipmentId).toBe("del-1");
    expect(h.repo.trail).toEqual(["shipment_created", "tracking_assigned"]);
    const detached = await h.detach.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(detached.ok && detached.value.status).toBe("packing_completed");
    expect((await h.order(id)).trackingNumber).toBeUndefined();
    expect((await h.order(id)).carrierReference).toBeUndefined();
  });

  it("attach assigns tracking from shipment_created", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "shipment_created");
    const result = await h.attach.execute(attachInput(id));
    expect(result.ok && result.value.status).toBe("tracking_assigned");
  });

  it("attach refuses a different tracking number once assigned", async () => {
    const h = harness({ confirmed: true });
    const id = await h.attachedOrder("order-1");
    const result = await h.attach.execute(attachInput(id, "OTHER"));
    expect(message(result)).toMatch(/^FULFILLMENT_NOT_ATTACHABLE:/);
    expect((await h.order(id)).trackingNumber?.value).toBe("5108002");
  });

  it("attach refuses an order that is not packed", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "picking_started");
    const result = await h.attach.execute(attachInput(id));
    expect(message(result)).toMatch(/^FULFILLMENT_NOT_ATTACHABLE:/);
  });

  it("attach rejects an empty carrier or tracking number as a validation error", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const noCarrier = await h.attach.execute({ ...attachInput(id), carrier: "" });
    const noTracking = await h.attach.execute({ ...attachInput(id), trackingNumber: "" });
    expect(!noCarrier.ok && noCarrier.error.code).toBe("VALIDATION");
    expect(!noTracking.ok && noTracking.error.code).toBe("VALIDATION");
    expect((await h.order(id)).status.value).toBe("packing_completed");
    expect((await h.order(id)).carrierReference).toBeUndefined();
  });

  it("attach and detach are NOT_FOUND for an unknown order", async () => {
    const h = harness({ confirmed: true });
    const a = await h.attach.execute(attachInput("nope"));
    const d = await h.detach.execute({ tenantId: T, fulfillmentOrderId: "nope" });
    expect(!a.ok && a.error.code).toBe("NOT_FOUND");
    expect(!d.ok && d.error.code).toBe("NOT_FOUND");
  });

  it("detach is a no-op on packing_completed", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const result = await h.detach.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
    expect(h.repo.trail).toEqual([]);
  });

  it("detach from shipment_created also returns to packing", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "shipment_created");
    const result = await h.detach.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
  });

  it("detach is FULFILLMENT_ALREADY_DISPATCHED after pickup", async () => {
    const h = harness({ confirmed: true });
    const id = await h.attachedOrder("order-1");
    await h.mirror.execute({ tenantId: T, fulfillmentOrderId: id, shipmentStatus: "in_transit" });
    const result = await h.detach.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(message(result)).toMatch(/^FULFILLMENT_ALREADY_DISPATCHED:/);
    expect((await h.order(id)).status.value).toBe("in_transit");
  });

  it("detach refuses an order that never reached packing", async () => {
    const h = harness({ confirmed: true });
    const id = await h.createOrder("order-1");
    const result = await h.detach.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(message(result)).toMatch(/^FULFILLMENT_ALREADY_DISPATCHED:/);
  });
});

describe("MirrorShipmentStatus (9a.4, Ruling 24)", () => {
  it.each([
    ["carrier_accepted", "shipment_dispatched"],
    ["in_transit", "in_transit"],
    ["out_for_delivery", "out_for_delivery"],
    ["delivered", "delivered"],
    ["delivery_failed", "delivery_failed"],
    ["returned", "returned"],
  ])("shipment %s -> fulfillment %s from tracking_assigned", async (shipment, expected) => {
    const h = harness({ confirmed: true });
    const id = await h.attachedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: shipment,
    });
    expect(r.ok && r.value.status).toBe(expected);
    expect(r.ok && r.value.changed).toBe(true);
  });

  it("walks intermediate steps and records deliveredAt for delivered", async () => {
    const h = harness({ confirmed: true });
    const id = await h.attachedOrder("order-1");
    await h.statusAfterMirror(id, "delivered");
    expect(h.repo.trail).toEqual([
      "shipment_dispatched",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
    expect((await h.order(id)).deliveredAt).toEqual(clock.now());
  });

  it("is idempotent: mirroring the same status again changes nothing", async () => {
    const h = harness({ confirmed: true });
    const id = await h.attachedOrder("order-1");
    await h.statusAfterMirror(id, "in_transit");
    h.repo.trail = [];
    const again = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "in_transit",
    });
    expect(again.ok && again.value).toMatchObject({ status: "in_transit", changed: false });
    expect(h.repo.trail).toEqual([]);
  });

  it("cancelled returns to packing_completed before pickup only", async () => {
    const h = harness({ confirmed: true });
    const before = await h.attachedOrder("order-1");
    expect(await h.statusAfterMirror(before, "cancelled")).toBe("packing_completed");
    expect((await h.order(before)).trackingNumber).toBeUndefined();
    const after = await h.attachedOrder("order-2");
    await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: after,
      shipmentStatus: "in_transit",
    });
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: after,
      shipmentStatus: "cancelled",
    });
    expect(r.ok && r.value).toMatchObject({ status: "in_transit", changed: false });
  });

  it("cancelled from shipment_created also returns to packing", async () => {
    const h = harness({ confirmed: true });
    const id = await h.seed("order-1", "shipment_created");
    expect(await h.statusAfterMirror(id, "cancelled")).toBe("packing_completed");
  });

  it("is a no-op for statuses it does not mirror", async () => {
    const h = harness({ confirmed: true });
    const id = await h.attachedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "label_created",
    });
    expect(r.ok && r.value).toMatchObject({ status: "tracking_assigned", changed: false });
  });

  it("is ok with changed=false when the target is unreachable (never an error)", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "in_transit",
    });
    expect(r.ok && r.value).toMatchObject({ status: "packing_completed", changed: false });
  });

  it("packing_completed + in_transit with carrier fields attaches then mirrors in one step", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "in_transit",
      carrier: "bosta",
      trackingNumber: "5108002",
      carrierShipmentId: "del-1",
    });
    expect(r.ok && r.value).toMatchObject({ status: "in_transit", changed: true });
    expect((await h.order(id)).trackingNumber?.value).toBe("5108002");
    expect(h.repo.trail).toEqual([
      "shipment_created",
      "tracking_assigned",
      "shipment_dispatched",
      "in_transit",
    ]);
  });

  it("packing_completed + in_transit without the carrier fields is changed=false", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "in_transit",
      trackingNumber: "5108002",
    });
    expect(r.ok && r.value).toMatchObject({ status: "packing_completed", changed: false });
  });

  it("packing_completed + cancelled never attaches", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "cancelled",
      carrier: "bosta",
      trackingNumber: "5108002",
      carrierShipmentId: "del-1",
    });
    expect(r.ok && r.value).toMatchObject({ status: "packing_completed", changed: false });
    expect((await h.order(id)).trackingNumber).toBeUndefined();
  });

  it("a predecessor's tracking number never moves the fulfillment (plan review 1, finding 7)", async () => {
    const h = harness({ confirmed: true });
    const id = await h.packedOrder("order-1");
    must(await h.attach.execute(attachInput(id, "B-1")));
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "cancelled",
      carrier: "bosta",
      trackingNumber: "A-1",
      carrierShipmentId: "del-0",
    });
    expect(r.ok && r.value).toMatchObject({ status: "tracking_assigned", changed: false });
    expect((await h.order(id)).trackingNumber?.value).toBe("B-1");
  });

  it("is NOT_FOUND for an unknown order", async () => {
    const h = harness({ confirmed: true });
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: "nope",
      shipmentStatus: "in_transit",
    });
    expect(!r.ok && r.error.code).toBe("NOT_FOUND");
  });
});
