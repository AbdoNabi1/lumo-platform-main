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
import { CarrierRegistry, type CarrierRegistration } from "./application/carrier-registry";
import type { CarrierResolver } from "./application/carrier-resolver";
import { CreateShipment } from "./application/create-shipment.use-case";
import type { CarrierCredentialVault } from "./application/ports";
import { ListShippableCountries, QuoteShippingRates } from "./application/quote-shipping.use-cases";
import {
  AddRate,
  CreateZone,
  DeleteRate,
  DeleteZone,
  ListZones,
  UpdateRate,
  UpdateZone,
} from "./application/shipping-zones.use-cases";
import { GetShipmentByFulfillment } from "./application/get-shipment-by-fulfillment.use-case";
import { RecordCarrierWebhook } from "./application/record-carrier-webhook.use-case";
import {
  AdvanceShipment,
  CreateLabel,
  RetryShipment,
  UpdateTracking,
  VoidLabel,
} from "./application/shipment-lifecycle.use-cases";
import type { MerchantCarrierSettingsRepository } from "./domain/merchant-carrier-settings-repository";
import type { ShipmentRepository } from "./domain/shipment-repository";
import type { ShippingZoneRepository } from "./domain/shipping-zone-repository";
import { InMemoryMerchantCarrierSettingsRepository } from "./infrastructure/in-memory-merchant-carrier-settings-repository";
import { InMemoryShipmentRepository } from "./infrastructure/in-memory-shipment-repository";
import { InMemoryShippingZoneRepository } from "./infrastructure/in-memory-shipping-zone-repository";
import {
  InMemoryCarrierProvider,
  InMemoryFulfillmentAdapter,
  InMemoryNotificationAdapter,
  InMemoryProcessedCarrierWebhookStore,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaMerchantCarrierSettingsRepository } from "./infrastructure/prisma-merchant-carrier-settings-repository";
import { PrismaShipmentRepository } from "./infrastructure/prisma-shipment-repository";
import { PrismaShippingZoneRepository } from "./infrastructure/prisma-shipping-zone-repository";
import {
  SHIPPING_PUBLISHED_EVENTS,
  ShippingEventTranslator,
} from "./infrastructure/shipping-event-translator";
import { TenantCarrierResolver } from "./infrastructure/tenant-carrier-resolver";
import { ShippingController } from "./interfaces/shipping.controller";
import { ShippingZonesController } from "./interfaces/shipping-zones.controller";

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
  /**
   * Project 5: the carriers composed at boot (the runtime registers Bosta only when both its KEK
   * and the public admin URL are set, Ruling 31). Absent ⇒ none.
   */
  readonly carrierRegistrations?: readonly CarrierRegistration[];
  /**
   * Seals and opens carrier secrets under the `shipping-credentials` KEK. There is NO stub
   * default: absent means every carrier resolves to `CARRIER_NOT_AVAILABLE`.
   */
  readonly carrierCredentialVault?: CarrierCredentialVault;
}

export interface WiredShipping {
  readonly shipping: ShippingController;
  /** Plan 3C: the shop's shipping zones and rates (Settings → Shipping and delivery). */
  readonly zones: ShippingZonesController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
  /** Project 5: the carriers composed at boot. Declarations and factories only, no tenant. */
  readonly carrierRegistry: CarrierRegistry;
}

/**
 * Project 5: the carrier foundation over an already-wired settings repository. The resolver is a
 * process-wide singleton holding no tenant (ADR-0014); the carrier use cases (Task 4) consume it.
 */
interface CarrierFoundation {
  readonly registry: CarrierRegistry;
  readonly settings: MerchantCarrierSettingsRepository;
  readonly resolver: CarrierResolver;
}

function buildCarrierFoundation(
  settings: MerchantCarrierSettingsRepository,
  deps: ShippingWiringDeps,
): CarrierFoundation {
  const registry = CarrierRegistry.from(deps.carrierRegistrations ?? []);
  const resolver = new TenantCarrierResolver({
    settings,
    registry,
    vault: deps.carrierCredentialVault,
  });
  return { registry, settings, resolver };
}

/** Plan 3C: the zones controller over an already-wired zone repository. */
function buildZonesController(
  zones: ShippingZoneRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ShippingWiringDeps,
): ShippingZonesController {
  const zoneDeps = { zones, unitOfWork, idGenerator: deps.idGenerator };
  return new ShippingZonesController({
    listZones: new ListZones(zoneDeps),
    createZone: new CreateZone(zoneDeps),
    updateZone: new UpdateZone(zoneDeps),
    deleteZone: new DeleteZone(zoneDeps),
    addRate: new AddRate(zoneDeps),
    updateRate: new UpdateRate(zoneDeps),
    deleteRate: new DeleteRate(zoneDeps),
    quoteRates: new QuoteShippingRates({ zones }),
    listShippableCountries: new ListShippableCountries({ zones }),
  });
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
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ShippingEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "shipping",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time (see ShippingWiringDeps) — every
    // repository takes it per call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const shipments = new PrismaShipmentRepository({
      prisma: deps.prisma,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const carriers = buildCarrierFoundation(
      new PrismaMerchantCarrierSettingsRepository(deps.prisma),
      deps,
    );

    return {
      shipping: buildController(shipments, unitOfWork, deps),
      zones: buildZonesController(
        new PrismaShippingZoneRepository({ prisma: deps.prisma }),
        unitOfWork,
        deps,
      ),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
      carrierRegistry: carriers.registry,
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
  const carriers = buildCarrierFoundation(new InMemoryMerchantCarrierSettingsRepository(), deps);

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
    zones: buildZonesController(new InMemoryShippingZoneRepository(), unitOfWork, deps),
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
    carrierRegistry: carriers.registry,
  };
}
