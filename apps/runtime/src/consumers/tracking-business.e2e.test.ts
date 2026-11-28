import type { Clock } from "@platform/contracts";
import { JsonEventSerializer, type IntegrationEvent } from "@platform/domain-events";
import { DeadLetterPublisher, KafkaConsumerRuntime, type Kafka } from "@platform/kafka";
import {
  InMemoryDeadLetterStore,
  InMemoryOutboxDeliveryQueue,
  InMemoryProcessedEventStore,
  OutboxDeliveryRelay,
} from "@platform/messaging";
import {
  InMemoryDestinationState,
  type EventRecord,
  type EventRecordWriterPort,
  type IngestRuntimeDeps,
  type OrderTrackingReadModel,
  type RecordingRuntimeDeps,
} from "@platform/tracking";
import type { Logger } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";

import { FIXTURE_NOW, toEntry } from "../tracking/testing/captured-event-fixture";
import { OutboxLeadTrackingEmitter } from "../tracking/lead-tracking-emitter";
import { TrackingIngestHandler } from "../tracking/tracking-ingest";
import {
  FULFILLMENT_ORDER_DELIVERED,
  FULFILLMENT_ORDER_RETURNED,
  ORDERS_ORDER_CANCELLED,
  ORDERS_ORDER_CREATED,
  ORDERS_ORDER_PLACED,
  trackingBusinessHandlers,
} from "./tracking-business.consumers";

/**
 * Tracking P2 Task 4 end to end over in-memory ports: an order bus event -> the business consumer -> the outbox
 * (a queue) -> the relay -> the REAL ingest consumer runtime + `TrackingIngestHandler` -> an event record. The cancel
 * guard reads the very records the ingest appended, as the production guard reads `tracking_event_records`.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const TENANT = "shop-1";
const ORDER_ID = "0193a1b2-0000-7000-8000-0000000000aa";
const NOW = FIXTURE_NOW;
const clock: Clock = { now: () => NOW };
const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
const noBroker = new Proxy(
  {},
  {
    get: (_target, property) => {
      throw new Error(`used kafka.${String(property)}`);
    },
  },
) as Kafka;
const noBrokerPublisher = {
  publish: () => Promise.reject(new Error("published to Kafka")),
  publishBatch: () => Promise.reject(new Error("published to Kafka")),
};

const order = (overrides: Partial<OrderTrackingReadModel> = {}): OrderTrackingReadModel => ({
  orderId: ORDER_ID,
  currency: "EGP",
  totals: {
    subtotalMinor: 120_000,
    discountMinor: 20_000,
    taxMinor: 0,
    shippingMinor: 5_000,
    taxIncluded: false,
  },
  lines: [{ productRef: "prod-1", name: "Shirt", unitPriceMinor: 60_000, quantity: 2 }],
  customer: { email: "mona@example.com", phone: "01012345678", name: "Mona Said" },
  placedAt: "2026-11-27T11:00:00.000Z",
  ...overrides,
});

function ingestDeps(records: EventRecordWriterPort): IngestRuntimeDeps {
  const recording: RecordingRuntimeDeps = {
    delivery: {} as RecordingRuntimeDeps["delivery"],
    records,
    hasher: { sha256Hex: () => Promise.resolve("digest") },
    versions: {
      destinationVersion: () => 1,
      mappingVersion: () => 1,
      ruleSet: () => ({ id: "tracking.routing.default", version: 1 }),
    },
    destinationState: new InMemoryDestinationState(),
    clock,
  };
  return {
    recording,
    destinations: {
      resolve: () => null,
      resolveVersion: () => null,
      listActive: () => [{ key: "meta.capi" } as never],
    },
    ruleSets: {
      resolve: () => ({
        id: "tracking.routing.default",
        version: 1,
        mode: "all_matches",
        rules: [],
        onError: "fail_closed",
      }),
      resolveVersion: () => null,
    },
    ruleSetKey: "tracking.routing.default",
    hasher: { sha256Hex: () => Promise.resolve("digest") },
    clock,
  };
}

function stack(
  options: { order?: OrderTrackingReadModel | null; duplicateAppendFails?: boolean } = {},
) {
  const appended: EventRecord[] = [];
  const records: EventRecordWriterPort = {
    append: (record) => {
      if (
        options.duplicateAppendFails === true &&
        appended.some((existing) => existing.eventId === record.eventId)
      ) {
        return Promise.reject(Object.assign(new Error("unique constraint"), { code: "P2002" }));
      }
      appended.push(record);
      return Promise.resolve();
    },
    appendHistory: () => Promise.resolve(),
  };
  const deadLetters = new InMemoryDeadLetterStore();
  const ingest = new TrackingIngestHandler({
    ingest: () => Promise.resolve(ingestDeps(records)),
    deadLetters,
    logger: silentLogger,
    clock,
  });
  const consumer = new KafkaConsumerRuntime({
    kafka: noBroker,
    handler: ingest,
    consumerGroup: "tracking.ingest",
    serializer: new JsonEventSerializer(),
    processedEvents: new InMemoryProcessedEventStore(),
    deadLetters: new DeadLetterPublisher({
      publisher: noBrokerPublisher,
      store: deadLetters,
      clock,
    }),
    retryPublisher: noBrokerPublisher,
    clock,
    logger: silentLogger,
  });
  const queue = new InMemoryOutboxDeliveryQueue();
  const relay = new OutboxDeliveryRelay({
    queue,
    consumers: [consumer],
    clock,
    logger: silentLogger,
    retryDelaysMs: [5_000],
  });

  let rowCounter = 0;
  const publisher = {
    publish: (record: Parameters<typeof toEntry>[0]): Promise<void> => {
      // a fresh outbox row each time the producer runs; the SAME message id (that is the inbox key)
      rowCounter += 1;
      queue.enqueue([
        {
          ...toEntry(record),
          id: `0192f0aa-0000-7000-8000-${String(rowCounter).padStart(12, "0")}`,
        },
      ]);
      return Promise.resolve();
    },
  };
  const handlers = trackingBusinessHandlers({
    reader: { read: () => Promise.resolve(options.order === undefined ? order() : options.order) },
    storeUrls: { storeUrlOf: () => Promise.resolve("https://shop.example/") },
    purchases: {
      hasServerPurchase: (tenantId, orderId) =>
        Promise.resolve(
          appended.some(
            (record) =>
              record.tenantId === tenantId &&
              record.eventName === "purchase" &&
              record.dedupId === `ord_${orderId}` &&
              (record.envelope as { eventOrigin?: string }).eventOrigin === "server",
          ),
        ),
    },
    publisher,
    serializer: new JsonEventSerializer(),
    clock,
    logger: silentLogger,
  });
  const run = async (type: string, event: IntegrationEvent<unknown>): Promise<void> => {
    const entry = handlers.find((h) => h.handler.eventType === type);
    if (entry === undefined) throw new Error(`no handler ${type}`);
    await entry.handler.handle(event);
    await relay.drainOnce();
  };
  return { appended, deadLetters, ingest, queue, relay, run, handlers, publisher };
}

const bus = (
  type: string,
  overrides: Partial<IntegrationEvent<unknown>> = {},
): IntegrationEvent<unknown> => ({
  messageId: `msg-${type}`,
  type,
  eventVersion: 1,
  aggregateId: ORDER_ID,
  aggregateType: "order",
  occurredAt: "2026-11-27T11:30:00.000Z",
  correlationId: "corr",
  causationId: "cause",
  tenantId: TENANT,
  metadata: {},
  payload: { orderRef: ORDER_ID },
  ...overrides,
});

describe("order events -> tracking records through the real ingest consumer", () => {
  it("created and placed for one order record ONE Purchase", async () => {
    const { appended, run } = stack();
    await run(ORDERS_ORDER_CREATED, bus(ORDERS_ORDER_CREATED));
    await run(ORDERS_ORDER_PLACED, bus(ORDERS_ORDER_PLACED));

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      tenantId: TENANT,
      eventName: "purchase",
      dedupId: `ord_${ORDER_ID}`,
    });
  });

  it("redelivery of the same order event is idempotent", async () => {
    const { appended, run } = stack();
    await run(ORDERS_ORDER_CREATED, bus(ORDERS_ORDER_CREATED));
    await run(ORDERS_ORDER_CREATED, bus(ORDERS_ORDER_CREATED));
    expect(appended).toHaveLength(1);
  });

  it("a cancel without a recorded purchase publishes nothing; after the purchase it records cnl_", async () => {
    const { appended, queue, run } = stack();
    await run(ORDERS_ORDER_CANCELLED, bus(ORDERS_ORDER_CANCELLED));
    expect(appended).toEqual([]);
    expect(queue.snapshot()).toEqual([]);

    await run(ORDERS_ORDER_CREATED, bus(ORDERS_ORDER_CREATED));
    await run(ORDERS_ORDER_CANCELLED, bus(ORDERS_ORDER_CANCELLED));
    expect(appended.map((record) => record.dedupId)).toEqual([
      `ord_${ORDER_ID}`,
      `cnl_${ORDER_ID}`,
    ]);
    expect(appended[1]?.eventName).toBe("order_cancelled");
  });

  it("returned after cancelled (or the reverse) collapses into the one cnl_ record", async () => {
    const { appended, run } = stack();
    await run(ORDERS_ORDER_CREATED, bus(ORDERS_ORDER_CREATED));
    await run(ORDERS_ORDER_CANCELLED, bus(ORDERS_ORDER_CANCELLED));
    await run(
      FULFILLMENT_ORDER_RETURNED,
      bus(FULFILLMENT_ORDER_RETURNED, { aggregateId: "ful-1", aggregateType: "fulfillment_order" }),
    );
    expect(appended.filter((record) => record.dedupId === `cnl_${ORDER_ID}`)).toHaveLength(1);
  });

  it("delivered records dlv_ without needing a purchase record", async () => {
    const { appended, run } = stack();
    await run(
      FULFILLMENT_ORDER_DELIVERED,
      bus(FULFILLMENT_ORDER_DELIVERED, {
        aggregateId: "ful-1",
        aggregateType: "fulfillment_order",
      }),
    );
    expect(appended.map((record) => [record.eventName, record.dedupId])).toEqual([
      ["order_delivered", `dlv_${ORDER_ID}`],
    ]);
  });
});

describe("ingest of a business event (P2-D5 and the 7-day window)", () => {
  async function publishedEvent(): Promise<IntegrationEvent<{ envelope: unknown }>> {
    const { queue, handlers } = stack();
    const created = handlers.find((h) => h.handler.eventType === ORDERS_ORDER_CREATED);
    await created?.handler.handle(bus(ORDERS_ORDER_CREATED));
    const entry = queue.snapshot()[0]?.entry;
    if (entry === undefined) throw new Error("nothing published");
    return new JsonEventSerializer().deserialize({
      data: entry.payload,
      contentType: entry.contentType,
      type: "tracking.event.captured",
      eventVersion: 1,
    } as never);
  }

  it("a second append of the same business event (a crash before the ack) is success, not a retry", async () => {
    const event = await publishedEvent();
    const { ingest, appended } = stack({ duplicateAppendFails: true });

    await ingest.handle(event as never);
    await expect(ingest.handle(event as never)).resolves.toBeUndefined();

    expect(appended).toHaveLength(1);
    expect(ingest.counters()).toMatchObject({
      received: 2,
      accepted: 1,
      duplicates: 1,
      deadLettered: 0,
    });
  });

  it("a unique violation on a BROWSER event is not swallowed", async () => {
    const event = await publishedEvent();
    const browser = {
      ...event,
      payload: {
        envelope: {
          ...(event.payload.envelope as object),
          eventOrigin: "browser",
          dedupId: "ord_x",
        },
      },
    };
    const { ingest } = stack({ duplicateAppendFails: true });
    await ingest.handle(browser as never);
    await expect(ingest.handle(browser as never)).rejects.toMatchObject({ code: "P2002" });
  });

  it("an order event older than 7 days by the time it reaches ingest is refused once (acked, dead-lettered), not looped", async () => {
    const event = await publishedEvent();
    const stale = {
      ...event,
      payload: {
        envelope: {
          ...(event.payload.envelope as object),
          timestamp: "2026-11-19T11:00:00.000Z",
          eventTimestampMs: Date.parse("2026-11-19T11:00:00.000Z"),
        },
      },
    };
    const { ingest, appended, deadLetters } = stack();
    await expect(ingest.handle(stale as never)).resolves.toBeUndefined();
    expect(appended).toEqual([]);
    expect(ingest.counters()).toMatchObject({ refused: 1, deadLettered: 1 });
    expect(deadLetters.snapshot()).toHaveLength(1);
  });
});

describe("lead events -> tracking records through the real ingest consumer (P2-D9)", () => {
  const LEAD_ID = "0193a1b2-0000-7000-8000-0000000000ee";
  const lead = {
    tenantId: TENANT,
    leadId: LEAD_ID,
    name: "Mona Said",
    phone: "01012345678",
    phoneE164: "+" + "201012345678",
    email: "mona@example.com",
    sessionId: "session-0001",
    submittedAt: new Date("2026-11-27T11:55:00.000Z"),
    attribution: {
      pageUrl: "https://shop.example/book",
      referrer: null,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      cookies: {},
    },
  };
  const emitterOver = (publisher: { publish: (record: never) => Promise<void> }) =>
    new OutboxLeadTrackingEmitter({
      storeUrls: { storeUrlOf: () => Promise.resolve("https://shop.example/") },
      publisher: publisher as never,
      serializer: new JsonEventSerializer(),
      clock,
    });

  it("a lead becomes one form_submitted record with the lead_ id; sending it again records nothing new", async () => {
    const { appended, relay, publisher } = stack();
    const emitter = emitterOver(publisher as never);
    await emitter.emit(lead);
    await relay.drainOnce();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      tenantId: TENANT,
      eventName: "form_submitted",
      dedupId: `lead_${LEAD_ID}`,
    });
    expect((appended[0]?.envelope as { eventOrigin?: string }).eventOrigin).toBe("server");

    // the request path and a sweeper pass (or a second sweeper) both send the same lead: still one record
    await emitter.emit(lead);
    await relay.drainOnce();
    expect(appended).toHaveLength(1);
  });

  it("an outbox failure at submit time, then the sweeper's send: the lead is recorded once", async () => {
    const { appended, relay, publisher } = stack();
    let down = true;
    const flaky = {
      publish: (record: never): Promise<void> =>
        down ? Promise.reject(new Error("outbox unavailable")) : publisher.publish(record),
    };
    const emitter = emitterOver(flaky);
    await expect(emitter.emit(lead)).rejects.toThrow("outbox unavailable");
    await relay.drainOnce();
    expect(appended).toEqual([]);

    down = false;
    await emitter.emit(lead);
    await relay.drainOnce();
    expect(appended.map((record) => record.dedupId)).toEqual([`lead_${LEAD_ID}`]);
  });

  it("the free-text message is nowhere in the stored record", async () => {
    const { appended, relay, publisher } = stack();
    await emitterOver(publisher as never).emit({ ...lead, message: "my private words" } as never);
    await relay.drainOnce();
    const text = JSON.stringify(appended);
    expect(text).not.toContain("my private words");
  });
});
