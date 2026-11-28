/**
 * Order consumers of the tracking revenue path (Tracking P2 Task 4, decisions P2-D3, D5, D6).
 *
 * Five bus events become three business tracking events:
 *
 * | bus event                       | tracking event   | dedup id        |
 * |---------------------------------|------------------|-----------------|
 * | `orders.order.created`          | purchase         | `ord_<orderId>` |
 * | `orders.order.placed`           | purchase         | `ord_<orderId>` |
 * | `fulfillment.order.delivered`   | order_delivered  | `dlv_<orderId>` |
 * | `orders.order.cancelled`        | order_cancelled  | `cnl_<orderId>` |
 * | `fulfillment.order.returned`    | order_cancelled  | `cnl_<orderId>` |
 *
 * A checkout order raises `created`, a legacy admin order raises `placed`, and both map to the SAME business id, so an
 * order that somehow raises both is one Purchase. A return to sender (a COD parcel refused at the door) is a lost
 * sale exactly like a cancellation, so both map to one `cnl_` id.
 *
 * What a consumer does with one message:
 *
 * 1. the tenant is the ENVELOPE's (`readEnvelopeTenant`, G-64) — never defaulted; a message without one is refused
 *    loudly and nothing is read or published;
 * 2. the order is read once (`OrderTrackingReader`, tenant-scoped); an order that is not visible yet THROWS so the
 *    consumer runtime retries it, and after the retry schedule the message is dead-lettered like any other;
 * 3. a cancel is sent only if a SERVER-origin Purchase record exists for the order (`ServerPurchaseRecords`): there is
 *    no orphan refund for a sale that was never reported, and a browser's claim of `ord_<id>` is not a purchase;
 * 4. the mapper builds the envelope (`purchaseEnvelope` / `deliveredEnvelope` / `cancelledEnvelope`); one older than
 *    the 7-day business window can never validate, so it is acknowledged and counted, never retried;
 * 5. the envelope is published as `tracking.event.captured.v1` through the Postgres outbox publisher with
 *    `messageId = envelope.eventId` (a UUID derived from tenant + business id) and `skipDuplicates`, so a redelivery
 *    appends nothing new. Ingest then runs it exactly like any other tracking event.
 *
 * Publishing is idempotent by construction, so none of these consumers needs the atomic (unit-of-work) path.
 */

import { PrismaOutboxEventPublisher } from "@platform/db";
import {
  readEnvelopeTenant,
  topicFor,
  type EventSerializer,
  type IntegrationEvent,
} from "@platform/domain-events";
import {
  KafkaMessageProducer,
  type MessagingMetrics,
  type SupervisedConsumer,
} from "@platform/kafka";
import type { EventHandler, EventPublisher } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import {
  cancelledEnvelope,
  deliveredEnvelope,
  MAX_BUSINESS_EVENT_AGE_MS,
  purchaseEnvelope,
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  type OrderTrackingReadModel,
  type TrackingCapturedEventPayload,
  type TrackingEnvelope,
} from "@platform/tracking";

import type { RuntimeCore } from "../composition";
import { buildProcessedConsumer } from "../security/consumer-runtime";
import {
  PrismaOrderTrackingReader,
  type OrderTrackingReader,
} from "../tracking/prisma-order-tracking-reader";
import {
  PrismaServerPurchaseRecords,
  type ServerPurchaseRecords,
} from "../tracking/prisma-server-purchase-records";
import {
  PrismaStoreUrlResolver,
  type StoreUrlResolver,
} from "../tracking/prisma-store-url-resolver";

export const ORDERS_ORDER_CREATED = "orders.order.created";
export const ORDERS_ORDER_PLACED = "orders.order.placed";
export const ORDERS_ORDER_CANCELLED = "orders.order.cancelled";
export const FULFILLMENT_ORDER_DELIVERED = "fulfillment.order.delivered";
export const FULFILLMENT_ORDER_RETURNED = "fulfillment.order.returned";

/** The producer name stamped on the published tracking events. */
const PRODUCER = "tracking-business";

type BusinessKind = "purchase" | "delivered" | "cancelled";

export interface TrackingBusinessCounters {
  readonly received: number;
  /** Envelopes handed to the outbox (a redelivery counts again; the outbox row is the same). */
  readonly published: number;
  /** Cancels dropped because no server-origin Purchase record exists for the order. */
  readonly skippedNoPurchase: number;
  /** Events older than the 7-day business window: acknowledged, never published. */
  readonly expired: number;
  /** Messages that can never become an event (no tenant, no order id, a malformed read model). */
  readonly refused: number;
}

export interface TrackingBusinessDeps {
  readonly reader: OrderTrackingReader;
  readonly storeUrls: StoreUrlResolver;
  readonly purchases: ServerPurchaseRecords;
  /** The Postgres outbox publisher (P2-D6): idempotent on the record's `messageId`. */
  readonly publisher: Pick<EventPublisher, "publish">;
  readonly serializer: EventSerializer;
  readonly clock: { now(): Date };
  readonly logger: Logger;
}

interface Spec {
  readonly eventType: string;
  readonly kind: BusinessKind;
  /** `orders.order.*` carry the order id as the aggregate id; `fulfillment.order.*` carry it as `payload.orderRef`. */
  readonly orderIdOf: (event: IntegrationEvent<unknown>) => string | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The order is not (yet) readable: thrown so the consumer runtime retries, then dead-letters. */
export class OrderNotVisibleError extends Error {
  constructor(orderId: string) {
    super(`tracking business: order ${orderId} is not visible yet`);
    this.name = "OrderNotVisibleError";
  }
}

/** No address names the store: thrown so the event is retried instead of sent without a source url. */
export class StoreUrlUnavailableError extends Error {
  constructor() {
    super("tracking business: no domain or storefront url names the store");
    this.name = "StoreUrlUnavailableError";
  }
}

export class TrackingBusinessConsumer implements EventHandler<unknown> {
  readonly eventType: string;
  readonly eventVersion = 1;

  private received = 0;
  private published = 0;
  private skippedNoPurchase = 0;
  private expired = 0;
  private refused = 0;

  constructor(
    private readonly spec: Spec,
    private readonly deps: TrackingBusinessDeps,
  ) {
    this.eventType = spec.eventType;
  }

  counters(): TrackingBusinessCounters {
    return {
      received: this.received,
      published: this.published,
      skippedNoPurchase: this.skippedNoPurchase,
      expired: this.expired,
      refused: this.refused,
    };
  }

  async handle(event: IntegrationEvent<unknown>): Promise<void> {
    this.received += 1;
    const { logger } = this.deps;

    // G-64: the tenant is the envelope's. Publishing ADDS a tracking event, so a message with no tenant is refused
    // (nothing read, nothing published, an error logged) rather than filed under a guess.
    const tenantId = readEnvelopeTenant(event);
    if (tenantId === null) {
      this.refused += 1;
      logger.error("tracking business: event has no tenant on the envelope — refused", {
        type: this.eventType,
        messageId: event.messageId,
      });
      return;
    }
    const orderId = this.spec.orderIdOf(event);
    if (orderId === null) {
      this.refused += 1;
      logger.error("tracking business: event names no order — refused", {
        type: this.eventType,
        messageId: event.messageId,
      });
      return;
    }

    const order = await this.deps.reader.read(tenantId, orderId);
    if (order === null) throw new OrderNotVisibleError(orderId);

    if (this.spec.kind === "cancelled") {
      const bought = await this.deps.purchases.hasServerPurchase(tenantId, order.orderId);
      if (!bought) {
        this.skippedNoPurchase += 1;
        logger.info("tracking business: cancel skipped, no server purchase was recorded", {
          type: this.eventType,
          tenantId,
          orderId,
        });
        return;
      }
    }

    const storeUrl = (await this.deps.storeUrls.storeUrlOf(tenantId)) ?? order.snapshot?.pageUrl;
    if (storeUrl === undefined || storeUrl === "") throw new StoreUrlUnavailableError();

    let envelope: TrackingEnvelope;
    try {
      envelope = this.envelopeFor(order, tenantId, storeUrl, event.occurredAt);
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      // A malformed order id or instant is bad forever: retrying only delays the dead letter nobody can act on.
      this.refused += 1;
      logger.error("tracking business: the order cannot be mapped — refused", {
        type: this.eventType,
        messageId: event.messageId,
        reason: cause.message,
      });
      return;
    }

    const age = this.deps.clock.now().getTime() - Date.parse(envelope.timestamp);
    if (age > MAX_BUSINESS_EVENT_AGE_MS) {
      this.expired += 1;
      logger.warn("tracking business: event is older than the 7-day window, not published", {
        type: this.eventType,
        tenantId,
        orderId,
      });
      return;
    }

    await this.publish(event, tenantId, envelope);
    this.published += 1;
  }

  private envelopeFor(
    order: OrderTrackingReadModel,
    tenantId: string,
    storeUrl: string,
    occurredAt: string,
  ): TrackingEnvelope {
    switch (this.spec.kind) {
      case "purchase":
        return purchaseEnvelope(order, { tenantId, storeUrl, currency: order.currency });
      case "delivered":
        return deliveredEnvelope(order, {
          tenantId,
          storeUrl,
          currency: order.currency,
          occurredAt,
        });
      case "cancelled":
        return cancelledEnvelope(order, {
          tenantId,
          storeUrl,
          currency: order.currency,
          occurredAt,
        });
    }
  }

  private async publish(
    source: IntegrationEvent<unknown>,
    tenantId: string,
    envelope: TrackingEnvelope,
  ): Promise<void> {
    // The envelope's own id is already the UUID derived from the tenant and the business id (P2-D5): the outbox row id
    // and the consumer inbox key. The same order event twice is the same row.
    const messageId = envelope.eventId;
    const payload: TrackingCapturedEventPayload = { envelope };
    const serialized = this.deps.serializer.serialize({
      messageId,
      type: TRACKING_CAPTURED_TOPIC,
      eventVersion: TRACKING_CAPTURED_VERSION,
      aggregateId: envelope.eventId,
      aggregateType: "tracking_event",
      occurredAt: envelope.timestamp,
      correlationId: source.correlationId,
      causationId: source.messageId,
      tenantId,
      producer: PRODUCER,
      payload,
      metadata: {},
    });
    await this.deps.publisher.publish({
      topic: topicFor(TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION),
      // Partitioned by tenant, like every tracking event.
      key: tenantId,
      value: serialized.data,
      headers: {
        messageId,
        type: TRACKING_CAPTURED_TOPIC,
        eventVersion: String(TRACKING_CAPTURED_VERSION),
        contentType: serialized.contentType,
        "content-type": serialized.contentType,
        correlationId: source.correlationId,
        causationId: source.messageId,
        tenantId,
        producer: PRODUCER,
      },
    });
  }
}

const byAggregate = (event: IntegrationEvent<unknown>): string | null =>
  nonEmpty(event.aggregateId);

const byOrderRef = (event: IntegrationEvent<unknown>): string | null => {
  const payload = event.payload;
  return typeof payload === "object" && payload !== null
    ? nonEmpty((payload as { orderRef?: unknown }).orderRef)
    : null;
};

/** The five handlers, one per bus event (a consumer runtime serves one topic). */
export function trackingBusinessHandlers(deps: TrackingBusinessDeps): readonly {
  readonly consumerGroup: string;
  readonly handler: TrackingBusinessConsumer;
}[] {
  const make = (consumerGroup: string, spec: Spec) => ({
    consumerGroup,
    handler: new TrackingBusinessConsumer(spec, deps),
  });
  return [
    make("tracking.business.order-created", {
      eventType: ORDERS_ORDER_CREATED,
      kind: "purchase",
      orderIdOf: byAggregate,
    }),
    make("tracking.business.order-placed", {
      eventType: ORDERS_ORDER_PLACED,
      kind: "purchase",
      orderIdOf: byAggregate,
    }),
    make("tracking.business.order-cancelled", {
      eventType: ORDERS_ORDER_CANCELLED,
      kind: "cancelled",
      orderIdOf: byAggregate,
    }),
    make("tracking.business.fulfillment-returned", {
      eventType: FULFILLMENT_ORDER_RETURNED,
      kind: "cancelled",
      orderIdOf: byOrderRef,
    }),
    make("tracking.business.fulfillment-delivered", {
      eventType: FULFILLMENT_ORDER_DELIVERED,
      kind: "delivered",
      orderIdOf: byOrderRef,
    }),
  ];
}

/**
 * The five consumer runtimes (inbox idempotency, retry topics, dead letters) over one shared producer, wired to the
 * production adapters. Returns none when `TRACKING_INGEST_ENABLED` is off: with ingest off nothing consumes
 * `tracking.event.captured.v1`, so publishing to it would only fill the outbox.
 */
export function buildTrackingBusinessConsumerRuntimes(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): readonly SupervisedConsumer[] {
  if (!core.config.TRACKING_INGEST_ENABLED) return [];
  const producer = new KafkaMessageProducer(core.kafka);
  const deps: TrackingBusinessDeps = {
    reader: new PrismaOrderTrackingReader(core.prisma),
    storeUrls: new PrismaStoreUrlResolver({
      db: core.prisma,
      platformTenantId: core.platformTenantId,
      ...(core.config.STOREFRONT_PUBLIC_URL === undefined
        ? {}
        : { fallbackUrl: core.config.STOREFRONT_PUBLIC_URL }),
      clock: core.clock,
    }),
    purchases: new PrismaServerPurchaseRecords(core.prisma),
    // P2-D6: one execution path through ingest. The outbox is the transport under both EVENT_TRANSPORT values (the
    // relay forwards it to Kafka under `kafka`, hands it to the consumers directly under `postgres`).
    publisher: new PrismaOutboxEventPublisher(core.prisma, () => core.clock.now()),
    serializer: core.serializer,
    clock: core.clock,
    logger: core.logger,
  };
  return trackingBusinessHandlers(deps).map(({ consumerGroup, handler }) =>
    buildProcessedConsumer(core, handler, consumerGroup, producer, metrics),
  );
}
