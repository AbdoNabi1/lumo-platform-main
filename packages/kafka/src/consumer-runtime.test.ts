import { describe, expect, it, vi } from "vitest";
import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";
import type { Clock } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { EventHandler, ProcessedEventStore } from "@platform/messaging";
import { InMemoryDeadLetterStore, InMemoryProcessedEventStore } from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Logger } from "@platform/utils";
import { KafkaConsumerRuntime } from "./consumer-runtime";
import { DeadLetterPublisher } from "./dead-letter-publisher";

type OrderPayload = { total: number };

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

const clock: Clock = { now: () => new Date("2026-06-29T00:00:00.000Z") };
const serializer: EventSerializer = new InMemoryEventSerializer();
const noopPublisher = { publish: async () => {}, publishBatch: async () => {} };

/** Builds a fake `EachMessagePayload` for `handleMessage` — never touches `.kafka`, so no broker needed. */
function payload(total: number, messageId: string, tenantId = "tenant-test"): EachMessagePayload {
  const envelope = {
    messageId,
    type: "orders.order.placed",
    eventVersion: 1,
    aggregateId: "order-1",
    aggregateType: "order",
    occurredAt: clock.now().toISOString(),
    correlationId: "c",
    causationId: "c",
    tenantId,
    payload: { total },
    metadata: {},
  };
  const serialized = serializer.serialize(envelope);
  return {
    topic: "orders.order.placed.v1",
    partition: 0,
    message: {
      key: Buffer.from("order-1"),
      value: Buffer.from(serialized.data),
      headers: {
        type: Buffer.from(serialized.type),
        eventVersion: Buffer.from(String(serialized.eventVersion)),
        contentType: Buffer.from(serialized.contentType),
      },
      timestamp: "0",
      attributes: 0,
      offset: "0",
    },
    heartbeat: async () => {},
    pause: () => () => {},
  } as EachMessagePayload;
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    kafka: {} as Kafka, // handleMessage never touches this
    serializer,
    consumerGroup: "orders.test",
    deadLetters: new DeadLetterPublisher({
      publisher: noopPublisher,
      store: new InMemoryDeadLetterStore(),
      clock,
    }),
    retryPublisher: noopPublisher,
    clock,
    logger: silentLogger(),
    ...overrides,
  };
}

describe("KafkaConsumerRuntime — opt-in atomic path (Sprint A0)", () => {
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
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps(),
      handler,
      processedEvents: new InMemoryProcessedEventStore(),
      unitOfWork,
    });

    await runtime.handleMessage(payload(100, "evt-1"));

    expect(handled).toEqual([100]);
    expect(unitOfWork.runCount).toBe(0);
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
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps(),
      handler,
      processedEvents: spiedStore,
      unitOfWork,
    });

    await runtime.handleMessage(payload(100, "evt-1"));

    expect(unitOfWork.runCount).toBe(1);
    expect(receivedTx).toEqual([{ id: 1 }]);
    expect(recordedTx).toEqual([{ id: 1 }]);
    expect(await processedEvents.has("evt-1")).toBe(true);
  });

  it("rolls back (never dead-letters/retries) when recordIfNew loses the race inside the transaction", async () => {
    const unitOfWork = new FakeUnitOfWork();
    const deadLetters = new InMemoryDeadLetterStore();
    let handleAtomicCalls = 0;
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
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({
        deadLetters: new DeadLetterPublisher({
          publisher: noopPublisher,
          store: deadLetters,
          clock,
        }),
      }),
      handler,
      processedEvents: raceyStore,
      unitOfWork,
    });

    await runtime.handleMessage(payload(100, "evt-1"));

    expect(handleAtomicCalls).toBe(1);
    expect(unitOfWork.runCount).toBe(1);
    expect(deadLetters.snapshot()).toHaveLength(0);
  });
});

/** A minimal fake kafkajs `Consumer` — enough surface for `start()`/`stop()`, records every call. */
function fakeConsumer(): Consumer & {
  readonly subscribeCalls: { topics: readonly string[] }[];
  readonly runCalls: number;
  readonly disconnectCalls: number;
} {
  const subscribeCalls: { topics: readonly string[] }[] = [];
  let runCalls = 0;
  let disconnectCalls = 0;
  return {
    connect: async () => {},
    subscribe: async (opts: { topics: readonly string[] }) => {
      subscribeCalls.push({ topics: opts.topics });
    },
    run: async () => {
      runCalls += 1;
    },
    disconnect: async () => {
      disconnectCalls += 1;
    },
    get subscribeCalls() {
      return subscribeCalls;
    },
    get runCalls() {
      return runCalls;
    },
    get disconnectCalls() {
      return disconnectCalls;
    },
    // Deliberately partial fake (only the methods `start`/`stop` need) — needs the `unknown` hop
    // since it has no structural overlap with the full kafkajs `Consumer` interface.
  } as unknown as Consumer & {
    readonly subscribeCalls: { topics: readonly string[] }[];
    readonly runCalls: number;
    readonly disconnectCalls: number;
  };
}

describe("KafkaConsumerRuntime — H-05 retry topic runs on its own consumer", () => {
  it("subscribes the main topic and the retry topic on two DIFFERENT consumers (own groupId each), never together", async () => {
    const consumers: { groupId: string; consumer: ReturnType<typeof fakeConsumer> }[] = [];
    const kafka = {
      consumer: vi.fn((opts: { groupId: string }) => {
        const consumer = fakeConsumer();
        consumers.push({ groupId: opts.groupId, consumer });
        return consumer;
      }),
      // Deliberately partial fake (only `consumer()`) — needs the `unknown` hop since it has no
      // structural overlap with the full kafkajs `Kafka` interface.
    } as unknown as Kafka;

    const handler: EventHandler<OrderPayload> = {
      eventType: "orders.order.placed",
      eventVersion: 1,
      handle: async () => {},
    };
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ kafka }),
      handler,
      processedEvents: new InMemoryProcessedEventStore(),
    });

    await runtime.start();

    expect(consumers).toHaveLength(2);
    const [main, retry] = consumers;
    expect(main?.groupId).toBe("orders.test");
    expect(retry?.groupId).toBe("orders.test.retry");
    // each consumer subscribes to exactly its own topic — never both together on one consumer, which
    // is what let a retry's in-process sleep head-of-line block the main topic (H-05).
    expect(main?.consumer.subscribeCalls).toEqual([{ topics: ["orders.order.placed.v1"] }]);
    expect(retry?.consumer.subscribeCalls).toEqual([{ topics: ["orders.order.placed.v1.retry"] }]);
    expect(main?.consumer.runCalls).toBe(1);
    expect(retry?.consumer.runCalls).toBe(1);

    await runtime.stop();
    expect(main?.consumer.disconnectCalls).toBe(1);
    expect(retry?.consumer.disconnectCalls).toBe(1);
  });
});

/** A logger that keeps every line, so a test can read what was (and was not) attributed to whom. */
function recordingLogger(): {
  readonly logger: Logger;
  readonly lines: { message: string; fields: Record<string, unknown> }[];
} {
  const lines: { message: string; fields: Record<string, unknown> }[] = [];
  const record = (message: string, fields?: Record<string, unknown>): void => {
    lines.push({ message, fields: fields ?? {} });
  };
  const logger: Logger = {
    debug: record,
    info: record,
    warn: record,
    error: record,
    child: () => logger,
  };
  return { logger, lines };
}

describe("KafkaConsumerRuntime — failure log lines name the tenant (T10.7)", () => {
  const failing: EventHandler<OrderPayload, FakeTx> = {
    eventType: "orders.order.placed",
    eventVersion: 1,
    handle: async () => {
      throw new Error("handler failed");
    },
  };

  it("a retry line carries the envelope's tenant, and only that tenant's", async () => {
    const { logger, lines } = recordingLogger();
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ logger, retrySchedule: { delaysMs: [10] } }),
      handler: failing,
      processedEvents: new InMemoryProcessedEventStore(),
    });

    await runtime.handleMessage(payload(1, "evt-a", "tenant-a"));
    await runtime.handleMessage(payload(2, "evt-b", "tenant-b"));

    const retries = lines.filter((line) => line.message === "message scheduled for retry");
    expect(retries.map((line) => [line.fields["messageId"], line.fields["tenantId"]])).toEqual([
      ["evt-a", "tenant-a"],
      ["evt-b", "tenant-b"],
    ]);
  });

  it("a dead-letter line carries the envelope's tenant, and only that tenant's", async () => {
    const { logger, lines } = recordingLogger();
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ logger, retrySchedule: { delaysMs: [] } }),
      handler: failing,
      processedEvents: new InMemoryProcessedEventStore(),
    });

    await runtime.handleMessage(payload(1, "evt-a", "tenant-a"));
    await runtime.handleMessage(payload(2, "evt-b", "tenant-b"));

    const dead = lines.filter((line) => line.message === "message dead-lettered");
    expect(dead.map((line) => [line.fields["messageId"], line.fields["tenantId"]])).toEqual([
      ["evt-a", "tenant-a"],
      ["evt-b", "tenant-b"],
    ]);
  });
});

/** The same envelope as `payload`, shaped as the outbox row the broker-less relay hands over. */
function directMessage(total: number, messageId: string, tenantId = "tenant-test") {
  const kafkaPayload = payload(total, messageId, tenantId);
  const headers: Record<string, string> = { messageId, tenantId };
  for (const [name, value] of Object.entries(kafkaPayload.message.headers ?? {})) {
    headers[name] = String(value);
  }
  return {
    topic: kafkaPayload.topic,
    key: "order-1",
    value: new Uint8Array(kafkaPayload.message.value ?? Buffer.alloc(0)),
    headers,
  };
}

describe("KafkaConsumerRuntime — broker-less delivery (EVENT_TRANSPORT=postgres)", () => {
  /** Any use of the broker on this path is a bug: there is no broker. */
  const brokerMustNotBeUsed = {
    publish: async () => {
      throw new Error("the broker-less path published to Kafka");
    },
    publishBatch: async () => {
      throw new Error("the broker-less path published to Kafka");
    },
  };

  function handlerRecording(handled: number[]): EventHandler<OrderPayload, FakeTx> {
    return {
      eventType: "orders.order.placed",
      eventVersion: 1,
      handle: async (event) => {
        handled.push(event.payload.total);
      },
    };
  }

  it("effects the message and records the inbox marker, without start() and without the broker", async () => {
    const handled: number[] = [];
    const processedEvents = new InMemoryProcessedEventStore();
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ retryPublisher: brokerMustNotBeUsed }),
      handler: handlerRecording(handled),
      processedEvents,
    });

    await runtime.deliver(directMessage(100, "evt-1"));

    expect(runtime.isRunning).toBe(false);
    expect(handled).toEqual([100]);
    expect(await processedEvents.has("evt-1")).toBe(true);
  });

  it("skips a message its inbox already holds — a redelivered row is not effected twice", async () => {
    const handled: number[] = [];
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ retryPublisher: brokerMustNotBeUsed }),
      handler: handlerRecording(handled),
      processedEvents: new InMemoryProcessedEventStore(),
    });

    await runtime.deliver(directMessage(100, "evt-1"));
    await runtime.deliver(directMessage(100, "evt-1"));

    expect(handled).toEqual([100]);
  });

  it("THROWS on a handler failure and schedules nothing — the relay owns the retry", async () => {
    const processedEvents = new InMemoryProcessedEventStore();
    const failed = vi.fn();
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({
        retryPublisher: brokerMustNotBeUsed,
        metrics: {
          processed: vi.fn(),
          failed,
          retried: vi.fn(),
          deadLettered: vi.fn(),
          duplicate: vi.fn(),
        },
      }),
      handler: {
        eventType: "orders.order.placed",
        eventVersion: 1,
        handle: async () => {
          throw new Error("ledger unreachable");
        },
      },
      processedEvents,
    });

    await expect(runtime.deliver(directMessage(100, "evt-1"))).rejects.toThrow(
      "ledger unreachable",
    );
    // Not marked: the next round must run the handler again.
    expect(await processedEvents.has("evt-1")).toBe(false);
    expect(failed).toHaveBeenCalledWith("orders.order.placed.v1", "orders.test");
  });

  it("THROWS on a message it cannot decode, instead of swallowing it", async () => {
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ retryPublisher: brokerMustNotBeUsed }),
      handler: handlerRecording([]),
      processedEvents: new InMemoryProcessedEventStore(),
    });
    const message = directMessage(100, "evt-1");

    await expect(
      runtime.deliver({ ...message, value: new TextEncoder().encode("not an envelope") }),
    ).rejects.toThrow();
  });

  it("takes the atomic path when the handler opts in, exactly as under Kafka", async () => {
    const unitOfWork = new FakeUnitOfWork();
    const receivedTx: FakeTx[] = [];
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({ retryPublisher: brokerMustNotBeUsed }),
      handler: {
        eventType: "orders.order.placed",
        eventVersion: 1,
        handle: async () => {
          throw new Error("should never be called — handleAtomic takes precedence");
        },
        handleAtomic: async (_event: unknown, tx: FakeTx) => {
          receivedTx.push(tx);
        },
      },
      processedEvents: new InMemoryProcessedEventStore(),
      unitOfWork,
    });

    await runtime.deliver(directMessage(100, "evt-1"));

    expect(unitOfWork.runCount).toBe(1);
    expect(receivedTx).toEqual([{ id: 1 }]);
  });

  it("dead-letters to the ROW only: no `.dlq` publish, original bytes kept, tenant on the log line", async () => {
    const store = new InMemoryDeadLetterStore();
    const { logger, lines } = recordingLogger();
    const runtime = new KafkaConsumerRuntime({
      ...baseDeps({
        logger,
        retryPublisher: brokerMustNotBeUsed,
        deadLetters: new DeadLetterPublisher({ publisher: brokerMustNotBeUsed, store, clock }),
      }),
      handler: handlerRecording([]),
      processedEvents: new InMemoryProcessedEventStore(),
    });
    const message = directMessage(100, "evt-1", "tenant-a");

    await runtime.deadLetter({
      messageId: "evt-1",
      message,
      attempts: 6,
      error: new Error("ledger unreachable"),
    });

    expect(store.snapshot()).toEqual([
      {
        messageId: "evt-1",
        topic: "orders.order.placed.v1",
        value: message.value,
        headers: message.headers,
        attempts: 6,
        error: "ledger unreachable",
        failedAt: clock.now().toISOString(),
      },
    ]);
    const dead = lines.filter((line) => line.message === "message dead-lettered");
    expect(dead.map((line) => [line.fields["messageId"], line.fields["tenantId"]])).toEqual([
      ["evt-1", "tenant-a"],
    ]);
  });
});
