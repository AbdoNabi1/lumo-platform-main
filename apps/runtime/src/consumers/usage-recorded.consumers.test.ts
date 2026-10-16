import type { IdGenerator } from "@platform/contracts";
import type { IntegrationEvent } from "@platform/domain-events";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { SupervisedConsumer } from "@platform/kafka";
import { USAGE_RECORD_CONSUMER_GROUP, wireLicensing } from "@platform/licensing";
import {
  EventConsumer,
  InMemoryDeadLetterStore,
  InMemoryProcessedEventStore,
  RetryPolicy,
} from "@platform/messaging";
import type { UsageRecord } from "@platform/usage";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeCore } from "../composition";
import { loadRuntimeConfig } from "../config";
import { startWorker } from "../worker";
import {
  buildUsageRecordedConsumerRuntimes,
  LicensingUsageRecordedConsumer,
  PLATFORM_USAGE_RECORDED,
  USAGE_RECORDED_CONSUMER_GROUP,
} from "./usage-recorded.consumers";

// The worker's health surface binds a real TCP port; nothing here exercises it.
vi.mock("../health-server", () => ({ startHealthServer: () => ({ close: vi.fn() }) }));

const WORKER_ENV = {
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  APP_ENV: "local",
} as NodeJS.ProcessEnv;

/** Same reach-in helper the sibling consumer tests use: the runtime exposes no accessor for its deps. */
function runtimeDeps(runtime: SupervisedConsumer): {
  readonly unitOfWork?: unknown;
  readonly handler: { readonly handleAtomic?: unknown };
} {
  return (
    runtime as unknown as {
      deps: { unitOfWork?: unknown; handler: { handleAtomic?: unknown } };
    }
  ).deps;
}

const clock = { now: () => new Date("2026-09-29T10:00:00.000Z") };

function uuidIds(): IdGenerator {
  return { generate: () => crypto.randomUUID() };
}

/** Real Licensing (in-memory) — the consumer is proven against the actual `RecordUsage`, not a mock. */
function licensing() {
  return wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: uuidIds(),
    clock,
  });
}

function usageEvent(
  overrides: {
    messageId?: string;
    envelopeTenant?: string | undefined;
    record?: Partial<UsageRecord>;
  } = {},
): IntegrationEvent<UsageRecord> {
  const envelopeTenant = "envelopeTenant" in overrides ? overrides.envelopeTenant : "tenant-a";
  return {
    messageId: overrides.messageId ?? "11111111-1111-7111-8111-111111111111",
    type: PLATFORM_USAGE_RECORDED,
    eventVersion: 1,
    aggregateId: "tenant-a",
    aggregateType: "usage",
    occurredAt: "2026-09-29T10:00:00.000Z",
    correlationId: "corr-1",
    causationId: "cause-1",
    metadata: {},
    ...(envelopeTenant === undefined ? {} : { tenantId: envelopeTenant }),
    payload: {
      tenant: "tenant-a",
      resource: "PRODUCT",
      amount: 1,
      unit: "count",
      occurredAt: "2026-09-29T10:00:00.000Z",
      metadata: { productId: "p-1" },
      ...overrides.record,
    },
  } as IntegrationEvent<UsageRecord>;
}

async function counterOf(
  app: ReturnType<typeof licensing>,
  tenant: string,
  resource = "PRODUCT",
): Promise<{ amount: number; unit: string } | null> {
  const response = await app.licensing.getUsageCounter({
    tenantRef: tenant,
    resource,
    tenantId: tenant,
  });
  return response.status === 200 ? (response.body as { amount: number; unit: string }) : null;
}

describe("LicensingUsageRecordedConsumer (G-79 link 2)", () => {
  it("subscribes to the canonical platform.usage.recorded event, version 1", () => {
    const consumer = new LicensingUsageRecordedConsumer({ recordUsage: vi.fn() });

    expect(consumer.eventType).toBe("platform.usage.recorded");
    expect(consumer.eventVersion).toBe(1);
  });

  it("turns one event into one increment of that tenant's counter", async () => {
    const app = licensing();
    const consumer = new LicensingUsageRecordedConsumer(app.licensing);

    await consumer.handle(usageEvent());

    expect(await counterOf(app, "tenant-a")).toEqual({ amount: 1, unit: "count" });
  });

  it("passes the event's own id as the recordId and the envelope tenant as both tenant keys", async () => {
    const recordUsage = vi.fn(async () => ({ status: 200, body: { id: "c", duplicate: false } }));
    const consumer = new LicensingUsageRecordedConsumer({ recordUsage });

    await consumer.handle(usageEvent({ messageId: "22222222-2222-7222-8222-222222222222" }));

    expect(recordUsage).toHaveBeenCalledWith({
      recordId: "22222222-2222-7222-8222-222222222222",
      tenantRef: "tenant-a",
      tenantId: "tenant-a",
      resource: "PRODUCT",
      amount: 1,
      unit: "count",
      occurredAt: new Date("2026-09-29T10:00:00.000Z"),
    });
  });

  it("counts a redelivered event once", async () => {
    const app = licensing();
    const consumer = new LicensingUsageRecordedConsumer(app.licensing);
    const event = usageEvent();

    await consumer.handle(event);
    await consumer.handle(event);
    await consumer.handle(event);

    expect(await counterOf(app, "tenant-a")).toEqual({ amount: 1, unit: "count" });
  });

  it("counts two different events twice", async () => {
    const app = licensing();
    const consumer = new LicensingUsageRecordedConsumer(app.licensing);

    await consumer.handle(usageEvent({ messageId: "11111111-1111-7111-8111-111111111111" }));
    await consumer.handle(usageEvent({ messageId: "33333333-3333-7333-8333-333333333333" }));

    expect(await counterOf(app, "tenant-a")).toEqual({ amount: 2, unit: "count" });
  });

  it("keeps two tenants' counters apart", async () => {
    const app = licensing();
    const consumer = new LicensingUsageRecordedConsumer(app.licensing);

    await consumer.handle(
      usageEvent({
        messageId: "11111111-1111-7111-8111-111111111111",
        envelopeTenant: "tenant-a",
        record: { tenant: "tenant-a" },
      }),
    );
    await consumer.handle(
      usageEvent({
        messageId: "44444444-4444-7444-8444-444444444444",
        envelopeTenant: "tenant-b",
        record: { tenant: "tenant-b" },
      }),
    );
    await consumer.handle(
      usageEvent({
        messageId: "55555555-5555-7555-8555-555555555555",
        envelopeTenant: "tenant-b",
        record: { tenant: "tenant-b" },
      }),
    );

    expect(await counterOf(app, "tenant-a")).toEqual({ amount: 1, unit: "count" });
    expect(await counterOf(app, "tenant-b")).toEqual({ amount: 2, unit: "count" });
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
  ] as const)(
    "throws to the DLQ, counting nothing, on an %s envelope tenant",
    async (_n, tenant) => {
      const recordUsage = vi.fn();
      const consumer = new LicensingUsageRecordedConsumer({ recordUsage });

      await expect(consumer.handle(usageEvent({ envelopeTenant: tenant }))).rejects.toThrow(
        /tenant/i,
      );

      expect(recordUsage).not.toHaveBeenCalled();
    },
  );

  it("throws when the payload names a different tenant than the envelope, counting nothing", async () => {
    // The envelope is the authority (ADR-0014). A payload that disagrees is inconsistent or forged,
    // and must not be allowed to credit either tenant.
    const recordUsage = vi.fn();
    const consumer = new LicensingUsageRecordedConsumer({ recordUsage });

    await expect(
      consumer.handle(usageEvent({ envelopeTenant: "tenant-a", record: { tenant: "tenant-b" } })),
    ).rejects.toThrow(/tenant/i);

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it.each([
    ["a negative amount", { amount: -1 }],
    ["an empty unit", { unit: " " }],
    ["a non-finite amount", { amount: Number.NaN }],
  ] as const)("throws on a record with %s, counting nothing", async (_n, record) => {
    const recordUsage = vi.fn();
    const consumer = new LicensingUsageRecordedConsumer({ recordUsage });

    await expect(consumer.handle(usageEvent({ record }))).rejects.toThrow(/invalid usage record/i);

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("throws when Licensing refuses the record, so the message reaches retry/DLQ rather than being acked", async () => {
    const recordUsage = vi.fn(async () => ({
      status: 409,
      body: { error: { code: "BUSINESS_RULE" } },
    }));
    const consumer = new LicensingUsageRecordedConsumer({ recordUsage });

    await expect(consumer.handle(usageEvent())).rejects.toThrow(/409/);
  });

  it("refuses a record in a different unit than the counter holds, leaving the total unchanged", async () => {
    const app = licensing();
    const consumer = new LicensingUsageRecordedConsumer(app.licensing);
    await consumer.handle(usageEvent());

    await expect(
      consumer.handle(
        usageEvent({
          messageId: "66666666-6666-7666-8666-666666666666",
          record: { unit: "gb" },
        }),
      ),
    ).rejects.toThrow();

    expect(await counterOf(app, "tenant-a")).toEqual({ amount: 1, unit: "count" });
  });
});

describe("consumer groups: the kernel's inbox key vs RecordUsage's own marker key", () => {
  it("are different names", () => {
    expect(USAGE_RECORD_CONSUMER_GROUP).toBe("licensing.usage-record");
    expect(USAGE_RECORDED_CONSUMER_GROUP).toBe("licensing.usage-recorded-consumer");
    expect(USAGE_RECORDED_CONSUMER_GROUP).not.toBe(USAGE_RECORD_CONSUMER_GROUP);
  });

  it("holds for the runtime actually built, not only for the constants", () => {
    // Guards a hard-coded group in the builder as well as a changed constant: what the kernel really
    // keys its inbox marker by is the runtime's own consumerGroup.
    const core = buildRuntimeCore(loadRuntimeConfig(WORKER_ENV));

    const [runtime, ...rest] = buildUsageRecordedConsumerRuntimes(core, core.metrics);

    expect(rest).toEqual([]);
    expect(runtime?.consumerGroup).toBe(USAGE_RECORDED_CONSUMER_GROUP);
    expect(runtime?.consumerGroup).not.toBe(USAGE_RECORD_CONSUMER_GROUP);
    expect(runtime?.topic).toBe("platform.usage.recorded.v1");
  });

  it("is built self-idempotent: no unitOfWork and no handleAtomic, RecordUsage owns its dedup", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(WORKER_ENV));

    const [runtime] = buildUsageRecordedConsumerRuntimes(core, core.metrics);

    const deps = runtime === undefined ? undefined : runtimeDeps(runtime);
    expect(deps?.unitOfWork).toBeUndefined();
    expect(deps?.handler.handleAtomic).toBeUndefined();
  });
});

describe("a refused usage record reaches the DLQ (never acked as done)", () => {
  const serializer = new InMemoryEventSerializer();
  const silent = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => silent,
  };

  function incoming(event: IntegrationEvent<UsageRecord>) {
    const serialized = serializer.serialize(event);
    return {
      topic: "platform.usage.recorded.v1",
      key: event.aggregateId,
      value: serialized.data,
      headers: {
        type: serialized.type,
        eventVersion: String(serialized.eventVersion),
        contentType: serialized.contentType,
      },
    };
  }

  it("retries a unit-mismatched record maxAttempts times, dead-letters it, and counts nothing", async () => {
    const app = licensing();
    const recordUsage = vi.spyOn(app.licensing, "recordUsage");
    const deadLetters = new InMemoryDeadLetterStore();
    const processedEvents = new InMemoryProcessedEventStore();
    const kernel = new EventConsumer(new LicensingUsageRecordedConsumer(app.licensing), {
      serializer,
      processedEvents,
      deadLetters,
      retryPolicy: new RetryPolicy({ maxAttempts: 3, baseDelayMs: 0, factor: 1, maxDelayMs: 0 }),
      clock,
      logger: silent,
      sleep: async () => {},
    });
    const good = usageEvent({ messageId: "11111111-1111-7111-8111-111111111111" });
    const mismatched = usageEvent({
      messageId: "66666666-6666-7666-8666-666666666666",
      record: { unit: "gb" },
    });

    await kernel.consume(incoming(good));
    await kernel.consume(incoming(mismatched));

    expect(recordUsage).toHaveBeenCalledTimes(1 + 3); // one good delivery, then 3 attempts at the bad one
    const [entry, ...others] = deadLetters.snapshot();
    expect(others).toEqual([]);
    expect(entry?.messageId).toBe("66666666-6666-7666-8666-666666666666");
    expect(entry?.attempts).toBe(3);
    expect(entry?.error).toMatch(/409/);
    // Not acked as done: the kernel never marked the refused message processed...
    expect(await processedEvents.has("66666666-6666-7666-8666-666666666666")).toBe(false);
    // ...and Licensing kept the counter it had.
    expect(await counterOf(app, "tenant-a")).toEqual({ amount: 1, unit: "count" });
  });
});

describe("startWorker — usage-recorded registration (G-79 link 2)", () => {
  it("registers the licensing usage consumer group alongside the existing fleet", async () => {
    const consumer = {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
      run: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };
    const producer = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
      on: vi.fn(),
      events: { DISCONNECT: "producer.disconnect" },
    };
    const core = {
      ...buildRuntimeCore(loadRuntimeConfig(WORKER_ENV)),
      kafka: {
        consumer: () => consumer,
        producer: () => producer,
        admin: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      },
    } as unknown as ReturnType<typeof buildRuntimeCore>;

    const supervisor = await startWorker(loadRuntimeConfig(WORKER_ENV), core);

    const groups = supervisor.status().map((status) => status.consumerGroup);
    expect(groups).toContain(USAGE_RECORDED_CONSUMER_GROUP);
    expect(groups).toContain("finance.orders-paid");
    await supervisor.stopAll();
  });
});
