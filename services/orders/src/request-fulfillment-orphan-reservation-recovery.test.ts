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
import type {
  InventoryPort,
  InventoryReservationResult,
  ShipmentResult,
  ShippingPort,
} from "./application/ports";

/**
 * Phase A.16 (Task 4/5/6) — closes the A.15 §20/§24 "orphan-reservation" risk: if
 * `requestReservation()` succeeds but `requestShipment()` then throws, `Order` persists nothing
 * (no intermediate status exists to record a half-completed attempt), so a caller retry used to
 * call `requestReservation()` again, creating a SECOND, orphaned reservation. The fix (see
 * `order-lifecycle.use-cases.ts`'s `RequestFulfillment` class doc "RESIDUAL RISK #1") reuses
 * `orderId` — already the parameter both ports receive — as a natural idempotency key: a retried
 * `requestReservation(orderId)`/`requestShipment(orderId)` call must return the SAME ref, not a new
 * one (documented contract, `ports.ts`). This suite's `IdempotentInventoryPort`/
 * `IdempotentShippingPort` fakes are the SAME reference shape as the real
 * `InMemoryInventoryAdapter`/`InMemoryShippingAdapter` (`in-memory-port-adapters.ts`), proving the
 * contract actually closes each of Task 4's required scenarios.
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

class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

/** Reference-shape fake matching `InMemoryInventoryAdapter`'s Phase A.16 orderId-keyed idempotency contract. */
class IdempotentInventoryPort implements InventoryPort {
  readonly calls: Array<{ orderId: string; result: InventoryReservationResult }> = [];
  private readonly byOrderId = new Map<string, InventoryReservationResult>();
  private counter = 0;
  constructor(private readonly failAlways = false) {}

  async requestReservation(orderId: string): Promise<InventoryReservationResult> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (this.failAlways) throw new Error("simulated Inventory requestReservation failure");
    const existing = this.byOrderId.get(orderId);
    const result = existing ?? { reservationRef: `reservation-${orderId}-${(this.counter += 1)}` };
    if (existing === undefined) this.byOrderId.set(orderId, result);
    this.calls.push({ orderId, result });
    return result;
  }
}

/** Reference-shape fake matching `InMemoryShippingAdapter`'s Phase A.16 orderId-keyed idempotency contract. */
class IdempotentShippingPort implements ShippingPort {
  readonly calls: Array<{ orderId: string; result: ShipmentResult }> = [];
  private readonly byOrderId = new Map<string, ShipmentResult>();
  private counter = 0;
  constructor(private readonly failAlways = false) {}

  async requestShipment(orderId: string): Promise<ShipmentResult> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (this.failAlways) throw new Error("simulated Shipping requestShipment failure");
    const existing = this.byOrderId.get(orderId);
    const result = existing ?? { shipmentRef: `shipment-${orderId}-${(this.counter += 1)}` };
    if (existing === undefined) this.byOrderId.set(orderId, result);
    this.calls.push({ orderId, result });
    return result;
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

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

function buildDeps(
  orders: OrderRepository,
  inventoryPort: InventoryPort,
  shippingPort: ShippingPort,
): RequestFulfillmentDeps {
  return {
    orders,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("evt"),
    clock,
    inventoryPort,
    shippingPort,
  };
}

describe("Task 4 Scenario 1 — successful fulfillment", () => {
  it("one reservation, one shipment, fulfillmentRef durably persisted", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-happy"));
    const inventory = new IdempotentInventoryPort();
    const shipping = new IdempotentShippingPort();
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping));

    const result = await useCase.execute({ tenantId: "tenant-a", orderId: "order-happy" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("fulfillment_requested");
    expect(inventory.calls).toHaveLength(1);
    expect(shipping.calls).toHaveLength(1);
    const persisted = await repo.findById("order-happy");
    expect(persisted?.fulfillmentRef).toBeDefined();
  });
});

describe("Task 4 Scenario 2 — external call failure (shipment throws after reservation succeeds)", () => {
  it("the order is left completely unchanged; the reservation happened externally with zero local record", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-extfail"));
    const inventory = new IdempotentInventoryPort();
    const shipping = new IdempotentShippingPort(true);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping));

    await expect(
      useCase.execute({ tenantId: "tenant-a", orderId: "order-extfail" }),
    ).rejects.toThrow(/simulated Shipping requestShipment failure/);

    expect(inventory.calls).toHaveLength(1);
    const persisted = await repo.findById("order-extfail");
    expect(persisted?.status).toBe("ready_for_fulfillment");
    expect(persisted?.fulfillmentRef).toBeUndefined();
  });
});

describe("Task 4 Scenario 3 — local persistence failure (both external calls succeed, settle()'s save() throws)", () => {
  it("state is recoverable, not corrupted; a retry reuses the SAME refs, not duplicates", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-persistfail"));
    const inventory = new IdempotentInventoryPort();
    const shipping = new IdempotentShippingPort();

    let saveAttempts = 0;
    const flakyOrders: OrderRepository = {
      findById: (id) => repo.findById(id),
      list: () => repo.list(),
      save: async (order) => {
        saveAttempts += 1;
        if (saveAttempts === 1) throw new Error("simulated transient DB failure during settle");
        return repo.save(order);
      },
    };
    const useCase = new RequestFulfillment(buildDeps(flakyOrders, inventory, shipping));

    await expect(
      useCase.execute({ tenantId: "tenant-a", orderId: "order-persistfail" }),
    ).rejects.toThrow(/simulated transient DB failure/);
    expect(inventory.calls).toHaveLength(1);
    expect(shipping.calls).toHaveLength(1);
    const afterFail = await repo.findById("order-persistfail");
    expect(afterFail?.status).toBe("ready_for_fulfillment"); // unsettled, not corrupted

    // Retry against the now-working repository — both port calls happen again...
    const retryUseCase = new RequestFulfillment(buildDeps(repo, inventory, shipping));
    const retried = await retryUseCase.execute({
      tenantId: "tenant-a",
      orderId: "order-persistfail",
    });

    expect(retried.ok).toBe(true);
    expect(inventory.calls).toHaveLength(2);
    expect(shipping.calls).toHaveLength(2);
    // ...but reuse the SAME refs (idempotent), not a second reservation/shipment.
    expect(new Set(inventory.calls.map((c) => c.result.reservationRef)).size).toBe(1);
    expect(new Set(shipping.calls.map((c) => c.result.shipmentRef)).size).toBe(1);
    const final = await repo.findById("order-persistfail");
    expect(final?.status).toBe("fulfillment_requested");
  });
});

describe("Task 4 Scenario 4 — process failure after reservation, then retry", () => {
  it("retry after the crash reuses the SAME reservationRef (not orphaned) and completes fulfillment", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-crash"));
    const inventory = new IdempotentInventoryPort();
    const crashingShipping = new IdempotentShippingPort(true);
    const useCase = new RequestFulfillment(buildDeps(repo, inventory, crashingShipping));

    await expect(useCase.execute({ tenantId: "tenant-a", orderId: "order-crash" })).rejects.toThrow(
      /simulated Shipping requestShipment failure/,
    );
    const afterCrash = await repo.findById("order-crash");
    expect(afterCrash?.status).toBe("ready_for_fulfillment");
    const firstReservationRef = inventory.calls[0]?.result.reservationRef;
    expect(firstReservationRef).toBeDefined();

    const workingShipping = new IdempotentShippingPort();
    const retryUseCase = new RequestFulfillment(buildDeps(repo, inventory, workingShipping));
    const retried = await retryUseCase.execute({ tenantId: "tenant-a", orderId: "order-crash" });

    expect(retried.ok).toBe(true);
    expect(inventory.calls).toHaveLength(2);
    expect(inventory.calls[1]?.result.reservationRef).toBe(firstReservationRef);
    const final = await repo.findById("order-crash");
    expect(final?.status).toBe("fulfillment_requested");
    expect(final?.fulfillmentRef).toContain(firstReservationRef ?? "");
  });
});

describe("Task 4 Scenario 5 — retry after partial failure, repeated multiple times", () => {
  it("two consecutive shipment failures then a successful third attempt: exactly ONE reservation ever created", async () => {
    const repo = new PostgresLikeOrderRepository();
    repo.seed(orderReadyForFulfillment("order-multi-retry"));
    const inventory = new IdempotentInventoryPort();

    for (let i = 0; i < 2; i += 1) {
      const failingShipping = new IdempotentShippingPort(true);
      const useCase = new RequestFulfillment(buildDeps(repo, inventory, failingShipping));
      await expect(
        useCase.execute({ tenantId: "tenant-a", orderId: "order-multi-retry" }),
      ).rejects.toThrow();
    }

    const workingShipping = new IdempotentShippingPort();
    const finalUseCase = new RequestFulfillment(buildDeps(repo, inventory, workingShipping));
    const result = await finalUseCase.execute({
      tenantId: "tenant-a",
      orderId: "order-multi-retry",
    });

    expect(result.ok).toBe(true);
    expect(inventory.calls).toHaveLength(3);
    const uniqueRefs = new Set(inventory.calls.map((c) => c.result.reservationRef));
    expect(uniqueRefs.size).toBe(1);
    const final = await repo.findById("order-multi-retry");
    expect(final?.status).toBe("fulfillment_requested");
  });
});

describe("Task 4 Scenario 6 / Task 6 — concurrent duplicate RequestFulfillment(A) requests", () => {
  for (let run = 1; run <= 3; run += 1) {
    it(`run ${run}/3: no duplicate reservation, no duplicate shipment, no leaked reservation, deterministic final state, no lost update`, async () => {
      const repo = new PostgresLikeOrderRepository();
      const orderId = `order-conc-${run}`;
      repo.seed(orderReadyForFulfillment(orderId));
      const inventory = new IdempotentInventoryPort();
      const shipping = new IdempotentShippingPort();
      const useCase = new RequestFulfillment(buildDeps(repo, inventory, shipping));

      const [a, b] = await Promise.all([
        useCase.execute({ tenantId: "tenant-a", orderId }),
        useCase.execute({ tenantId: "tenant-a", orderId }),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);

      // Both racers DID reach both ports — precheck is still a plain read (documented, pre-existing
      // Residual Risk #2, unchanged by this phase) — but thanks to orderId-keyed idempotency, no
      // DUPLICATE reservation/shipment was ever created.
      expect(inventory.calls.length).toBe(2);
      expect(shipping.calls.length).toBe(2);
      expect(new Set(inventory.calls.map((c) => c.result.reservationRef)).size).toBe(1);
      expect(new Set(shipping.calls.map((c) => c.result.shipmentRef)).size).toBe(1);

      const final = await repo.findById(orderId);
      expect(final?.status).toBe("fulfillment_requested");
      expect(final?.fulfillmentRef).toBeDefined();
      expect(repo.size()).toBe(1); // one row — no lost update, no corruption
    });
  }
});
