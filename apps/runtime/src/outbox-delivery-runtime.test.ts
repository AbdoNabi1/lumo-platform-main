import { wireCatalog } from "@platform/catalog";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { DeadLetterPublisher, KafkaConsumerRuntime, type Kafka } from "@platform/kafka";
import { wireLicensing } from "@platform/licensing";
import {
  InMemoryDeadLetterStore,
  InMemoryOutboxDeliveryQueue,
  InMemoryProcessedEventStore,
  type DirectConsumer,
  type OutboxEntry,
  type PublishRecord,
} from "@platform/messaging";
import type { Logger } from "@platform/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCore } from "./composition";
import { LicensingUsageRecordedConsumer } from "./consumers/usage-recorded.consumers";
import { startOutboxDelivery } from "./outbox-delivery-runtime";

const T0 = Date.parse("2026-09-30T10:00:00.000Z");

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

/** Follows vitest's fake timers, so advancing time also moves "now" for the retry schedule. */
const clock: Clock = { now: () => new Date() };

function fakeCore(overrides: { lockAcquire?: ReturnType<typeof vi.fn>; intervalMs?: number } = {}) {
  const release = vi.fn().mockResolvedValue(true);
  const lockAcquire = overrides.lockAcquire ?? vi.fn().mockResolvedValue({ release });
  const recordOutboxPublished = vi.fn();
  const recordOutboxRelayFailure = vi.fn();
  const core = {
    config: {
      OUTBOX_RELAY_INTERVAL_MS: overrides.intervalMs ?? 1_000,
      OUTBOX_RELAY_BATCH_SIZE: 200,
    } as RuntimeCore["config"],
    clock,
    logger: silentLogger,
    distributedLock: { acquire: lockAcquire } as unknown as RuntimeCore["distributedLock"],
    metrics: {
      recordOutboxPublished,
      recordOutboxRelayFailure,
    } as unknown as RuntimeCore["metrics"],
  } as RuntimeCore;
  return { core, lockAcquire, release, recordOutboxPublished, recordOutboxRelayFailure };
}

function entry(id: string, topic = "orders.order.paid.v1"): OutboxEntry {
  return {
    id,
    topic,
    key: "order-1",
    contentType: "application/json",
    payload: new Uint8Array([1]),
    headers: { messageId: id, tenantId: "t-1" },
    status: "pending",
    createdAt: new Date(T0).toISOString(),
    publishedAt: null,
  };
}

function recordingConsumer(topic = "orders.order.paid.v1") {
  const delivered: string[] = [];
  const consumer: DirectConsumer = {
    topic,
    consumerGroup: "test.group",
    deliver: async (message) => {
      delivered.push(message.headers["messageId"] ?? "");
    },
    deadLetter: async () => undefined,
  };
  return { consumer, delivered };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("outbox delivery runtime (EVENT_TRANSPORT=postgres)", () => {
  it("delivers due rows on the poll interval, under the outbox-relay lock, and counts them", async () => {
    const { core, lockAcquire, release, recordOutboxPublished } = fakeCore();
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1"), entry("m2")]);
    const { consumer, delivered } = recordingConsumer();

    const handle = startOutboxDelivery(core, [consumer], queue);
    try {
      expect(delivered).toEqual([]); // nothing before the first tick
      await vi.advanceTimersByTimeAsync(1_000);

      expect(delivered).toEqual(["m1", "m2"]);
      // The SAME key as the Kafka relay: the two must never drain the table at once.
      expect(lockAcquire).toHaveBeenCalledWith("outbox-relay", 60_000);
      expect(release).toHaveBeenCalledTimes(1);
      expect(recordOutboxPublished).toHaveBeenCalledWith(2);
    } finally {
      handle.stop();
    }
  });

  it("does nothing on a tick where another worker holds the lock, and is not unhealthy for it", async () => {
    const { core, recordOutboxRelayFailure } = fakeCore({
      lockAcquire: vi.fn().mockResolvedValue(null),
    });
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const { consumer, delivered } = recordingConsumer();

    const handle = startOutboxDelivery(core, [consumer], queue);
    try {
      await vi.advanceTimersByTimeAsync(3_000);

      expect(delivered).toEqual([]);
      expect(recordOutboxRelayFailure).not.toHaveBeenCalled();
      await expect(handle.healthCheck().probe()).resolves.toBeUndefined();
    } finally {
      handle.stop();
    }
  });

  it("never runs two passes at once in this process, however slow a handler is", async () => {
    const { core } = fakeCore();
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    let running = 0;
    let maxRunning = 0;
    let deliveries = 0;
    const consumer: DirectConsumer = {
      topic: "orders.order.paid.v1",
      consumerGroup: "slow.group",
      deliver: async () => {
        deliveries += 1;
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5_500)); // spans five more ticks
        running -= 1;
      },
      deadLetter: async () => undefined,
    };

    const handle = startOutboxDelivery(core, [consumer], queue);
    try {
      await vi.advanceTimersByTimeAsync(10_000);

      expect(maxRunning).toBe(1);
      expect(deliveries).toBe(1); // the still-pending row was not handed out a second time mid-pass
    } finally {
      handle.stop();
    }
  });

  it("reports unhealthy while the last pass failed, releases the lock, and recovers on the next good pass", async () => {
    const { core, release, recordOutboxRelayFailure } = fakeCore();
    const queue = new InMemoryOutboxDeliveryQueue();
    const fetchDue = vi
      .spyOn(queue, "fetchDue")
      .mockRejectedValueOnce(new Error("database unreachable"));
    const { consumer } = recordingConsumer();

    const handle = startOutboxDelivery(core, [consumer], queue);
    try {
      await expect(handle.healthCheck().probe()).resolves.toBeUndefined(); // before any pass

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(handle.healthCheck().probe()).rejects.toThrow(
        "last delivery pass failed: database unreachable",
      );
      expect(recordOutboxRelayFailure).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1); // a failed pass must not strand the lock

      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchDue).toHaveBeenCalledTimes(2);
      await expect(handle.healthCheck().probe()).resolves.toBeUndefined();
    } finally {
      handle.stop();
    }
  });

  it("stops polling when stopped", async () => {
    const { core, lockAcquire } = fakeCore();
    const handle = startOutboxDelivery(core, [], new InMemoryOutboxDeliveryQueue());

    await vi.advanceTimersByTimeAsync(1_000);
    handle.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(lockAcquire).toHaveBeenCalledTimes(1);
  });
});

/**
 * The claim the whole transport rests on: a row written by a REAL producer's outbox is decoded and
 * effected by the REAL consumer runtime with no broker in between. Catalog's own outbox produces
 * the bytes and headers; `KafkaConsumerRuntime` — the class the worker registers — receives them
 * through the delivery loop; Licensing's counter is the effect. The Kafka client handed to the
 * runtime throws on any use.
 */
describe("outbox row → real consumer runtime, with no broker", () => {
  const serializer = new InMemoryEventSerializer();
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };

  const noBroker = new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`the broker-less transport used kafka.${String(property)}`);
      },
    },
  ) as Kafka;
  const noBrokerPublisher = {
    publish: async () => {
      throw new Error("the broker-less transport published to Kafka");
    },
    publishBatch: async () => {
      throw new Error("the broker-less transport published to Kafka");
    },
  };

  function toEntry(record: PublishRecord): OutboxEntry {
    return {
      id: record.headers["messageId"] ?? "",
      topic: record.topic,
      key: record.key,
      contentType: record.headers["contentType"] ?? "",
      payload: record.value,
      headers: record.headers,
      status: "pending",
      createdAt: clock.now().toISOString(),
      publishedAt: null,
    };
  }

  async function stack(writer?: LicensingUsageRecordedConsumer["handle"]) {
    const licensing = wireLicensing({ serializer, idGenerator, clock });
    const produced: PublishRecord[] = [];
    const catalog = wireCatalog({
      serializer,
      idGenerator,
      clock,
      onUsageRecorded: async (record) => {
        produced.push(record);
      },
    });
    const handler = new LicensingUsageRecordedConsumer(licensing.licensing);
    if (writer !== undefined) handler.handle = writer;
    const deadLetters = new InMemoryDeadLetterStore();
    const runtime = new KafkaConsumerRuntime({
      kafka: noBroker,
      handler,
      consumerGroup: "licensing.usage-recorded-consumer",
      serializer,
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

    const createProduct = async (tenantId: string, sku: string): Promise<void> => {
      const created = await catalog.products.create({
        sku,
        name: `Product ${sku}`,
        slug: sku.toLowerCase(),
        variants: [{ sku: `${sku}-V0`, priceAmountMinor: 1000, currency: "USD" }],
        tenantId,
      });
      expect(created.status).toBe(201);
      await catalog.drainOutbox();
    };
    const counter = async (tenant: string): Promise<unknown> =>
      (
        await licensing.licensing.getUsageCounter({
          tenantRef: tenant,
          resource: "PRODUCT",
          tenantId: tenant,
        })
      ).body;

    return { runtime, produced, deadLetters, createProduct, counter, toEntry };
  }

  it("a product created in Catalog reaches Licensing's usage counter", async () => {
    const { runtime, produced, createProduct, counter } = await stack();
    await createProduct("t-1", "SKU-1");
    await createProduct("t-1", "SKU-2");
    expect(produced).toHaveLength(2);
    expect(runtime.topic).toBe(produced[0]?.topic); // routed by the row's own topic
    expect(await counter("t-1")).toEqual({ amount: 0, unit: "" });

    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue(produced.map(toEntry));
    const handle = startOutboxDelivery(fakeCore().core, [runtime], queue);
    try {
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      handle.stop();
    }

    expect(await counter("t-1")).toEqual({ amount: 2, unit: "count" });
    expect(queue.snapshot().every((row) => row.entry.status === "published")).toBe(true);
    expect(runtime.isRunning).toBe(false); // never started against a broker
  });

  it("retries a failing consumer on the production schedule and then effects the row once", async () => {
    let failures = 2;
    const { runtime, produced, createProduct, counter } = await stack();
    const real = runtime.deliver.bind(runtime);
    runtime.deliver = async (message) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("licensing database unreachable");
      }
      await real(message);
    };
    await createProduct("t-1", "SKU-1");

    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue(produced.map(toEntry));
    const handle = startOutboxDelivery(fakeCore().core, [runtime], queue);
    try {
      await vi.advanceTimersByTimeAsync(1_000); // round 1 fails → due in 5s
      expect(queue.snapshot()[0]).toMatchObject({ attempts: 1 });
      await vi.advanceTimersByTimeAsync(4_000); // not due yet
      expect(queue.snapshot()[0]).toMatchObject({ attempts: 1 });
      await vi.advanceTimersByTimeAsync(2_000); // round 2 fails → due in 30s
      expect(queue.snapshot()[0]).toMatchObject({ attempts: 2 });
      expect(await counter("t-1")).toEqual({ amount: 0, unit: "" });
      await vi.advanceTimersByTimeAsync(31_000); // round 3 succeeds
    } finally {
      handle.stop();
    }

    expect(await counter("t-1")).toEqual({ amount: 1, unit: "count" });
    expect(queue.snapshot()[0]?.entry.status).toBe("published");
  });

  it("dead-letters a row the consumer can never handle, with the producer's exact bytes", async () => {
    const {
      runtime,
      produced,
      deadLetters,
      createProduct,
      toEntry: asEntry,
    } = await stack(async () => {
      throw new Error("poison");
    });
    await createProduct("t-1", "SKU-1");

    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue(produced.map(asEntry));
    const handle = startOutboxDelivery(fakeCore().core, [runtime], queue);
    try {
      // 5s + 30s + 2m + 10m + 1h, plus a tick of slack per round.
      await vi.advanceTimersByTimeAsync(5_000 + 30_000 + 120_000 + 600_000 + 3_600_000 + 10_000);
    } finally {
      handle.stop();
    }

    expect(deadLetters.snapshot()).toHaveLength(1);
    expect(deadLetters.snapshot()[0]).toMatchObject({
      messageId: produced[0]?.headers["messageId"],
      topic: "platform.usage.recorded.v1",
      value: produced[0]?.value,
      attempts: 6, // the first delivery and the schedule's five retries
      error: "poison",
    });
    expect(queue.snapshot()[0]?.entry.status).toBe("published"); // out of the queue
  });
});
