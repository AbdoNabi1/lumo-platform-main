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
import { CreateFulfillment } from "./application/create-fulfillment.use-case";
import { CreateShipment } from "./application/create-shipment.use-case";
import { AdvanceFulfillment } from "./application/fulfillment-lifecycle.use-cases";
import { GetFulfillmentByOrder } from "./application/get-fulfillment-by-order.use-case";
import { RecordCarrierWebhook } from "./application/record-carrier-webhook.use-case";
import { RequestReservation } from "./application/request-reservation.use-case";
import type { FulfillmentOrderRepository } from "./domain/fulfillment-order-repository";
import { InMemoryFulfillmentOrderRepository } from "./infrastructure/in-memory-fulfillment-order-repository";
import {
  InMemoryInventoryAdapter,
  InMemoryNotificationAdapter,
  InMemoryOrdersAdapter,
  InMemoryProcessedCarrierWebhookStore,
  InMemoryShippingProvider,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  FULFILLMENT_PUBLISHED_EVENTS,
  FulfillmentEventTranslator,
} from "./infrastructure/fulfillment-event-translator";
import { PrismaFulfillmentOrderRepository } from "./infrastructure/prisma-fulfillment-order-repository";
import { FulfillmentController } from "./interfaces/fulfillment.controller";

export interface FulfillmentWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaFulfillmentOrderRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireShipping`); absent ⇒ in-memory, unchanged. The 3 reference-only outbound ports stay
   * in-memory in both branches — out of scope for C-01.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Fulfillment table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredFulfillment {
  readonly fulfillment: FulfillmentController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `FulfillmentController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  fulfillmentOrders: FulfillmentOrderRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: FulfillmentWiringDeps,
): FulfillmentController {
  const ordersPort = new InMemoryOrdersAdapter();
  const inventoryPort = new InMemoryInventoryAdapter();
  const shippingProvider = new InMemoryShippingProvider();
  const notifications = new InMemoryNotificationAdapter();
  const processedCarrierWebhooks = new InMemoryProcessedCarrierWebhookStore();

  const lifecycleDeps = {
    fulfillmentOrders,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    ordersPort,
    notifications,
  };

  return new FulfillmentController({
    createFulfillment: new CreateFulfillment({
      fulfillmentOrders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    advanceFulfillment: new AdvanceFulfillment(lifecycleDeps),
    requestReservation: new RequestReservation({ ...lifecycleDeps, inventoryPort }),
    createShipment: new CreateShipment({ ...lifecycleDeps, shippingProvider }),
    recordCarrierWebhook: new RecordCarrierWebhook({
      fulfillmentOrders,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      processedCarrierWebhooks,
    }),
    getFulfillmentByOrder: new GetFulfillmentByOrder({ fulfillmentOrders }),
  });
}

/**
 * Composition root for the Fulfillment context. Prisma slice
 * (`PrismaFulfillmentOrderRepository` + `PrismaUnitOfWork`) when `prisma` is present; else
 * in-memory, including an offline `ShippingProviderPort` stub and the 3 reference-only outbound
 * ports (production swaps these for the real per-tenant carrier adapters + context adapters —
 * untouched by this change).
 */
export function wireFulfillment(deps: FulfillmentWiringDeps): WiredFulfillment {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireFulfillment: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new FulfillmentEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "fulfillment",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const fulfillmentOrders = new PrismaFulfillmentOrderRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      fulfillment: buildController(fulfillmentOrders, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new FulfillmentEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "fulfillment",
  });
  const context = rootEventContext(deps.idGenerator);

  const fulfillmentOrders = new InMemoryFulfillmentOrderRepository({
    outbox: outboxWriter,
    context,
  });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(fulfillmentOrders, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of FULFILLMENT_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    fulfillment: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
