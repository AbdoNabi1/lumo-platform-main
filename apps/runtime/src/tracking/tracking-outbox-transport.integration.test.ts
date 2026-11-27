import { PrismaOutboxDeliveryQueue, PrismaOutboxEventPublisher, runReadScoped } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import type { Kafka } from "@platform/kafka";
import { OutboxDeliveryRelay } from "@platform/messaging";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeCore, buildTrackingIngestRuntime, type RuntimeCore } from "../composition";
import { loadRuntimeConfig } from "../config";
import { asDirectConsumers } from "../worker";
import { routeRecord } from "./testing/captured-event-fixture";
import { PrismaTrackingRegistryStore } from "./tracking-registry";
import { seedTrackingRegistry } from "./tracking-registry-seed";

/**
 * Tracking P1-D1 against a real PostgreSQL: the capture route's outbox append, the Postgres relay
 * (`PrismaOutboxDeliveryQueue`) and the REAL ingest consumer (`buildTrackingIngestRuntime`, the one the
 * worker registers) end as a `tracking_event_records` row — with a Kafka client that throws on any use.
 * Needs a migrated test database; skipped otherwise (the in-memory sibling,
 * `tracking-outbox-transport.test.ts`, covers the same chain without one):
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the schema, not yet executed against a database (none is reachable from the
 * authoring environment) — the first run on a real database is the proof.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const ENV = {
  DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  APP_ENV: "local",
  EVENT_TRANSPORT: "postgres",
  OUTBOX_RELAY_ENABLED: "true",
  TRACKING_INGEST_ENABLED: "true",
} as NodeJS.ProcessEnv;

/** A broker that does not exist: building a lazy producer is allowed, using anything is not. */
const inertKafka = {
  consumer: () => {
    throw new Error("no broker: consumer()");
  },
  producer: () => ({
    connect: vi.fn().mockRejectedValue(new Error("no broker")),
    disconnect: vi.fn(),
    send: vi.fn().mockRejectedValue(new Error("no broker")),
    on: vi.fn(),
    events: { DISCONNECT: "producer.disconnect" },
  }),
} as unknown as Kafka;

describe.runIf(Boolean(databaseUrl))("tracking over the Postgres outbox (integration)", () => {
  it("outbox row → relay → ingest consumer → tracking_event_records row", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const tenantId = `tenant-itest-tracking-${suffix}`;
    const eventId = `evt-${suffix}`;
    const messageId = crypto.randomUUID();
    try {
      const base = buildRuntimeCore(loadRuntimeConfig(ENV));
      const core = { ...base, prisma, kafka: inertKafka } as unknown as RuntimeCore;
      await seedTrackingRegistry({
        store: new PrismaTrackingRegistryStore(prisma, core.idGenerator),
        tenantId,
        at: new Date(),
      });
      const consumer = buildTrackingIngestRuntime(core);
      expect(consumer).not.toBeNull();

      // The capture route's append, then the worker's relay pass.
      await new PrismaOutboxEventPublisher(prisma).publish(
        routeRecord(tenantId, eventId, messageId),
      );
      const relay = new OutboxDeliveryRelay({
        queue: new PrismaOutboxDeliveryQueue(prisma),
        consumers: asDirectConsumers([consumer!]),
        clock: core.clock,
        logger: core.logger,
        retryDelaysMs: [5_000],
        batchSize: 500,
      });
      await relay.drainOnce();

      const record = await runReadScoped(prisma, tenantId, (tx) =>
        tx.trackingEventRecord.findFirst({ where: { tenantId, eventId } }),
      );
      expect(record).not.toBeNull();
      expect(record?.eventName).toBe("page_view");
      const row = await runReadScoped(prisma, tenantId, (tx) =>
        tx.outboxEntry.findFirst({ where: { id: messageId } }),
      );
      expect(row?.status).toBe("published");
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);
});
