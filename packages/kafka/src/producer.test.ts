import { describe, expect, it } from "vitest";
import type { Kafka, Producer } from "kafkajs";
import { KafkaMessageProducer } from "./producer";

/**
 * H-07: `isConnected` is what the collector's new health probe (apps/collector/src/main.ts) reads to
 * decide `/readyz`. A fake kafkajs `Producer` that records its registered listeners lets the test
 * simulate a broker-side drop (the `DISCONNECT` event) without a real broker.
 */
function fakeKafka(): { kafka: Kafka; emitDisconnect: () => void; connectCalls: number } {
  let connectCalls = 0;
  let disconnectListener: (() => void) | null = null;
  const producer: Partial<Producer> = {
    events: { CONNECT: "producer.connect", DISCONNECT: "producer.disconnect" } as never,
    connect: async () => {
      connectCalls += 1;
    },
    disconnect: async () => {},
    on: ((eventName: string, listener: () => void) => {
      if (eventName === "producer.disconnect") disconnectListener = listener;
      return () => {};
    }) as Producer["on"],
  };
  const kafka: Partial<Kafka> = {
    producer: () => producer as Producer,
  };
  return {
    kafka: kafka as Kafka,
    emitDisconnect: () => disconnectListener?.(),
    get connectCalls() {
      return connectCalls;
    },
  };
}

describe("KafkaMessageProducer.isConnected (H-07)", () => {
  it("is false before connect() and true after", async () => {
    const { kafka } = fakeKafka();
    const producer = new KafkaMessageProducer(kafka);

    expect(producer.isConnected).toBe(false);
    await producer.connect();
    expect(producer.isConnected).toBe(true);
  });

  it("becomes false after an explicit disconnect()", async () => {
    const { kafka } = fakeKafka();
    const producer = new KafkaMessageProducer(kafka);

    await producer.connect();
    await producer.disconnect();
    expect(producer.isConnected).toBe(false);
  });

  it("becomes false when the underlying kafkajs producer reports a broker-side DISCONNECT — the case a naive 'connect() was called once' flag would miss", async () => {
    const { kafka, emitDisconnect } = fakeKafka();
    const producer = new KafkaMessageProducer(kafka);

    await producer.connect();
    expect(producer.isConnected).toBe(true);

    emitDisconnect();

    expect(producer.isConnected).toBe(false);
  });
});
