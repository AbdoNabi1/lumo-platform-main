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
import { CreateShipment } from "./application/create-shipment.use-case";
import { GetShipmentByFulfillment } from "./application/get-shipment-by-fulfillment.use-case";
import { RecordCarrierWebhook } from "./application/record-carrier-webhook.use-case";
import {
  AdvanceShipment,
  CreateLabel,
  RetryShipment,
  UpdateTracking,
  VoidLabel,
} from "./application/shipment-lifecycle.use-cases";
import type { ShipmentRepository } from "./domain/shipment-repository";
import { InMemoryShipmentRepository } from "./infrastructure/in-memory-shipment-repository";
import {
  InMemoryCarrierProvider,
  InMemoryFulfillmentAdapter,
  InMemoryNotificationAdapter,
  InMemoryProcessedCarrierWebhookStore,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaShipmentRepository } from "./infrastructure/prisma-shipment-repository";
import {
  SHIPPING_PUBLISHED_EVENTS,
  ShippingEventTranslator,
} from "./infrastructure/shipping-event-translator";
import { ShippingController } from "./interfaces/shipping.controller";

export interface ShippingWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaShipmentRepository` + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wirePayments`); absent ⇒
   * in-memory, unchanged. `carrierProvider`/`fulfillmentPort`/`notifications`/
   * `processedCarrierWebhooks` stay in-memory in both branches — reference-only outbound ports,
   * out of scope for C-01.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Shipping table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredShipping {
  readonly shipping: ShippingController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ShippingController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  shipments: ShipmentRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ShippingWiringDeps,
): ShippingController {
  const fulfillmentPort = new InMemoryFulfillmentAdapter();
  const carrierProvider = new InMemoryCarrierProvider();
  const notifications = new InMemoryNotificationAdapter();
  const processedCarrierWebhooks = new InMemoryProcessedCarrierWebhookStore();

  const lifecycleDeps = {
    shipments,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    fulfillmentPort,
    notifications,
  };

  return new ShippingController({
    createShipment: new CreateShipment({
      shipments,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    advanceShipment: new AdvanceShipment(lifecycleDeps),
    createLabel: new CreateLabel({ ...lifecycleDeps, carrierProvider }),
    voidLabel: new VoidLabel({ ...lifecycleDeps, carrierProvider }),
    updateTracking: new UpdateTracking({ shipments, unitOfWork, clock: deps.clock }),
    retryShipment: new RetryShipment(lifecycleDeps),
    recordCarrierWebhook: new RecordCarrierWebhook({
      shipments,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      processedCarrierWebhooks,
    }),
    getShipmentByFulfillment: new GetShipmentByFulfillment({ shipments }),
  });
}

/**
 * Composition root for the Shipping context. Prisma slice (`PrismaShipmentRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory, including an offline
 * `CarrierProviderPort` stub and the 2 reference-only outbound ports (production swaps these for
 * the real per-tenant carrier adapters + context adapters — untouched by this change).
 */
export function wireShipping(deps: ShippingWiringDeps): WiredShipping {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireShipping: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ShippingEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "shipping",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const shipments = new PrismaShipmentRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      shipping: buildController(shipments, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ShippingEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "shipping",
  });
  const context = rootEventContext(deps.idGenerator);

  const shipments = new InMemoryShipmentRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(shipments, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of SHIPPING_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    shipping: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
