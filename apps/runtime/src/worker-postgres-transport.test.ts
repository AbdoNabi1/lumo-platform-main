import type { SupervisedConsumer } from "@platform/kafka";
import type { DirectConsumer } from "@platform/messaging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeCore, type RuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";
import { asDirectConsumers, startWorker } from "./worker";

/**
 * `EVENT_TRANSPORT=postgres` is a promise that the worker runs with NO broker. These call the real
 * `startWorker`; the Kafka client it is given fails on anything that would open a connection, so a
 * worker that still reached for the broker fails here instead of hanging on a deploy.
 *
 * The delivery loop itself is replaced by a recorder — it would otherwise poll a database, and its
 * behaviour is covered in `outbox-delivery-runtime.test.ts`. What is pinned here is the wiring:
 * which consumers it is handed, and which health check the worker exposes.
 */
vi.mock("./health-server", () => ({ startHealthServer: () => ({ close: vi.fn() }) }));

const deliveryStarts: { consumers: readonly DirectConsumer[] }[] = [];
vi.mock("./outbox-delivery-runtime", () => ({
  startOutboxDelivery: (_core: RuntimeCore, consumers: readonly DirectConsumer[]) => {
    deliveryStarts.push({ consumers });
    return {
      stop: vi.fn(),
      healthCheck: () => ({ name: "outbox-delivery", probe: async () => undefined }),
    };
  },
}));

const BASE_ENV = {
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  APP_ENV: "local",
} as NodeJS.ProcessEnv;
const POSTGRES_ENV = {
  ...BASE_ENV,
  EVENT_TRANSPORT: "postgres",
  OUTBOX_RELAY_ENABLED: "true",
} as NodeJS.ProcessEnv;

/** A broker that does not exist: building a lazy producer is allowed, using anything is not. */
function coreWithoutBroker(env: NodeJS.ProcessEnv): {
  core: RuntimeCore;
  brokerCalls: string[];
  /** Names of the health checks the WORKER registered (the core's own are not re-run here). */
  workerHealthChecks: string[];
} {
  const brokerCalls: string[] = [];
  const workerHealthChecks: string[] = [];
  const refuse = (what: string) => async (): Promise<never> => {
    brokerCalls.push(what);
    throw new Error(`no broker: ${what}`);
  };
  const core = buildRuntimeCore(loadRuntimeConfig(env));
  return {
    brokerCalls,
    workerHealthChecks,
    core: {
      ...core,
      health: {
        register: (check: { name: string }) => {
          workerHealthChecks.push(check.name);
        },
      },
      kafka: {
        consumer: () => {
          brokerCalls.push("consumer()");
          throw new Error("no broker: consumer()");
        },
        producer: () => ({
          connect: refuse("producer.connect"),
          disconnect: refuse("producer.disconnect"),
          send: refuse("producer.send"),
          on: vi.fn(),
          events: { DISCONNECT: "producer.disconnect" },
        }),
        admin: () => ({ connect: refuse("admin.connect"), disconnect: refuse("admin.disconnect") }),
      },
    } as unknown as RuntimeCore,
  };
}

afterEach(() => {
  deliveryStarts.length = 0;
});

describe("startWorker under EVENT_TRANSPORT=postgres", () => {
  it("boots without touching the broker", async () => {
    const { core, brokerCalls } = coreWithoutBroker(POSTGRES_ENV);

    const supervisor = await startWorker(loadRuntimeConfig(POSTGRES_ENV), core);

    expect(brokerCalls).toEqual([]);
    expect(supervisor.status().every((status) => !status.running)).toBe(true);
    await supervisor.stopAll();
    expect(brokerCalls).toEqual([]);
  });

  it("hands the delivery loop EVERY consumer it registered — none is left deaf", async () => {
    const { core } = coreWithoutBroker(POSTGRES_ENV);

    const supervisor = await startWorker(loadRuntimeConfig(POSTGRES_ENV), core);

    expect(deliveryStarts).toHaveLength(1);
    const handedOver = deliveryStarts[0]?.consumers.map((c) => `${c.consumerGroup}@${c.topic}`);
    const registered = supervisor.status().map((s) => `${s.consumerGroup}@${s.topic}`);
    expect(handedOver).toEqual(registered);
    // The paid-order fan-out and the usage meter are the flows this deployment exists to run.
    expect(handedOver).toEqual(
      expect.arrayContaining([
        "orders.payment-captured@payments.payment_intent.captured.v1",
        "finance.orders-paid@orders.order.paid.v1",
        "loyalty.orders-paid@orders.order.paid.v1",
        "licensing.usage-recorded-consumer@platform.usage.recorded.v1",
      ]),
    );
    await supervisor.stopAll();
  });

  it("exposes the delivery loop's health check, not the Kafka consumers' (which would never be ready)", async () => {
    const { core, workerHealthChecks } = coreWithoutBroker(POSTGRES_ENV);

    await startWorker(loadRuntimeConfig(POSTGRES_ENV), core);

    expect(workerHealthChecks).toEqual(["outbox-delivery"]);
  });

  it("the default transport is unchanged: Kafka consumers start and the delivery loop does not", async () => {
    const started: string[] = [];
    const consumer = {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async ({ topics }: { topics: string[] }) => {
        started.push(...topics);
      }),
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
      ...buildRuntimeCore(loadRuntimeConfig(BASE_ENV)),
      kafka: {
        consumer: () => consumer,
        producer: () => producer,
        admin: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      },
    } as unknown as RuntimeCore;

    const supervisor = await startWorker(loadRuntimeConfig(BASE_ENV), core);

    expect(deliveryStarts).toEqual([]);
    expect(started).toContain("orders.order.paid.v1");
    expect(supervisor.status().every((status) => status.running)).toBe(true);
    await supervisor.stopAll();
  });
});

describe("asDirectConsumers", () => {
  it("refuses, by name, a consumer that has no broker-less delivery", () => {
    const kafkaOnly: SupervisedConsumer = {
      topic: "orders.order.paid.v1",
      consumerGroup: "legacy.kafka-only",
      isRunning: false,
      start: async () => undefined,
      stop: async () => undefined,
    };

    expect(() => asDirectConsumers([kafkaOnly])).toThrow(
      /consumer "legacy\.kafka-only" on "orders\.order\.paid\.v1" has no broker-less delivery/,
    );
  });
});

describe("config: EVENT_TRANSPORT", () => {
  it("defaults to kafka", () => {
    expect(loadRuntimeConfig(BASE_ENV).EVENT_TRANSPORT).toBe("kafka");
  });

  it("refuses postgres with the outbox relay off — nothing would ever be delivered", () => {
    expect(() => loadRuntimeConfig({ ...BASE_ENV, EVENT_TRANSPORT: "postgres" })).toThrow(
      /EVENT_TRANSPORT=postgres requires OUTBOX_RELAY_ENABLED=true/,
    );
  });

  it("refuses postgres with tracking ingest on — the collector bypasses the outbox", () => {
    expect(() => loadRuntimeConfig({ ...POSTGRES_ENV, TRACKING_INGEST_ENABLED: "true" })).toThrow(
      /TRACKING_INGEST_ENABLED=true requires EVENT_TRANSPORT=kafka/,
    );
  });

  it("rejects an unknown transport instead of silently falling back to kafka", () => {
    expect(() => loadRuntimeConfig({ ...BASE_ENV, EVENT_TRANSPORT: "rabbit" })).toThrow();
  });
});
