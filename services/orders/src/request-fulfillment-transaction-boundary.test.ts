import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { Order } from "./domain/order";
import { OrderItem } from "./domain/order-item";
import type { OrderEvent } from "./domain/order-event";
import type { OrderRepository } from "./domain/order-repository";
import { AddressSnapshot } from "./domain/value-objects/address-snapshot";
import { OrderNumber } from "./domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "./domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "./domain/value-objects/product-snapshot";
import {
  RequestFulfillment,
  type RequestFulfillmentDeps,
} from "./application/order-lifecycle.use-cases";
import type { InventoryPort, ShippingPort } from "./application/ports";

/**
 * Phase A.15 (Orders, Task 2/2) — same fake shapes as
 * `request-payment-capture-transaction-boundary.test.ts` (this same task) and
 * `create-intent-transaction-boundary.test.ts` (Payments, Phase A.13): a Postgres-like repository
 * reproducing `PrismaOrderRepository`'s optimistic-lock (`version`) contract, and a
 * `TrackingUnitOfWork` that counts currently-open `run()` calls.
 */
interface OrderRow {
  readonly orderNumber: OrderNumber;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly OrderItem[];
  readonly shippingAddress: AddressSnapshot;
  readonly history: readonly OrderEvent[];
  readonly version: number;
  readonly billingAddress?: AddressSnapshot;
  readonly paymentRef?: string;
  readonly fulfillmentRef?: string;
}

class PostgresLikeOrderRepository implements OrderRepository {
  private readonly rows = new Map<string, OrderRow>();

  async save(order: Order): Promise<void> {
    const id = order.id.toString();
    const existing = this.rows.get(id);
    if (order.version === 0) {
      if (existing !== undefined) {
        throw new Error("fixture setup error: fresh order id collides with an existing row");
      }
      this.write(order, 1);
      return;
    }
    if (existing === undefined || existing.version !== order.version) {
      throw new ConcurrencyError(
        `Order ${id} was modified concurrently (expected version ${order.version})`,
      );
    }
    this.write(order, existing.version + 1);
  }

  async findById(id: string): Promise<Order | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return Order.reconstitute(
      UniqueEntityId.from(id),
      row.orderNumber,
      row.customerRef,
      row.currency,
      row.items,
      row.shippingAddress,
      row.history,
      row.version,
      {
        billingAddress: row.billingAddress,
        paymentRef: row.paymentRef,
        fulfillmentRef: row.fulfillmentRef,
      },
    );
  }

  async list(): ReturnType<OrderRepository["list"]> {
    throw new Error("not used by this test");
  }

  /** Seeds a row directly (bypassing version checks) so tests can start from an arbitrary status. */
  seed(order: Order): void {
    this.write(order, 1);
  }

  size(): number {
    return this.rows.size;
  }

  private write(order: Order, version: number): void {
    this.rows.set(order.id.toString(), {
      orderNumber: order.orderNumber,
      customerRef: order.customerRef,
      currency: order.currency,
      items: [...order.items],
      shippingAddress: order.shippingAddress,
      history: [...order.history],
      version,
      billingAddress: order.billingAddress,
      paymentRef: order.paymentRef,
      fulfillmentRef: order.fulfillmentRef,
    });
  }
}

/** Tracks how many `run()` calls are currently open — a stand-in for "a live DB transaction is held". */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

class RecordingInventoryPort implements InventoryPort {
  readonly calls: Array<{ orderId: string; openCountAtCall: number }> = [];

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failAlways = false,
  ) {}

  async requestReservation(orderId: string): Promise<{ reservationRef: string }> {
    this.calls.push({ orderId, openCountAtCall: this.uow?.openCount ?? -1 });
    if (this.failAlways) {
      throw new Error("simulated Inventory requestReservation failure");
    }
    return { reservationRef: `reservation-${this.calls.length}` };
  }
}

class RecordingShippingPort implements ShippingPort {
  readonly calls: Array<{ orderId: string; openCountAtCall: number }> = [];

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failAlways = false,
  ) {}

  async requestShipment(orderId: string): Promise<{ shipmentRef: string }> {
    this.calls.push({ orderId, openCountAtCall: this.uow?.openCount ?? -1 });
    if (this.failAlways) {
      throw new Error("simulated Shipping requestShipment failure");
    }
    return { shipmentRef: `shipment-${this.calls.length}` };
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function line(): OrderItem {
  const price = Money.create(1000, "USD");
  if (!price.ok) throw new Error("invalid fixture");
  const snapshot = ProductSnapshot.create("p1", "Product 1", price.value);
  if (!snapshot.ok) throw new Error("invalid fixture");
  return OrderItem.create(UniqueEntityId.from("item-p1"), snapshot.value, 1);
}

function address(): AddressSnapshot {
  const result = AddressSnapshot.create("1 Main St", "Town", "12345", "US");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function orderNumber(id: string): OrderNumber {
  const result = OrderNumber.create(`ORD-${id}`);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

/** Builds a fresh order at `ready_for_fulfillment` (the legal precondition for `RequestFulfillment`). */
function orderReadyForFulfillment(id: string): Order {
  const order = Order.createFromCheckout(
    UniqueEntityId.from(id),
    orderNumber(id),
    "customer-1",
    "USD",
    [line()],
    address(),
    address(),
    OrderTotalsSnapshot.create({
      subtotalMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1000,
      currency: "USD",
    }),
    `checkout-${id}`,
    "evt-create",
    new Date(0),
  );
  order.confirm("evt-confirm", new Date(0));
  order.markAwaitingPayment("evt-await", new Date(0));
  order.requestPayment("seed-payment-ref", "evt-payreq", new Date(0));
  order.markPaymentReceived("evt-payrecv", new Date(0));
  order.markReadyForFulfillment("evt-ready", new Date(0));
  order.pullDomainEvents();
  return order;
}

/** Builds an order already at `fulfillment_requested` with a recorded `fulfillmentRef` — the idempotent-resume fixture. */
function orderAlreadyRequested(id: string, fulfillmentRef = "existing-fulfillment-ref"): Order {
  const order = orderReadyForFulfillment(id);
  order.requestFulfillment(fulfillmentRef, "evt-fulreq", new Date(0));
  order.pullDomainEvents();
  return order;
}

function buildDeps(
  orders: OrderRepository,
  inventoryPort: InventoryPort,
  shippingPort: ShippingPort,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): RequestFulfillmentDeps {
  return {
    orders,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    inventoryPort,
    shippingPort,
  };
}

describe("Task 2/2 — InventoryPort/ShippingPort calls no longer run while a DB transaction is open", () => {
  it("FIXED: both requestReservation() and requestShipment() are invoked with openCountAtCall === 0", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-1"));
    const uow = new TrackingUnitOfWork();
    const inventory = new RecordingInventoryPort(uow);
    const shipping = new RecordingShippingPort(uow);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping, uow));

    const result = await useCase.execute({ tenantId: "tenant-a", orderId: "order-1" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("fulfillment_requested");
    expect(inventory.calls).toHaveLength(1);
    expect(shipping.calls).toHaveLength(1);
    // Fixed behavior: the precheck's transaction is committed BEFORE either network call — no
    // transaction is open while either call is in flight.
    expect(inventory.calls[0]?.openCountAtCall).toBe(0);
    expect(shipping.calls[0]?.openCountAtCall).toBe(0);
    // Calls still happen in the same sequential order as before the fix (reservation, then shipment).
    expect(inventory.calls[0]?.orderId).toBe("order-1");
    expect(shipping.calls[0]?.orderId).toBe("order-1");
  });

  it("the fulfillmentRef (reservation|shipment) is durably persisted by the time execute() resolves", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-2"));
    const uow = new TrackingUnitOfWork();
    const inventory = new RecordingInventoryPort(uow);
    const shipping = new RecordingShippingPort(uow);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping, uow));

    await useCase.execute({ tenantId: "tenant-a", orderId: "order-2" });

    const persisted = await repo.findById("order-2");
    expect(persisted?.status).toBe("fulfillment_requested");
    expect(persisted?.fulfillmentRef).toBe("reservation-1|shipment-1");
  });
});

describe("Idempotent resume", () => {
  it("a retry against an order already at fulfillment_requested does NOT re-call either port", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderAlreadyRequested("order-3", "already-requested-ref"));
    const uow = new TrackingUnitOfWork();
    const inventory = new RecordingInventoryPort(uow);
    const shipping = new RecordingShippingPort(uow);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping, uow));

    const result = await useCase.execute({ tenantId: "tenant-a", orderId: "order-3" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("fulfillment_requested");
    expect(inventory.calls).toHaveLength(0);
    expect(shipping.calls).toHaveLength(0);
    const persisted = await repo.findById("order-3");
    expect(persisted?.fulfillmentRef).toBe("already-requested-ref");
  });

  it("a NotFoundError is returned for a missing order, without calling either port", async () => {
    const repo = new PostgresLikeOrderRepository();
    const uow = new TrackingUnitOfWork();
    const inventory = new RecordingInventoryPort(uow);
    const shipping = new RecordingShippingPort(uow);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping, uow));

    const result = await useCase.execute({ tenantId: "tenant-a", orderId: "missing" });

    expect(result.ok).toBe(false);
    expect(inventory.calls).toHaveLength(0);
    expect(shipping.calls).toHaveLength(0);
  });
});

describe("Residual risk #1 — partial failure (second external call throws) leaves the order completely unchanged", () => {
  it("if requestReservation() succeeds but requestShipment() then throws, nothing is persisted (matches pre-fix behavior — documents the orphan-reservation gap, does not fix it)", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-4"));
    const uow = new TrackingUnitOfWork();
    const inventory = new RecordingInventoryPort(uow, false);
    const shipping = new RecordingShippingPort(uow, true);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping, uow));

    await expect(useCase.execute({ tenantId: "tenant-a", orderId: "order-4" })).rejects.toThrow(
      /simulated Shipping requestShipment failure/,
    );

    // The inventory reservation DID happen externally (recorded by the fake port) ...
    expect(inventory.calls).toHaveLength(1);
    // ... but the order carries zero local record of it: no transition, no save, no fulfillmentRef.
    // This is the documented, pre-existing, NOT-fixed-by-this-phase orphan-reservation risk — a
    // caller retry after this failure will call requestReservation() a SECOND time.
    const persisted = await repo.findById("order-4");
    expect(persisted?.status).toBe("ready_for_fulfillment");
    expect(persisted?.fulfillmentRef).toBeUndefined();
  });
});

describe("Task — concurrent fulfillment requests, run repeatedly to rule out flakiness", () => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    it(`run ${attempt}/3: two concurrent execute() calls against the same order both resolve ok, and exactly one fulfillmentRef durably wins`, async () => {
      const repo = new PostgresLikeOrderRepository();
      const orderId = `order-race-${attempt}`;
      repo.seed(orderReadyForFulfillment(orderId));
      const uow = new TrackingUnitOfWork();
      const inventory = new RecordingInventoryPort(uow);
      const shipping = new RecordingShippingPort(uow);
      const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping, uow));

      const [a, b] = await Promise.all([
        useCase.execute({ tenantId: "tenant-a", orderId }),
        useCase.execute({ tenantId: "tenant-a", orderId }),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.value.status).toBe("fulfillment_requested");
        expect(b.value.status).toBe("fulfillment_requested");
      }

      const persisted = await repo.findById(orderId);
      expect(persisted?.status).toBe("fulfillment_requested");
      expect(persisted?.fulfillmentRef).toBeDefined();

      // HONEST documentation of the residual race (see the class doc's "RESIDUAL RISK #2" section):
      // `precheck()` is a plain read with no reservation write, so BOTH racers can observe "no
      // fulfillmentRef yet" before either commits, and BOTH can reach BOTH port calls. This is NOT
      // asserted as prevented. Observed in this codebase/runtime: consistently 2 calls to EACH port
      // (both racers race past the precheck read before either settle() commits) — recorded here,
      // not silently asserted as "safe". Only one of the two resulting fulfillmentRefs is ever
      // durably kept (first settle() to commit wins; the loser's settle() re-reads, finds a
      // fulfillmentRef already present, and no-ops).
      expect(inventory.calls.length).toBe(2);
      expect(shipping.calls.length).toBe(2);
    });
  }
});
