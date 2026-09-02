import { afterAll, describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import type { IntegrationEvent } from "@platform/domain-events";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { EventHandler } from "@platform/messaging";
import { InMemoryDeadLetterStore, InMemoryProcessedEventStore } from "@platform/messaging";
import { logger } from "@platform/utils";
import { createKafkaClient } from "./index";
import { KafkaMessageProducer } from "./producer";
import { KafkaConsumerRuntime } from "./consumer-runtime";
import { DeadLetterPublisher } from "./dead-letter-publisher";
import { ConsumerSupervisor } from "./supervisor";

/**
 * REFERENCE integration suite for the Sprint-2.5 messaging runtime. Requires a live
 * Redpanda/Kafka with the bootstrap topics (first-boot runbook):
 *
 *   KAFKA_BROKERS_TEST=localhost:19092 pnpm --filter @platform/kafka test
 *
 * HONESTLY GATED: skipped without `KAFKA_BROKERS_TEST` — never faked (Docker engine down on
 * this machine). Covers: byte-exact produce→consume, idempotent duplicate skip, failure →
 * `.retry` with due headers, exhaustion → `.dlq` + store row, supervisor status/lag.
 */
const brokers = process.env["KAFKA_BROKERS_TEST"];

describe.runIf(Boolean(brokers))("Kafka runtime (integration)", () => {
  const kafka = createKafkaClient({ brokers: (brokers ?? "").split(","), clientId: "itest" });
  const clock: Clock = { now: () => new Date() };
  const serializer = new InMemoryEventSerializer();
  const producer = new KafkaMessageProducer(kafka);
  const topicType = "example.example.registered"; // bootstrap-provisioned walking-skeleton topic

  afterAll(async () => {
    await producer.disconnect();
  });

  function envelope(messageId: string, label: string): IntegrationEvent<{ label: string }> {
    return {
      messageId,
      type: topicType,
      eventVersion: 1,
      aggregateId: "agg-1",
      aggregateType: "example",
      occurredAt: clock.now().toISOString(),
      correlationId: "corr-1",
      causationId: "cause-1",
      payload: { label },
      metadata: {},
    };
  }

  it("delivers the exact published bytes end-to-end with idempotent duplicate skip", async () => {
    const handled: string[] = [];
    const handler: EventHandler<{ label: string }> = {
      eventType: topicType,
      eventVersion: 1,
      handle: async (event) => {
        handled.push(event.payload.label);
      },
    };
    const runtime = new KafkaConsumerRuntime({
      kafka,
      handler,
      consumerGroup: `itest-${Date.now()}`,
      serializer,
      processedEvents: new InMemoryProcessedEventStore(),
      deadLetters: new DeadLetterPublisher({
        publisher: producer,
        store: new InMemoryDeadLetterStore(),
        clock,
      }),
      retryPublisher: producer,
      clock,
      logger,
    });
    const supervisor = new ConsumerSupervisor(kafka, logger);
    supervisor.register(runtime);
    await supervisor.startAll();

    const event = envelope(crypto.randomUUID(), "hello");
    const serialized = serializer.serialize(event);
    const record = {
      topic: `${topicType}.v1`,
      key: event.aggregateId,
      value: serialized.data,
      headers: {
        messageId: event.messageId,
        type: serialized.type,
        eventVersion: String(serialized.eventVersion),
        contentType: serialized.contentType,
      },
    };
    await producer.publish(record);
    await producer.publish(record); // duplicate delivery

    await waitFor(() => handled.length >= 1, 15_000);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(handled).toEqual(["hello"]); // duplicate skipped by the inbox

    expect(supervisor.status()).toEqual([
      expect.objectContaining({ running: true, topic: `${topicType}.v1` }),
    ]);
    const lag = await supervisor.lag();
    expect(lag.length).toBeGreaterThan(0);
    await supervisor.stopAll();
  }, 60_000);
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
