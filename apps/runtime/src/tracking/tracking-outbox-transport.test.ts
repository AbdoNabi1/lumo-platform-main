import type { Clock } from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
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
  type RecordingRuntimeDeps,
} from "@platform/tracking";
import type { Logger } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { TrackingIngestHandler } from "./tracking-ingest";
import { FIXTURE_NOW, routeRecord, toEntry } from "./testing/captured-event-fixture";

/**
 * Tracking P1-D1, proven without a database or a broker: what the capture route hands the sink is
 * delivered by the Postgres relay to the REAL `KafkaConsumerRuntime` + `TrackingIngestHandler` (the
 * classes the worker registers) and ends as a tracking event record. The Kafka client handed to the
 * runtime throws on any use, and the relay's consumer is the one the worker would hand over.
 * (`tracking-outbox-transport.integration.test.ts` runs the same path on a real database.)
 */

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

/** An ingest engine over in-memory ports: no destinations, so the event is recorded and routed nowhere. */
function ingestDeps(records: EventRecordWriterPort): IngestRuntimeDeps {
  const recording: RecordingRuntimeDeps = {
    delivery: {} as RecordingRuntimeDeps["delivery"],
    records,
    hasher: { sha256Hex: async () => "digest" },
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
    destinations: { resolve: () => null, resolveVersion: () => null, listActive: () => [] },
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
    hasher: { sha256Hex: async () => "digest" },
    clock,
  };
}

function stack() {
  const appended: EventRecord[] = [];
  const records: EventRecordWriterPort = {
    append: async (record) => {
      appended.push(record);
    },
    appendHistory: async () => undefined,
  };
  const deadLetters = new InMemoryDeadLetterStore();
  const handler = new TrackingIngestHandler({
    ingest: async () => ingestDeps(records),
    deadLetters,
    logger: silentLogger,
    clock,
  });
  const consumer = new KafkaConsumerRuntime({
    kafka: noBroker,
    handler,
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
    retryDelaysMs: [5_000, 30_000],
  });
  return { appended, deadLetters, handler, queue, relay, consumer };
}

describe("tracking events over the Postgres outbox transport (P1-D1)", () => {
  it("the ingest consumer subscribes to the topic the capture route appends", () => {
    const { consumer } = stack();
    expect(consumer.topic).toBe("tracking.event.captured.v1");
  });

  it("outbox row → relay → ingest consumer → one event record, with no broker involved", async () => {
    const { appended, handler, queue, relay } = stack();
    queue.enqueue([
      toEntry(routeRecord("shop-1", "evt-0001", "0192f0aa-0000-7000-8000-000000000001")),
    ]);

    const report = await relay.drainOnce();

    expect(report).toMatchObject({ delivered: 1, deferred: 0, deadLettered: 0, unrouted: 0 });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      eventId: "evt-0001",
      tenantId: "shop-1",
      eventName: "page_view",
    });
    expect(handler.counters()).toMatchObject({ received: 1, accepted: 1, refused: 0 });
  });

  it("a redelivered row (same message id) is absorbed by the consumer's inbox: still one record", async () => {
    const { appended, queue, relay } = stack();
    const record = routeRecord("shop-1", "evt-0002", "0192f0aa-0000-7000-8000-000000000002");
    queue.enqueue([toEntry(record)]);
    await relay.drainOnce();

    // The relay crashed after the effect and before marking the row: the same row comes round again.
    queue.enqueue([{ ...toEntry(record), id: "0192f0aa-0000-7000-8000-000000000099" }]);
    const second = await relay.drainOnce();

    expect(second.delivered).toBe(1);
    expect(appended).toHaveLength(1);
  });

  it("a row for another tenant is filed under that tenant", async () => {
    const { appended, queue, relay } = stack();
    queue.enqueue([
      toEntry(routeRecord("shop-1", "evt-0003", "0192f0aa-0000-7000-8000-000000000003")),
      toEntry(routeRecord("shop-2", "evt-0004", "0192f0aa-0000-7000-8000-000000000004")),
    ]);

    await relay.drainOnce();

    expect(appended.map((r) => `${r.tenantId}:${r.eventId}`)).toEqual([
      "shop-1:evt-0003",
      "shop-2:evt-0004",
    ]);
  });

  it("a malformed event is dead-lettered by the consumer, not retried forever", async () => {
    const { appended, handler, queue, relay } = stack();
    const record = routeRecord("shop-1", "evt-0005", "0192f0aa-0000-7000-8000-000000000005");
    // Same row, but the payload's own tenancy disagrees with the envelope tenant (G-64).
    const forged = JSON.parse(new TextDecoder().decode(record.value)) as {
      payload: { envelope: { tenancy: { tenantId: string } } };
    };
    forged.payload.envelope.tenancy.tenantId = "shop-victim";
    queue.enqueue([
      toEntry({ ...record, value: new TextEncoder().encode(JSON.stringify(forged)) }),
    ]);

    const report = await relay.drainOnce();

    expect(report.delivered).toBe(1);
    expect(handler.counters()).toMatchObject({ refused: 1, deadLettered: 1 });
    expect(appended).toEqual([]); // refused before any record is written
  });
});
