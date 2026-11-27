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

const retrySweepStarts: { sweep: () => Promise<unknown>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock("./delivery-retry-runtime", () => ({
  startDeliveryRetrySweep: (_core: RuntimeCore, sweep: () => Promise<unknown>) => {
    const start = { sweep, stop: vi.fn() };
    retrySweepStarts.push(start);
    return { stop: start.stop };
  },
}));

const retentionStarts: { run: () => Promise<unknown>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock("./tracking-retention-runtime", () => ({
  startTrackingRetention: (_core: RuntimeCore, run: () => Promise<unknown>) => {
    const start = { run, stop: vi.fn() };
    retentionStarts.push(start);
    return { stop: start.stop };
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
  retrySweepStarts.length = 0;
  retentionStarts.length = 0;
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

describe("tracking delivery retry sweeper (P1-D2) under EVENT_TRANSPORT=postgres", () => {
  const TRACKING_ENV = { ...POSTGRES_ENV, TRACKING_INGEST_ENABLED: "true" } as NodeJS.ProcessEnv;

  it("starts the sweeper beside the outbox delivery loop when tracking ingest is on", async () => {
    const { core, brokerCalls } = coreWithoutBroker(TRACKING_ENV);

    const supervisor = await startWorker(loadRuntimeConfig(TRACKING_ENV), core);

    expect(retrySweepStarts).toHaveLength(1);
    expect(typeof retrySweepStarts[0]?.sweep).toBe("function");
    expect(deliveryStarts).toHaveLength(1);
    // the tracking consumer reaches the delivery loop too, so the sweeper's parked rows have a producer
    expect(deliveryStarts[0]?.consumers.map((c) => c.consumerGroup)).toContain("tracking.ingest");
    expect(brokerCalls).toEqual([]);
    await supervisor.stopAll();
  });

  it("does not start (and never reads the table) when tracking ingest is off", async () => {
    const { core } = coreWithoutBroker(POSTGRES_ENV);

    const supervisor = await startWorker(loadRuntimeConfig(POSTGRES_ENV), core);

    expect(retrySweepStarts).toEqual([]);
    await supervisor.stopAll();
  });

  it("is stopped with the worker", async () => {
    const { core } = coreWithoutBroker(TRACKING_ENV);
    const handlers = new Map<string, () => void>();
    const once = vi.spyOn(process, "once").mockImplementation(((event: string, fn: () => void) => {
      handlers.set(event, fn);
      return process;
    }) as never);
    try {
      const supervisor = await startWorker(loadRuntimeConfig(TRACKING_ENV), core);
      handlers.get("SIGTERM")?.();
      await vi.waitFor(() => expect(retrySweepStarts[0]?.stop).toHaveBeenCalledTimes(1));
      await supervisor.stopAll();
    } finally {
      once.mockRestore();
    }
  });

  it("starts the privacy retention pass with the worker when tracking ingest is on, and stops it with it", async () => {
    const { core } = coreWithoutBroker(TRACKING_ENV);
    const handlers = new Map<string, () => void>();
    const once = vi.spyOn(process, "once").mockImplementation(((event: string, fn: () => void) => {
      handlers.set(event, fn);
      return process;
    }) as never);
    try {
      const supervisor = await startWorker(loadRuntimeConfig(TRACKING_ENV), core);
      expect(retentionStarts).toHaveLength(1);
      expect(typeof retentionStarts[0]?.run).toBe("function");
      handlers.get("SIGTERM")?.();
      await vi.waitFor(() => expect(retentionStarts[0]?.stop).toHaveBeenCalledTimes(1));
      await supervisor.stopAll();
    } finally {
      once.mockRestore();
    }
  });

  it("does not start the retention pass (and never reads the tables) when tracking ingest is off", async () => {
    const { core } = coreWithoutBroker(POSTGRES_ENV);
    const supervisor = await startWorker(loadRuntimeConfig(POSTGRES_ENV), core);
    expect(retentionStarts).toEqual([]);
    await supervisor.stopAll();
  });

  it("config: the sweep interval defaults to a minute and refuses a busy loop", () => {
    expect(loadRuntimeConfig(BASE_ENV).TRACKING_RETRY_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(() =>
      loadRuntimeConfig({ ...BASE_ENV, TRACKING_RETRY_SWEEP_INTERVAL_MS: "10" }),
    ).toThrow();
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

  it("accepts postgres with tracking ingest on — the runtime API appends events to the outbox (P1-D1)", () => {
    const config = loadRuntimeConfig({ ...POSTGRES_ENV, TRACKING_INGEST_ENABLED: "true" });
    expect(config.EVENT_TRANSPORT).toBe("postgres");
    expect(config.TRACKING_INGEST_ENABLED).toBe(true);
  });

  it("TRACKING_EDGE_SECRET is optional and needs at least 32 characters when present", () => {
    expect(loadRuntimeConfig(BASE_ENV).TRACKING_EDGE_SECRET).toBeUndefined();
    expect(() => loadRuntimeConfig({ ...BASE_ENV, TRACKING_EDGE_SECRET: "too-short" })).toThrow();
    const secret = "edge-secret-".padEnd(40, "x");
    expect(
      loadRuntimeConfig({ ...BASE_ENV, TRACKING_EDGE_SECRET: secret }).TRACKING_EDGE_SECRET,
    ).toBe(secret);
  });

  it("rejects an unknown transport instead of silently falling back to kafka", () => {
    expect(() => loadRuntimeConfig({ ...BASE_ENV, EVENT_TRANSPORT: "rabbit" })).toThrow();
  });
});
