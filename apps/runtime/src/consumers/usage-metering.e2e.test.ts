import { createAdminHttpApi } from "@platform/admin";
import { wireCatalog } from "@platform/catalog";
import type {
  AuthenticatedIdentity,
  Authenticator,
  Cache,
  IdGenerator,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing } from "@platform/licensing";
import type { PublishRecord } from "@platform/messaging";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LicensingUsageRecordedConsumer } from "./usage-recorded.consumers";

/**
 * G-79 links 1-4, joined. The acceptance test for the slice: nothing else proves the four links are
 * actually wired to each other rather than each being correct in isolation.
 *
 *   CreateProduct (Catalog)                      link 1: writes a UsageRecord in the product's transaction
 *     -> outbox -> relay -> bus                  the transport (in-memory here, Kafka in production)
 *     -> LicensingUsageRecordedConsumer          link 2: the runtime consumer
 *     -> LicensingController.recordUsage         link 3: Licensing's existing writer
 *     -> UsageCounter                            link 4: the projection
 *     -> GET /api/v1/usage-counters (admin HTTP) the read that must return a real number
 *
 * The product is created through Catalog's own controller rather than `POST /products` because the
 * admin HTTP app owns its own private in-memory outbox and never relays it; the read side, which is
 * the acceptance criterion, does go through the real HTTP route and the real admin controller.
 */
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock = { now: () => new Date("2026-09-29T10:00:00.000Z") };
const serializer = new InMemoryEventSerializer();
const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function stack() {
  const licensing = wireLicensing({ serializer, idGenerator, clock });
  const consumer = new LicensingUsageRecordedConsumer(licensing.licensing);
  const delivered: PublishRecord[] = [];
  const catalog = wireCatalog({
    serializer,
    idGenerator,
    clock,
    onUsageRecorded: async (record) => {
      delivered.push(record);
      await consumer.handle(deserialize(record));
    },
  });

  const cache: Cache = {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
    has: async () => false,
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key) => ({ key, token: "t", release: async () => true }),
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  const app = await createAdminHttpApi({
    serializer,
    idGenerator,
    clock,
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    licensing,
  });
  apps.push(app);

  const createProduct = (tenantId: string, sku: string, variants = 1) =>
    catalog.products.create({
      sku,
      name: `Product ${sku}`,
      slug: sku.toLowerCase(),
      variants: Array.from({ length: variants }, (_, i) => ({
        sku: `${sku}-V${i}`,
        priceAmountMinor: 1000,
        currency: "USD",
      })),
      tenantId,
    });

  const usageCounter = async (tenant: string, resource = "PRODUCT") => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/usage-counters?tenantRef=${tenant}&resource=${resource}`,
      headers: { authorization: "Bearer good", "x-tenant-id": tenant },
    });
    return { status: res.statusCode, body: res.json() as { amount: number; unit: string } };
  };

  return { catalog, consumer, delivered, createProduct, usageCounter };
}

function deserialize(record: PublishRecord) {
  return serializer.deserialize<never>({
    type: record.headers["type"] ?? "",
    eventVersion: Number(record.headers["eventVersion"] ?? "1"),
    contentType: record.headers["contentType"] ?? serializer.contentType,
    data: record.value,
  });
}

describe("usage metering, end to end (G-79 links 1-4)", () => {
  it("creating a product makes GET /usage-counters return 1", async () => {
    const { catalog, createProduct, usageCounter } = await stack();

    expect((await usageCounter("t-1")).body.amount).toBe(0);

    const created = await createProduct("t-1", "SKU-1");
    expect(created.status).toBe(201);
    await catalog.drainOutbox();

    const counter = await usageCounter("t-1");
    expect(counter.status).toBe(200);
    expect(counter.body).toEqual({ amount: 1, unit: "count" });
  });

  it("counts every product a tenant creates", async () => {
    const { catalog, createProduct, usageCounter } = await stack();

    await createProduct("t-1", "SKU-1");
    await createProduct("t-1", "SKU-2");
    await createProduct("t-1", "SKU-3");
    await catalog.drainOutbox();

    expect((await usageCounter("t-1")).body.amount).toBe(3);
  });

  it("does not count a product whose creation failed", async () => {
    const { catalog, createProduct, usageCounter } = await stack();

    const refused = await createProduct("t-1", "SKU-1", 0);
    expect(refused.status).toBe(422);
    await catalog.drainOutbox();

    expect((await usageCounter("t-1")).body).toEqual({ amount: 0, unit: "" });
  });

  it("keeps two tenants' counters apart", async () => {
    const { catalog, createProduct, usageCounter } = await stack();

    await createProduct("t-1", "SKU-1");
    await createProduct("t-2", "SKU-2");
    await createProduct("t-2", "SKU-3");
    await catalog.drainOutbox();

    expect((await usageCounter("t-1")).body.amount).toBe(1);
    expect((await usageCounter("t-2")).body.amount).toBe(2);
  });

  it("counts a redelivered event once", async () => {
    const { catalog, consumer, delivered, createProduct, usageCounter } = await stack();

    await createProduct("t-1", "SKU-1");
    await catalog.drainOutbox();
    expect(delivered).toHaveLength(1);

    // Kafka is at-least-once: the same message arrives again.
    await consumer.handle(deserialize(delivered[0] as PublishRecord));
    await consumer.handle(deserialize(delivered[0] as PublishRecord));

    expect((await usageCounter("t-1")).body.amount).toBe(1);
  });
});
