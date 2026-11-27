import { PrismaOutboxEventPublisher } from "@platform/db";
import { KafkaMessageProducer } from "@platform/kafka";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeCore } from "../composition";
import { buildTrackingEventSink } from "./tracking-event-sink";

function core(transport: "kafka" | "postgres") {
  const producer = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    events: { DISCONNECT: "producer.disconnect" },
  };
  const outboxInserts: unknown[] = [];
  const tx = {
    $executeRaw: () => Promise.resolve(1),
    outboxEntry: {
      createMany: (args: unknown) => {
        outboxInserts.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return {
    producer,
    outboxInserts,
    core: {
      config: { EVENT_TRANSPORT: transport },
      prisma: { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
      kafka: { producer: () => producer },
      clock: { now: () => new Date("2026-11-27T12:00:00.000Z") },
    } as unknown as RuntimeCore,
  };
}

const RECORD = {
  topic: "tracking.event.captured.v1",
  key: "shop-1",
  value: new Uint8Array([1, 2, 3]),
  headers: { messageId: "0192f0aa-0000-7000-8000-000000000001", tenantId: "shop-1" },
};

describe("buildTrackingEventSink (P1-D1)", () => {
  it("under EVENT_TRANSPORT=postgres appends to the outbox and never touches the broker", async () => {
    const { core: postgres, producer, outboxInserts } = core("postgres");

    const sink = buildTrackingEventSink(postgres);
    expect(sink).toBeInstanceOf(PrismaOutboxEventPublisher);
    await sink.publish(RECORD);

    expect(outboxInserts).toHaveLength(1);
    expect(outboxInserts[0]).toMatchObject({
      data: [
        {
          id: RECORD.headers.messageId,
          topic: "tracking.event.captured.v1",
          key: "shop-1",
          tenantId: "shop-1",
          status: "pending",
        },
      ],
    });
    expect(producer.connect).not.toHaveBeenCalled();
    expect(producer.send).not.toHaveBeenCalled();
  });

  it("under EVENT_TRANSPORT=kafka publishes to the broker, unchanged, and writes no outbox row", async () => {
    const { core: kafka, producer, outboxInserts } = core("kafka");

    const sink = buildTrackingEventSink(kafka);
    expect(sink).toBeInstanceOf(KafkaMessageProducer);
    // Building it opened nothing; the first publish connects and sends to the topic.
    expect(producer.connect).not.toHaveBeenCalled();
    await sink.publish(RECORD);

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "tracking.event.captured.v1",
        messages: [expect.objectContaining({ key: "shop-1" })],
      }),
    );
    expect(outboxInserts).toEqual([]);
  });
});
