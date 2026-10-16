import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import type { IntegrationEvent } from "@platform/domain-events";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Logger } from "@platform/utils";
import { InMemoryDeadLetterStore } from "../dlq/in-memory-dead-letter-store";
import { InMemoryProcessedEventStore } from "../idempotency/in-memory-processed-event-store";
import type { ProcessedEventStore } from "../idempotency/processed-event-store";
import { RetryPolicy } from "../retry/retry-policy";
import { EventConsumer, type EventConsumerDeps } from "./event-consumer";
import type { EventHandler } from "./event-handler";
import type { IncomingMessage } from "./incoming-message";

/** Fake transaction context — a distinct object per `run` call, so tests can assert identity. */
type FakeTx = { readonly id: number };

/** Runs `work` immediately with a fresh fake tx — no real rollback semantics, just identity/count tracking. */
class FakeUnitOfWork implements TransactionalUnitOfWork<FakeTx> {
  runCount = 0;
  async run<T>(work: (tx: FakeTx) => Promise<T>): Promise<T> {
    this.runCount += 1;
    return work({ id: this.runCount });
  }
}

type OrderPayload = { total: number };

const clock: Clock = { now: () => new Date("2026-06-29T00:00:00.000Z") };
const serializer = new InMemoryEventSerializer();
const noSleep = async (): Promise<void> => {};

function silentLogger(): Logger {
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  return log;
}

function message(total: number, messageId = "evt-1"): IncomingMessage {
  const envelope: IntegrationEvent<OrderPayload> = {
    messageId,
    type: "orders.order.placed",
    eventVersion: 1,
    aggregateId: "order-1",
    aggregateType: "order",
    occurredAt: "2026-06-29T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    tenantId: "tenant-test",
    payload: { total },
    metadata: {},
  };
  const serialized = serializer.serialize(envelope);
  return {
    topic: "orders.order.placed.v1",
    key: "order-1",
    value: serialized.data,
    headers: {
      type: serialized.type,
      eventVersion: String(serialized.eventVersion),
      contentType: serialized.contentType,
    },
  };
}

function deps(overrides: Partial<EventConsumerDeps> = {}): EventConsumerDeps {
  return {
    serializer,
    processedEvents: new InMemoryProcessedEventStore(),
    deadLetters: new InMemoryDeadLetterStore(),
    retryPolicy: new RetryPolicy({
      maxAttempts: 3,
      baseDelayMs: 1,
      factor: 2,
      maxDelayMs: 10,
      jitter: () => 0,
    }),
    clock,
    logger: silentLogger(),
    sleep: noSleep,
    ...overrides,
  };
}

describe("EventConsumer", () => {
  it("handles a message once and records it as processed", async () => {
    const handled: number[] = [];
    const handler: EventHandler<OrderPayload> = {
      eventType: "orders.order.placed",
      eventVersion: 1,
      handle: async (event) => {
        handled.push(event.payload.total);
      },
    };
    const processedEvents = new InMemoryProcessedEventStore();

    await new EventConsumer(handler, deps({ processedEvents })).consume(message(100));

    expect(handled).toEqual([100]);
    expect(await processedEvents.has("evt-1")).toBe(true);
  });

  it("deduplicates redelivery of the same message", async () => {
    const handled: number[] = [];
    const handler: EventHandler<OrderPayload> = {
      eventType: "orders.order.placed",
      eventVersion: 1,
      handle: async (event) => {
        handled.push(event.payload.total);
      },
    };
    const consumer = new EventConsumer(
      handler,
      deps({ processedEvents: new InMemoryProcessedEventStore() }),
    );
    const msg = message(100);

    await consumer.consume(msg);
    await consumer.consume(msg);

    expect(handled).toEqual([100]);
  });

  it("retries a transient failure, then succeeds", async () => {
    let attempts = 0;
    const handler: EventHandler<OrderPayload> = {
      eventType: "orders.order.placed",
      eventVersion: 1,
      handle: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("transient");
        }
      },
    };

    await new EventConsumer(handler, deps()).consume(message(1));

    expect(attempts).toBe(3);
  });

  it("dead-letters a message after exhausting retries", async () => {
    const deadLetters = new InMemoryDeadLetterStore();
    const handler: EventHandler<OrderPayload> = {
      eventType: "orders.order.placed",
      eventVersion: 1,
      handle: async () => {
        throw new Error("always fails");
      },
    };

    await new EventConsumer(handler, deps({ deadLetters })).consume(message(1));

    expect(deadLetters.snapshot()).toHaveLength(1);
    expect(deadLetters.snapshot()[0]?.attempts).toBe(3);
    expect(deadLetters.snapshot()[0]?.error).toBe("always fails");
  });

  describe("opt-in atomic path (Sprint A0)", () => {
    it("handlers without handleAtomic are unaffected even when a unitOfWork is provided", async () => {
      const handled: number[] = [];
      const unitOfWork = new FakeUnitOfWork();
      const handler: EventHandler<OrderPayload, FakeTx> = {
        eventType: "orders.order.placed",
        eventVersion: 1,
        handle: async (event) => {
          handled.push(event.payload.total);
        },
      };
      const consumerDeps: EventConsumerDeps<FakeTx> = { ...deps(), unitOfWork };

      await new EventConsumer(handler, consumerDeps).consume(message(100));

      expect(handled).toEqual([100]);
      expect(unitOfWork.runCount).toBe(0); // never invoked — handler didn't opt in
    });

    it("runs handleAtomic and the processed-marker write inside the same transaction", async () => {
      const receivedTx: FakeTx[] = [];
      const unitOfWork = new FakeUnitOfWork();
      const processedEvents = new InMemoryProcessedEventStore();
      const recordedTx: unknown[] = [];
      const spiedStore: ProcessedEventStore = {
        has: (id) => processedEvents.has(id),
        recordIfNew: (id, at, tx) => {
          recordedTx.push(tx);
          return processedEvents.recordIfNew(id, at, tx);
        },
      };
      const handler: EventHandler<OrderPayload, FakeTx> = {
        eventType: "orders.order.placed",
        eventVersion: 1,
        handle: async () => {
          throw new Error("should never be called — handleAtomic takes precedence");
        },
        handleAtomic: async (_event, tx) => {
          receivedTx.push(tx);
        },
      };
      const consumerDeps: EventConsumerDeps<FakeTx> = {
        ...deps(),
        processedEvents: spiedStore,
        unitOfWork,
      };

      await new EventConsumer(handler, consumerDeps).consume(message(100));

      expect(unitOfWork.runCount).toBe(1);
      expect(receivedTx).toEqual([{ id: 1 }]);
      expect(recordedTx).toEqual([{ id: 1 }]); // same tx object handleAtomic received
      expect(await processedEvents.has("evt-1")).toBe(true);
    });

    it("rolls back the domain effect (never dead-letters/retries) when recordIfNew loses the race inside the transaction", async () => {
      // Models the exact window the fast `has()` pre-check cannot close: `has` reports "not yet
      // processed" (so the consumer proceeds into the transaction), but a concurrent redelivery
      // wins the `recordIfNew` insert race once inside it. The atomic path must detect that and
      // roll the whole transaction back — never dead-letter or retry a benign duplicate.
      const unitOfWork = new FakeUnitOfWork();
      const deadLetters = new InMemoryDeadLetterStore();
      let handleAtomicCalls = 0;
      let warned = false;
      const raceyStore: ProcessedEventStore = {
        has: async () => false,
        recordIfNew: async () => false, // always loses the race, simulating the closed window
      };
      const handler: EventHandler<OrderPayload, FakeTx> = {
        eventType: "orders.order.placed",
        eventVersion: 1,
        handle: async () => {
          throw new Error("should never be called");
        },
        handleAtomic: async () => {
          handleAtomicCalls += 1;
        },
      };
      const logger: Logger = {
        debug: () => {},
        info: () => {},
        error: () => {},
        child: () => logger,
        warn: () => {
          warned = true;
        },
      };
      const consumerDeps: EventConsumerDeps<FakeTx> = {
        ...deps(),
        processedEvents: raceyStore,
        deadLetters,
        unitOfWork,
        logger,
      };

      await new EventConsumer(handler, consumerDeps).consume(message(100, "evt-1"));

      expect(handleAtomicCalls).toBe(1); // handleAtomic ran inside the tx...
      expect(unitOfWork.runCount).toBe(1);
      expect(deadLetters.snapshot()).toHaveLength(0); // ...but never treated as a failure
      expect(warned).toBe(true); // ...and the benign-duplicate outcome is logged
    });
  });
});
