import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import type { IncomingMessage } from "../consumer/incoming-message";
import { InMemoryOutboxDeliveryQueue } from "./in-memory-outbox-delivery-queue";
import {
  OutboxDeliveryRelay,
  type DirectConsumer,
  type DirectDeadLetter,
} from "./outbox-delivery-relay";
import type { OutboxEntry } from "./outbox-entry";

const T0 = Date.parse("2026-09-30T00:00:00.000Z");

class TestClock implements Clock {
  private ms = T0;
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const PAID = "orders.order.paid.v1";

function entry(id: string, topic = PAID): OutboxEntry {
  return {
    id,
    topic,
    key: "order-1",
    contentType: "application/json",
    payload: new Uint8Array([1, 2, 3]),
    headers: { messageId: id, type: "orders.order.paid", eventVersion: "1", tenantId: "t-1" },
    status: "pending",
    createdAt: "2026-09-30T00:00:00.000Z",
    publishedAt: null,
  };
}

/**
 * A consumer with its own inbox, like the real one: a message it already effected is skipped, so a
 * redelivery of a row another consumer failed does not effect it twice.
 */
class FakeConsumer implements DirectConsumer {
  readonly topic: string;
  readonly consumerGroup: string;
  readonly effected: string[] = [];
  readonly deadLetters: DirectDeadLetter[] = [];
  /** Message ids this consumer throws on, until removed. */
  readonly failing = new Set<string>();
  deliveries = 0;

  constructor(consumerGroup: string, topic = PAID) {
    this.consumerGroup = consumerGroup;
    this.topic = topic;
  }

  async deliver(message: IncomingMessage): Promise<void> {
    this.deliveries += 1;
    const id = message.headers["messageId"] ?? "";
    if (this.effected.includes(id)) return;
    if (this.failing.has(id)) throw new Error(`${this.consumerGroup} cannot handle ${id}`);
    this.effected.push(id);
  }

  async deadLetter(input: DirectDeadLetter): Promise<void> {
    this.deadLetters.push(input);
  }
}

function relayOver(
  queue: InMemoryOutboxDeliveryQueue,
  consumers: readonly DirectConsumer[],
  clock: Clock,
  options: { retryDelaysMs?: readonly number[]; batchSize?: number } = {},
): OutboxDeliveryRelay {
  return new OutboxDeliveryRelay({
    queue,
    consumers,
    clock,
    logger: silentLogger,
    retryDelaysMs: options.retryDelaysMs ?? [5_000, 30_000],
    ...(options.batchSize !== undefined ? { batchSize: options.batchSize } : {}),
  });
}

function statusOf(queue: InMemoryOutboxDeliveryQueue, id: string): string | undefined {
  return queue.snapshot().find((row) => row.entry.id === id)?.entry.status;
}

describe("OutboxDeliveryRelay — the broker-less transport", () => {
  it("delivers a row to EVERY consumer of its topic, then marks it delivered", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const finance = new FakeConsumer("finance.orders-paid");
    const loyalty = new FakeConsumer("loyalty.orders-paid");

    const report = await relayOver(queue, [finance, loyalty], new TestClock()).drainOnce();

    expect(report).toEqual({ delivered: 1, unrouted: 0, deferred: 0, deadLettered: 0 });
    expect(finance.effected).toEqual(["m1"]);
    expect(loyalty.effected).toEqual(["m1"]);
    expect(statusOf(queue, "m1")).toBe("published");
  });

  it("hands the consumer the row's exact bytes, key and headers", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    const row = entry("m1");
    queue.enqueue([row]);
    const seen: IncomingMessage[] = [];
    const consumer: DirectConsumer = {
      topic: PAID,
      consumerGroup: "g",
      deliver: async (message) => {
        seen.push(message);
      },
      deadLetter: async () => undefined,
    };

    await relayOver(queue, [consumer], new TestClock()).drainOnce();

    expect(seen).toEqual([
      { topic: PAID, key: "order-1", value: row.payload, headers: row.headers },
    ]);
  });

  it("marks a row on a topic nobody subscribes to as delivered, and delivers it to no one", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1", "catalog.product.created.v1")]);
    const consumer = new FakeConsumer("finance.orders-paid");

    const report = await relayOver(queue, [consumer], new TestClock()).drainOnce();

    expect(report).toEqual({ delivered: 0, unrouted: 1, deferred: 0, deadLettered: 0 });
    expect(consumer.deliveries).toBe(0);
    expect(statusOf(queue, "m1")).toBe("published");
  });

  it("leaves a failed row PENDING and not due until its delay has passed", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const consumer = new FakeConsumer("finance.orders-paid");
    consumer.failing.add("m1");
    const clock = new TestClock();
    const relay = relayOver(queue, [consumer], clock);

    expect(await relay.drainOnce()).toEqual({
      delivered: 0,
      unrouted: 0,
      deferred: 1,
      deadLettered: 0,
    });
    expect(statusOf(queue, "m1")).toBe("pending");
    expect(queue.snapshot()[0]).toMatchObject({
      attempts: 1,
      availableAt: new Date(T0 + 5_000).toISOString(),
    });

    // Not due yet: the pass must not touch the consumer at all.
    clock.advance(4_999);
    await relay.drainOnce();
    expect(consumer.deliveries).toBe(1);

    clock.advance(1);
    consumer.failing.delete("m1");
    expect((await relay.drainOnce()).delivered).toBe(1);
    expect(consumer.effected).toEqual(["m1"]);
    expect(statusOf(queue, "m1")).toBe("published");
  });

  it("keeps delivering the rows BEHIND a failing one — no head-of-line blocking", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("bad"), entry("good-1"), entry("good-2")]);
    const consumer = new FakeConsumer("finance.orders-paid");
    consumer.failing.add("bad");

    const report = await relayOver(queue, [consumer], new TestClock()).drainOnce();

    expect(report).toMatchObject({ delivered: 2, deferred: 1 });
    expect(consumer.effected).toEqual(["good-1", "good-2"]);
  });

  it("does not let waiting rows fill the batch and starve the rows behind them", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("bad-1"), entry("bad-2"), entry("good")]);
    const consumer = new FakeConsumer("finance.orders-paid");
    consumer.failing.add("bad-1").add("bad-2");
    const relay = relayOver(queue, [consumer], new TestClock(), { batchSize: 2 });

    // Pass 1 takes the two bad rows (batch of 2) and defers both.
    expect((await relay.drainOnce()).deferred).toBe(2);
    // Pass 2, same instant: the batch must now be the good row, not the two waiting ones.
    expect((await relay.drainOnce()).delivered).toBe(1);
    expect(consumer.effected).toEqual(["good"]);
  });

  it("still delivers to the healthy consumer when another consumer of the same topic fails", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const broken = new FakeConsumer("finance.orders-paid");
    broken.failing.add("m1");
    const healthy = new FakeConsumer("loyalty.orders-paid");
    const clock = new TestClock();
    // Broken first, so a relay that stopped at the first failure would never reach the healthy one.
    const relay = relayOver(queue, [broken, healthy], clock);

    expect((await relay.drainOnce()).deferred).toBe(1);
    expect(healthy.effected).toEqual(["m1"]);
    expect(statusOf(queue, "m1")).toBe("pending");

    // The retry round redelivers to both; the healthy one must not be effected a second time.
    clock.advance(5_000);
    broken.failing.delete("m1");
    expect((await relay.drainOnce()).delivered).toBe(1);
    expect(broken.effected).toEqual(["m1"]);
    expect(healthy.effected).toEqual(["m1"]);
    expect(healthy.deliveries).toBe(2);
  });

  it("dead-letters ONLY the consumers still failing once the schedule is exhausted", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const broken = new FakeConsumer("finance.orders-paid");
    broken.failing.add("m1");
    const healthy = new FakeConsumer("loyalty.orders-paid");
    const clock = new TestClock();
    const relay = relayOver(queue, [broken, healthy], clock, { retryDelaysMs: [5_000, 30_000] });

    expect((await relay.drainOnce()).deferred).toBe(1); // round 1 → wait 5s
    clock.advance(5_000);
    expect((await relay.drainOnce()).deferred).toBe(1); // round 2 → wait 30s
    expect(queue.snapshot()[0]).toMatchObject({
      attempts: 2,
      availableAt: new Date(T0 + 5_000 + 30_000).toISOString(),
    });
    clock.advance(30_000);
    expect(await relay.drainOnce()).toEqual({
      delivered: 0,
      unrouted: 0,
      deferred: 0,
      deadLettered: 1,
    }); // round 3 → schedule of 2 retries exhausted

    expect(broken.deadLetters).toHaveLength(1);
    expect(broken.deadLetters[0]).toMatchObject({ messageId: "m1", attempts: 3 });
    expect((broken.deadLetters[0]?.error as Error).message).toBe(
      "finance.orders-paid cannot handle m1",
    );
    expect(healthy.deadLetters).toHaveLength(0);
    // Out of the queue: a fourth pass must not deliver it again.
    expect(statusOf(queue, "m1")).toBe("published");
    clock.advance(3_600_000);
    await relay.drainOnce();
    expect(broken.deliveries).toBe(3);
  });

  it("keeps the row pending when the dead-letter record itself cannot be written", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const consumer: DirectConsumer = {
      topic: PAID,
      consumerGroup: "g",
      deliver: async () => {
        throw new Error("handler down");
      },
      deadLetter: async () => {
        throw new Error("dead_letters table unreachable");
      },
    };
    const relay = relayOver(queue, [consumer], new TestClock(), { retryDelaysMs: [] });

    await expect(relay.drainOnce()).rejects.toThrow("dead_letters table unreachable");
    expect(statusOf(queue, "m1")).toBe("pending");
  });

  it("with an empty schedule dead-letters on the first failure", async () => {
    const queue = new InMemoryOutboxDeliveryQueue();
    queue.enqueue([entry("m1")]);
    const consumer = new FakeConsumer("finance.orders-paid");
    consumer.failing.add("m1");

    const report = await relayOver(queue, [consumer], new TestClock(), {
      retryDelaysMs: [],
    }).drainOnce();

    expect(report.deadLettered).toBe(1);
    expect(consumer.deadLetters[0]).toMatchObject({ attempts: 1 });
  });

  it("does nothing when nothing is due", async () => {
    const report = await relayOver(
      new InMemoryOutboxDeliveryQueue(),
      [new FakeConsumer("g")],
      new TestClock(),
    ).drainOnce();
    expect(report).toEqual({ delivered: 0, unrouted: 0, deferred: 0, deadLettered: 0 });
  });
});
