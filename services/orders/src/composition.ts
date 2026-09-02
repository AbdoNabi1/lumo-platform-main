import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { CreateOrderFromCheckout } from "./application/create-order-from-checkout.use-case";
import { GetOrder } from "./application/get-order.use-case";
import { ListOrders } from "./application/list-orders.use-case";
import { MarkOrderPaid } from "./application/mark-order-paid.use-case";
import {
  AdvanceOrder,
  RequestFulfillment,
  RequestPaymentCapture,
} from "./application/order-lifecycle.use-cases";
import { PlaceOrder } from "./application/place-order.use-case";
import { RefundOrder } from "./application/refund-order.use-case";
import type { OrderRepository } from "./domain/order-repository";
import type {
  InventoryPort,
  NotificationPort,
  PaymentPort,
  PaymentVerificationPort,
  ShippingPort,
} from "./application/ports";
import { InMemoryOrderRepository } from "./infrastructure/in-memory-order-repository";
import {
  InMemoryInventoryAdapter,
  InMemoryNotificationAdapter,
  InMemoryPaymentAdapter,
  InMemoryPaymentVerificationAdapter,
  InMemoryShippingAdapter,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  ORDERS_PUBLISHED_EVENTS,
  OrderEventTranslator,
} from "./infrastructure/order-event-translator";
import { PrismaOrderRepository } from "./infrastructure/prisma-order-repository";
import { OrderController } from "./interfaces/order.controller";

export interface OrdersWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Gates the admin backoffice `markOrderPaid` action against Payments (Sprint A1 Task 5).
   * Defaults to `InMemoryPaymentVerificationAdapter` (always verifies — no behavior change for
   * existing callers); production composition (`apps/runtime`) supplies a real, Prisma-backed
   * check.
   */
  readonly paymentVerification?: PaymentVerificationPort;
  /**
   * Stage 5 (audit remediation, C-03 partial): the 4 outbound ports `RequestPaymentCapture`/
   * `RequestFulfillment` call. Same `deps.X ?? new InMemoryXAdapter()` convention as
   * `paymentVerification` above; absent ⇒ the offline in-memory stubs, unchanged from before these
   * fields existed. `apps/runtime/src/api.ts` refuses to boot outside `local` while any of the 4
   * are still unresolved (`assertProductionIntegrationPortsConfigured`) — until Stage 6 wires real
   * adapters, every non-local boot is expected to fail closed here, on purpose.
   */
  readonly paymentPort?: PaymentPort;
  readonly inventoryPort?: InventoryPort;
  readonly shippingPort?: ShippingPort;
  readonly notifications?: NotificationPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaOrderRepository` + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireFinance`/`wireSecurity`); absent ⇒
   * in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Orders table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredOrders {
  readonly orders: OrderController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `OrderController` from an already-wired repo + unit of work — shared by both the in-memory and Prisma branches so the use-case wiring is written exactly once. */
function buildController(
  orders: OrderRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: OrdersWiringDeps,
): OrderController {
  const paymentPort = deps.paymentPort ?? new InMemoryPaymentAdapter();
  const inventoryPort = deps.inventoryPort ?? new InMemoryInventoryAdapter();
  const shippingPort = deps.shippingPort ?? new InMemoryShippingAdapter();
  const notifications = deps.notifications ?? new InMemoryNotificationAdapter();
  const paymentVerification = deps.paymentVerification ?? new InMemoryPaymentVerificationAdapter();

  return new OrderController({
    placeOrder: new PlaceOrder({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    markOrderPaid: new MarkOrderPaid({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      paymentVerification,
    }),
    refundOrder: new RefundOrder({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    createOrderFromCheckout: new CreateOrderFromCheckout({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    advanceOrder: new AdvanceOrder({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      notifications,
    }),
    requestPaymentCapture: new RequestPaymentCapture({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      paymentPort,
      notifications,
    }),
    requestFulfillment: new RequestFulfillment({
      orders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      inventoryPort,
      shippingPort,
      notifications,
    }),
    getOrder: new GetOrder({ orders }),
    listOrders: new ListOrders({ orders }),
  });
}

/**
 * Composition root for the Orders context. Prisma slice (`PrismaOrderRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory, including offline stubs for the 4
 * outbound ports (production swaps these for the Payments/Inventory/Shipping/Notifications
 * adapters, or the ADR-0012 saga's own activities — untouched by this composition change).
 */
export function wireOrders(deps: OrdersWiringDeps): WiredOrders {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireOrders: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new OrderEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "orders",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const orders = new PrismaOrderRepository({ prisma: deps.prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      orders: buildController(orders, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new OrderEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "orders",
  });
  const context = rootEventContext(deps.idGenerator);

  const orders = new InMemoryOrderRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(orders, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of ORDERS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    orders: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
