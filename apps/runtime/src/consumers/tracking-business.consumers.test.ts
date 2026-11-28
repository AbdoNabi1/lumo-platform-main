import type { IntegrationEvent } from "@platform/domain-events";
import { JsonEventSerializer } from "@platform/domain-events";
import type { PublishRecord } from "@platform/messaging";
import type { OrderTrackingReadModel, TrackingEnvelope } from "@platform/tracking";
import type { Logger } from "@platform/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FULFILLMENT_ORDER_DELIVERED,
  FULFILLMENT_ORDER_RETURNED,
  ORDERS_ORDER_CANCELLED,
  ORDERS_ORDER_CREATED,
  ORDERS_ORDER_PLACED,
  OrderNotVisibleError,
  StoreUrlUnavailableError,
  trackingBusinessHandlers,
  type TrackingBusinessConsumer,
  type TrackingBusinessDeps,
} from "./tracking-business.consumers";

beforeEach(() => {
  expect.hasAssertions();
});

const TENANT = "tenant-1";
const ORDER_ID = "0193a1b2-0000-7000-8000-0000000000aa";
const NOW = new Date("2026-11-28T12:00:00.000Z");
const PLACED_AT = "2026-11-28T11:00:00.000Z";
const STORE_URL = "https://shop.example/";

const silentLogger = (): Logger => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger as unknown as Logger;
};

function order(overrides: Partial<OrderTrackingReadModel> = {}): OrderTrackingReadModel {
  return {
    orderId: ORDER_ID,
    orderNumber: "ORD-1001",
    currency: "EGP",
    totals: {
      subtotalMinor: 120_000,
      discountMinor: 20_000,
      taxMinor: 0,
      shippingMinor: 5_000,
      taxIncluded: false,
    },
    lines: [
      {
        productRef: "prod-1",
        variantRef: "var-1",
        name: "Shirt",
        unitPriceMinor: 60_000,
        quantity: 2,
      },
    ],
    customer: { email: "mona@example.com", phone: "01012345678", name: "Mona Said" },
    placedAt: PLACED_AT,
    ...overrides,
  };
}

function busEvent(
  type: string,
  overrides: Partial<IntegrationEvent<unknown>> = {},
): IntegrationEvent<unknown> {
  return {
    messageId: "msg-1",
    type,
    eventVersion: 1,
    aggregateId: ORDER_ID,
    aggregateType: "order",
    occurredAt: "2026-11-28T11:30:00.000Z",
    correlationId: "corr-1",
    causationId: "cause-1",
    tenantId: TENANT,
    metadata: {},
    payload: { orderNumber: "ORD-1001", customerRef: "c-1", fromStatus: "x", toStatus: "y" },
    ...overrides,
  };
}

const fulfillmentEvent = (type: string, orderRef: string = ORDER_ID): IntegrationEvent<unknown> =>
  busEvent(type, {
    aggregateId: "fulfillment-77",
    aggregateType: "fulfillment_order",
    payload: { orderRef, fromStatus: "out_for_delivery", toStatus: "delivered" },
  });

function harness(
  options: {
    order?: OrderTrackingReadModel | null;
    hasPurchase?: boolean;
    storeUrl?: string | null;
    publishError?: Error;
  } = {},
) {
  const published: PublishRecord[] = [];
  const reads: { tenantId: string; orderId: string }[] = [];
  const guardCalls: { tenantId: string; orderId: string }[] = [];
  const logger = silentLogger();
  const deps: TrackingBusinessDeps = {
    reader: {
      read: (tenantId, orderId) => {
        reads.push({ tenantId, orderId });
        return Promise.resolve(options.order === undefined ? order() : options.order);
      },
    },
    storeUrls: {
      storeUrlOf: () =>
        Promise.resolve(options.storeUrl === undefined ? STORE_URL : options.storeUrl),
    },
    purchases: {
      hasServerPurchase: (tenantId, orderId) => {
        guardCalls.push({ tenantId, orderId });
        return Promise.resolve(options.hasPurchase ?? true);
      },
    },
    publisher: {
      publish: (record) => {
        if (options.publishError !== undefined) return Promise.reject(options.publishError);
        published.push(record);
        return Promise.resolve();
      },
    },
    serializer: new JsonEventSerializer(),
    clock: { now: () => NOW },
    logger,
  };
  const handlers = trackingBusinessHandlers(deps);
  const handlerFor = (type: string): TrackingBusinessConsumer => {
    const found = handlers.find((entry) => entry.handler.eventType === type);
    if (found === undefined) throw new Error(`no handler for ${type}`);
    return found.handler;
  };
  return { handlerFor, handlers, published, reads, guardCalls, logger };
}

const envelopeOf = (record: PublishRecord | undefined): TrackingEnvelope => {
  if (record === undefined) throw new Error("nothing was published");
  const wire = JSON.parse(new TextDecoder().decode(record.value)) as {
    payload: { envelope: TrackingEnvelope };
  };
  return wire.payload.envelope;
};

describe("registration", () => {
  it("one consumer per bus event, each in its own group, all at version 1", () => {
    const { handlers } = harness();
    expect(handlers.map((entry) => [entry.consumerGroup, entry.handler.eventType])).toEqual([
      ["tracking.business.order-created", ORDERS_ORDER_CREATED],
      ["tracking.business.order-placed", ORDERS_ORDER_PLACED],
      ["tracking.business.order-cancelled", ORDERS_ORDER_CANCELLED],
      ["tracking.business.fulfillment-returned", FULFILLMENT_ORDER_RETURNED],
      ["tracking.business.fulfillment-delivered", FULFILLMENT_ORDER_DELIVERED],
    ]);
    expect(handlers.every((entry) => entry.handler.eventVersion === 1)).toBe(true);
  });
});

describe("purchase (orders.order.created / orders.order.placed)", () => {
  it("publishes one tracking.event.captured.v1 with the derived UUID as the outbox message id", async () => {
    const { handlerFor, published, reads } = harness();
    await handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED));

    expect(reads).toEqual([{ tenantId: TENANT, orderId: ORDER_ID }]);
    expect(published).toHaveLength(1);
    const record = published[0] as PublishRecord;
    const envelope = envelopeOf(record);
    expect(record.topic).toBe("tracking.event.captured.v1");
    expect(record.key).toBe(TENANT);
    expect(record.headers["tenantId"]).toBe(TENANT);
    expect(record.headers["messageId"]).toBe(envelope.eventId);
    expect(record.headers["messageId"]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(record.headers["causationId"]).toBe("msg-1");
    expect(envelope).toMatchObject({
      eventName: "purchase",
      dedupId: `ord_${ORDER_ID}`,
      eventOrigin: "server",
      tenancy: { tenantId: TENANT },
      timestamp: PLACED_AT,
    });
    expect(envelope.context?.page?.eventSourceUrl).toBe(STORE_URL);
    expect(envelope.payload).toMatchObject({
      orderId: ORDER_ID,
      currency: "EGP",
      valueMinor: 100_000,
    });
  });

  it("created and placed for one order are one Purchase: same message id, same dedup id", async () => {
    const { handlerFor, published } = harness();
    await handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED));
    await handlerFor(ORDERS_ORDER_PLACED).handle(
      busEvent(ORDERS_ORDER_PLACED, { messageId: "msg-2" }),
    );

    expect(published).toHaveLength(2);
    expect(published[0]?.headers["messageId"]).toBe(published[1]?.headers["messageId"]);
    expect(envelopeOf(published[0]).dedupId).toBe(envelopeOf(published[1]).dedupId);
    expect(envelopeOf(published[0]).dedupId).toBe(`ord_${ORDER_ID}`);
  });

  it("a redelivery publishes the identical record (the outbox skips the duplicate)", async () => {
    const { handlerFor, published } = harness();
    const handler = handlerFor(ORDERS_ORDER_CREATED);
    await handler.handle(busEvent(ORDERS_ORDER_CREATED));
    await handler.handle(busEvent(ORDERS_ORDER_CREATED));
    expect(published[0]?.headers["messageId"]).toBe(published[1]?.headers["messageId"]);
    expect(
      Buffer.from(published[0]?.value ?? new Uint8Array()).equals(
        Buffer.from(published[1]?.value ?? new Uint8Array()),
      ),
    ).toBe(true);
  });

  it("never runs the cancel guard for a purchase", async () => {
    const { handlerFor, guardCalls } = harness();
    await handlerFor(ORDERS_ORDER_PLACED).handle(busEvent(ORDERS_ORDER_PLACED));
    expect(guardCalls).toEqual([]);
  });

  it("uses the snapshot page url over the store url, and the store url when there is none", async () => {
    const withPage = harness({
      order: order({ snapshot: { pageUrl: "https://shop.example/checkout?x=1" } }),
    });
    await withPage.handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED));
    expect(envelopeOf(withPage.published[0]).context?.page?.eventSourceUrl).toBe(
      "https://shop.example/checkout?x=1",
    );
  });
});

describe("cancel (orders.order.cancelled / fulfillment.order.returned)", () => {
  it("skips a cancel with no server-origin purchase record: nothing published", async () => {
    const { handlerFor, published, guardCalls, logger } = harness({ hasPurchase: false });
    const handler = handlerFor(ORDERS_ORDER_CANCELLED);
    await handler.handle(busEvent(ORDERS_ORDER_CANCELLED));

    expect(guardCalls).toEqual([{ tenantId: TENANT, orderId: ORDER_ID }]);
    expect(published).toEqual([]);
    expect(handler.counters()).toMatchObject({ received: 1, published: 0, skippedNoPurchase: 1 });
    expect(logger.info).toHaveBeenCalled();
  });

  it("publishes cnl_<orderId> as an order_cancelled event stamped with the transition time", async () => {
    const { handlerFor, published } = harness();
    await handlerFor(ORDERS_ORDER_CANCELLED).handle(busEvent(ORDERS_ORDER_CANCELLED));

    const envelope = envelopeOf(published[0]);
    expect(envelope).toMatchObject({
      eventName: "order_cancelled",
      dedupId: `cnl_${ORDER_ID}`,
      timestamp: "2026-11-28T11:30:00.000Z",
    });
    expect(envelope.payload).toMatchObject({ orderId: ORDER_ID, transactionId: ORDER_ID });
  });

  it("returned reads the order from payload.orderRef and collapses with cancelled into one cnl_ id", async () => {
    const { handlerFor, published, reads } = harness();
    await handlerFor(ORDERS_ORDER_CANCELLED).handle(busEvent(ORDERS_ORDER_CANCELLED));
    await handlerFor(FULFILLMENT_ORDER_RETURNED).handle(
      fulfillmentEvent(FULFILLMENT_ORDER_RETURNED),
    );

    expect(reads).toEqual([
      { tenantId: TENANT, orderId: ORDER_ID },
      { tenantId: TENANT, orderId: ORDER_ID },
    ]);
    expect(published).toHaveLength(2);
    expect(published[0]?.headers["messageId"]).toBe(published[1]?.headers["messageId"]);
    expect(envelopeOf(published[1]).dedupId).toBe(`cnl_${ORDER_ID}`);
  });

  it("returned with no server purchase is skipped too", async () => {
    const { handlerFor, published } = harness({ hasPurchase: false });
    await handlerFor(FULFILLMENT_ORDER_RETURNED).handle(
      fulfillmentEvent(FULFILLMENT_ORDER_RETURNED),
    );
    expect(published).toEqual([]);
  });
});

describe("delivered (fulfillment.order.delivered)", () => {
  it("publishes dlv_<orderId> from payload.orderRef; no guard is needed", async () => {
    const { handlerFor, published, guardCalls } = harness();
    await handlerFor(FULFILLMENT_ORDER_DELIVERED).handle(
      fulfillmentEvent(FULFILLMENT_ORDER_DELIVERED),
    );

    expect(guardCalls).toEqual([]);
    expect(envelopeOf(published[0])).toMatchObject({
      eventName: "order_delivered",
      dedupId: `dlv_${ORDER_ID}`,
      timestamp: "2026-11-28T11:30:00.000Z",
    });
  });

  it("refuses a fulfillment event that names no order", async () => {
    const { handlerFor, published, reads } = harness();
    const handler = handlerFor(FULFILLMENT_ORDER_DELIVERED);
    await handler.handle(busEvent(FULFILLMENT_ORDER_DELIVERED, { payload: {} }));
    await handler.handle(busEvent(FULFILLMENT_ORDER_DELIVERED, { payload: null }));
    expect(reads).toEqual([]);
    expect(published).toEqual([]);
    expect(handler.counters().refused).toBe(2);
  });
});

describe("tenant (G-64)", () => {
  it.each(["", "  "])(
    "refuses an envelope with tenant %j: nothing read, nothing published",
    async (tenantId) => {
      const { handlerFor, published, reads, logger } = harness();
      const handler = handlerFor(ORDERS_ORDER_CREATED);
      await handler.handle(busEvent(ORDERS_ORDER_CREATED, { tenantId }));

      expect(reads).toEqual([]);
      expect(published).toEqual([]);
      expect(handler.counters()).toMatchObject({ received: 1, refused: 1, published: 0 });
      expect(logger.error).toHaveBeenCalled();
    },
  );

  it("an envelope with no tenant property at all is refused, never defaulted", async () => {
    const { handlerFor, published, reads } = harness();
    const { tenantId: _omitted, ...withoutTenant } = busEvent(ORDERS_ORDER_CREATED);
    await handlerFor(ORDERS_ORDER_CREATED).handle(withoutTenant as IntegrationEvent<unknown>);
    expect(reads).toEqual([]);
    expect(published).toEqual([]);
  });

  it("reads and files under the ENVELOPE's tenant: headers, key and the tracking envelope agree", async () => {
    const { handlerFor, published, reads, guardCalls } = harness();
    await handlerFor(ORDERS_ORDER_CANCELLED).handle(
      busEvent(ORDERS_ORDER_CANCELLED, { tenantId: "tenant-9" }),
    );
    expect(reads[0]?.tenantId).toBe("tenant-9");
    expect(guardCalls[0]?.tenantId).toBe("tenant-9");
    const record = published[0] as PublishRecord;
    expect(record.key).toBe("tenant-9");
    expect(record.headers["tenantId"]).toBe("tenant-9");
    expect(envelopeOf(record).tenancy?.tenantId).toBe("tenant-9");
  });
});

describe("unknown order, expiry and malformed input", () => {
  it("an order that is not visible yet throws so the runtime retries (then dead-letters)", async () => {
    const { handlerFor, published } = harness({ order: null });
    await expect(
      handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED)),
    ).rejects.toBeInstanceOf(OrderNotVisibleError);
    expect(published).toEqual([]);
  });

  it("a purchase older than 7 days is acknowledged and counted, never published or retried", async () => {
    const { handlerFor, published } = harness({
      order: order({ placedAt: "2026-11-20T11:00:00.000Z" }),
    });
    const handler = handlerFor(ORDERS_ORDER_CREATED);
    await expect(handler.handle(busEvent(ORDERS_ORDER_CREATED))).resolves.toBeUndefined();
    expect(published).toEqual([]);
    expect(handler.counters()).toMatchObject({ expired: 1, published: 0 });
  });

  it("a six-day-old purchase is still sent", async () => {
    const { handlerFor, published } = harness({
      order: order({ placedAt: "2026-11-22T13:00:00.000Z" }),
    });
    await handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED));
    expect(published).toHaveLength(1);
  });

  it("an old delivery is judged by when it happened, not by when the order was placed", async () => {
    const { handlerFor, published } = harness({
      order: order({ placedAt: "2026-11-01T11:00:00.000Z" }),
    });
    await handlerFor(FULFILLMENT_ORDER_DELIVERED).handle(
      fulfillmentEvent(FULFILLMENT_ORDER_DELIVERED),
    );
    expect(published).toHaveLength(1);
  });

  it("an order id that is not a business reference is refused (acked), not retried", async () => {
    const { handlerFor, published } = harness({ order: order({ orderId: "not a ref!" }) });
    const handler = handlerFor(ORDERS_ORDER_CREATED);
    await expect(handler.handle(busEvent(ORDERS_ORDER_CREATED))).resolves.toBeUndefined();
    expect(published).toEqual([]);
    expect(handler.counters().refused).toBe(1);
  });

  it("a publish failure propagates so the runtime retries the message", async () => {
    const { handlerFor } = harness({ publishError: new Error("db down") });
    await expect(
      handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED)),
    ).rejects.toThrow("db down");
  });
});

describe("store url (P2-D7)", () => {
  it("falls back to the snapshot page url when no domain names the store", async () => {
    const { handlerFor, published } = harness({
      storeUrl: null,
      order: order({ snapshot: { pageUrl: "https://shop.example/checkout" } }),
    });
    await handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED));
    expect(published).toHaveLength(1);
  });

  it("throws (retry, then dead letter) when nothing names the store", async () => {
    const { handlerFor, published } = harness({ storeUrl: null });
    await expect(
      handlerFor(ORDERS_ORDER_CREATED).handle(busEvent(ORDERS_ORDER_CREATED)),
    ).rejects.toBeInstanceOf(StoreUrlUnavailableError);
    expect(published).toEqual([]);
  });
});

describe("no raw customer data in logs", () => {
  it("logs ids and counts only", async () => {
    const { handlerFor, logger } = harness({ hasPurchase: false });
    await handlerFor(ORDERS_ORDER_CANCELLED).handle(busEvent(ORDERS_ORDER_CANCELLED));
    const logged = JSON.stringify(
      [logger.info, logger.warn, logger.error].flatMap(
        (fn) => (fn as ReturnType<typeof vi.fn>).mock.calls,
      ),
    );
    expect(logged).not.toContain("mona@example.com");
    expect(logged).not.toContain("01012345678");
    expect(logged).not.toContain("Mona");
  });
});
