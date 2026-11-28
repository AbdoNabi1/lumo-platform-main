import { createTestPrismaClient, runWithRlsEnforced } from "@platform/db/testing";
import type { Database, TransactionClient } from "@platform/db";
import { businessEventId, businessMessageId } from "@platform/tracking";
import { describe, expect, it } from "vitest";

import { PrismaAttributionSnapshotStore } from "./prisma-attribution-snapshot-store";
import { PrismaOrderTrackingReader, readOrderTrackingModel } from "./prisma-order-tracking-reader";
import { PrismaServerPurchaseRecords } from "./prisma-server-purchase-records";
import { PrismaStoreUrlResolver } from "./prisma-store-url-resolver";

/**
 * Tracking P2 Task 4 against a real PostgreSQL: the order read model, the cancel guard's record lookup and the store
 * url. Needs a database migrated through the current migrations; skipped otherwise:
 *
 *   DATABASE_URL_TEST=postgresql://user:***@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 *
 * NOTE: written against the schema, not executed against a database from the authoring environment (none is
 * reachable) — CI's db-integration job is the first run. Watch the JSON-path filter of the purchase lookup and the
 * RLS refusals first.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const NOW = new Date();
const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";

const TABLES = [
  { schema: "orders", table: "orders" },
  { schema: "orders", table: "order_items" },
  { schema: "orders", table: "order_shipping_addresses" },
  { schema: "identity", table: "customers" },
  { schema: "tracking", table: "attribution_snapshots" },
] as const;

interface Seeded {
  readonly orderId: string;
  readonly customerId: string;
  readonly checkoutRef: string;
}

async function scoped<T>(
  prisma: Database,
  tenantId: string,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

async function seedOrder(prisma: Database, tenantId: string): Promise<Seeded> {
  const orderId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const checkoutRef = `chk-${crypto.randomUUID()}`;
  await scoped(prisma, tenantId, async (tx) => {
    await tx.customer.create({
      data: {
        id: customerId,
        tenantId,
        email: `mona-${customerId}@example.com`,
        name: "Mona Said",
        phone: "01099999999",
      },
    });
    await tx.order.create({
      data: {
        id: orderId,
        tenantId,
        orderNumber: `ORD-${orderId.slice(0, 8)}`,
        customerRef: customerId,
        currency: "EGP",
        checkoutRef,
        totals: {
          subtotalMinor: 120_000,
          taxMinor: 0,
          shippingMinor: 5_000,
          discountMinor: 20_000,
          totalMinor: 105_000,
          currency: "EGP",
          taxIncluded: false,
          discounts: [
            { title: "Welcome", code: "WELCOME10", discountClass: "order", amountMinor: 20_000 },
          ],
        },
      },
    });
    await tx.orderItem.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        orderId,
        productRef: "prod-1",
        variantRef: "var-1",
        sku: "SKU-1",
        name: "Shirt",
        unitPriceAmountMinor: 60_000,
        quantity: 2,
      },
    });
    await tx.orderShippingAddress.create({
      data: {
        orderId,
        tenantId,
        line1: "1 Tahrir St",
        city: "Cairo",
        postalCode: "11511",
        country: "EG",
        recipientName: "Mona Said",
        phone: "01012345678",
        province: "EG-C",
      },
    });
  });
  await new PrismaAttributionSnapshotStore(prisma).putIfAbsent({
    tenantId,
    subjectKind: "checkout",
    subjectRef: checkoutRef,
    capturedAt: NOW.toISOString(),
    snapshot: {
      visitorId: VISITOR,
      ip: "203.0.113.9",
      pageUrl: "https://shop.example/checkout",
      cookies: { fbp: "fb.1.1.2" },
      clickIds: [{ name: "gclid", value: "Cj0KCQ-abc", capturedAt: NOW.toISOString() }],
    },
  });
  return { orderId, customerId, checkoutRef };
}

async function cleanup(prisma: Database, tenantIds: readonly string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await scoped(prisma, tenantId, async (tx) => {
      await tx.trackingEventRecord.deleteMany({ where: { tenantId } });
      await tx.trackingAttributionSnapshot.deleteMany({ where: { tenantId } });
      await tx.orderShippingAddress.deleteMany({ where: { tenantId } });
      await tx.orderItem.deleteMany({ where: { tenantId } });
      await tx.order.deleteMany({ where: { tenantId } });
      await tx.customer.deleteMany({ where: { tenantId } });
      await tx.shopDomain.deleteMany({ where: { tenantId } });
    });
  }
}

describe.runIf(Boolean(databaseUrl))("order tracking reader (integration)", () => {
  it("reads the whole order — lines, totals, customer, shipping address, coupon and attribution snapshot — in one scoped read", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-otr-${crypto.randomUUID()}`;
    try {
      const seeded = await seedOrder(prisma, tenantId);
      const model = await new PrismaOrderTrackingReader(prisma).read(tenantId, seeded.orderId);

      expect(model).toMatchObject({
        orderId: seeded.orderId,
        currency: "EGP",
        checkoutRef: seeded.checkoutRef,
        couponCode: "WELCOME10",
        totals: {
          subtotalMinor: 120_000,
          discountMinor: 20_000,
          shippingMinor: 5_000,
          totalMinor: 105_000,
          taxIncluded: false,
        },
        lines: [
          {
            productRef: "prod-1",
            variantRef: "var-1",
            sku: "SKU-1",
            name: "Shirt",
            unitPriceMinor: 60_000,
            quantity: 2,
          },
        ],
        customer: {
          customerRef: seeded.customerId,
          email: `mona-${seeded.customerId}@example.com`,
          phone: "01099999999",
          name: "Mona Said",
        },
        shipping: {
          recipientName: "Mona Said",
          phone: "01012345678",
          city: "Cairo",
          province: "EG-C",
          country: "EG",
        },
        snapshot: { visitorId: VISITOR, ip: "203.0.113.9", cookies: { fbp: "fb.1.1.2" } },
      });
      expect(Date.parse(model?.placedAt ?? "")).not.toBeNaN();
      expect(model?.snapshot?.clickIds).toHaveLength(1);
      // an id that is no order of this tenant
      expect(
        await new PrismaOrderTrackingReader(prisma).read(tenantId, crypto.randomUUID()),
      ).toBeNull();
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("RLS really applies: another tenant's order is not readable, with or without the tenant in the where", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-otr-rls-a-${suffix}`;
    const b = `tenant-itest-otr-rls-b-${suffix}`;
    try {
      const orderA = await seedOrder(prisma, a);
      const orderB = await seedOrder(prisma, b);

      // the connection role of the test database is a superuser, which RLS never applies to: these run under a
      // NOBYPASSRLS role so the policies alone decide
      const own = await runWithRlsEnforced(prisma, a, TABLES, (tx) =>
        readOrderTrackingModel(tx, a, orderA.orderId),
      );
      expect(own?.orderId).toBe(orderA.orderId);
      expect(own?.customer.email).toBeDefined();
      expect(own?.snapshot?.visitorId).toBe(VISITOR);

      // asking tenant A's scope for tenant B's order: refused by the application filter...
      await expect(
        runWithRlsEnforced(prisma, a, TABLES, (tx) =>
          readOrderTrackingModel(tx, a, orderB.orderId),
        ),
      ).resolves.toBeNull();
      // ...and, with the filter naming B, by the policy alone
      await expect(
        runWithRlsEnforced(prisma, a, TABLES, (tx) =>
          readOrderTrackingModel(tx, b, orderB.orderId),
        ),
      ).resolves.toBeNull();
      // the same order read in its own scope is there (the refusal above is not a missing grant)
      await expect(
        runWithRlsEnforced(prisma, b, TABLES, (tx) =>
          readOrderTrackingModel(tx, b, orderB.orderId),
        ),
      ).resolves.toMatchObject({ orderId: orderB.orderId });
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);

  it("a customer erased after the order contributes no email, phone or name", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-otr-erased-${crypto.randomUUID()}`;
    try {
      const seeded = await seedOrder(prisma, tenantId);
      await scoped(prisma, tenantId, (tx) =>
        tx.customer.updateMany({
          where: { id: seeded.customerId, tenantId },
          data: { deletedAt: new Date() },
        }),
      );
      const model = await new PrismaOrderTrackingReader(prisma).read(tenantId, seeded.orderId);
      expect(model?.customer).toEqual({ customerRef: seeded.customerId });
    } finally {
      await cleanup(prisma, [tenantId]);
      await prisma.$disconnect();
    }
  }, 60_000);
});

describe.runIf(Boolean(databaseUrl))("cancel guard record lookup (integration)", () => {
  const recordData = (tenantId: string, orderId: string, eventOrigin: string) => ({
    id: crypto.randomUUID(),
    tenantId,
    eventId: businessMessageId(tenantId, businessEventId("order", orderId)),
    dedupId: businessEventId("order", orderId),
    eventName: "purchase",
    capturedAt: NOW,
    envelope: { eventName: "purchase", eventOrigin },
    consent: {},
    identity: {},
    versions: {},
    state: "recorded",
  });

  it("finds a server-origin purchase record only: a browser claim, another tenant and another order do not count", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const a = `tenant-itest-guard-a-${suffix}`;
    const b = `tenant-itest-guard-b-${suffix}`;
    try {
      const guard = new PrismaServerPurchaseRecords(prisma);
      await scoped(prisma, a, async (tx) => {
        await tx.trackingEventRecord.create({ data: recordData(a, "order-server", "server") });
        // the browser claims ord_order-browser (same derived id here to show the origin filter is what refuses it)
        await tx.trackingEventRecord.create({ data: recordData(a, "order-browser", "browser") });
      });
      await scoped(prisma, b, (tx) =>
        tx.trackingEventRecord.create({ data: recordData(b, "order-other-tenant", "server") }),
      );

      await expect(guard.hasServerPurchase(a, "order-server")).resolves.toBe(true);
      await expect(guard.hasServerPurchase(a, "order-browser")).resolves.toBe(false);
      await expect(guard.hasServerPurchase(a, "order-unknown")).resolves.toBe(false);
      await expect(guard.hasServerPurchase(a, "order-other-tenant")).resolves.toBe(false);
      await expect(guard.hasServerPurchase(b, "order-server")).resolves.toBe(false);
      await expect(guard.hasServerPurchase(b, "order-other-tenant")).resolves.toBe(true);
    } finally {
      await cleanup(prisma, [a, b]);
      await prisma.$disconnect();
    }
  }, 60_000);
});

describe.runIf(Boolean(databaseUrl))("store url from tenancy.shop_domains (integration)", () => {
  it("is the primary verified domain of the merchant, read in the platform tenant's scope", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const suffix = crypto.randomUUID();
    const platform = `tenant-itest-url-platform-${suffix}`;
    const merchant = `tenant-itest-url-shop-${suffix}`;
    const hostname = (label: string) => `${label}-${suffix}.itest.example`;
    try {
      await scoped(prisma, platform, async (tx) => {
        await tx.shopDomain.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: platform,
            shopRef: merchant,
            hostname: hostname("pending"),
            kind: "custom",
            status: "pending",
            isPrimary: false,
          },
        });
        await tx.shopDomain.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: platform,
            shopRef: merchant,
            hostname: hostname("primary"),
            kind: "custom",
            status: "verified",
            isPrimary: true,
            verifiedAt: NOW,
          },
        });
      });
      const resolver = new PrismaStoreUrlResolver({
        db: prisma,
        platformTenantId: platform,
        clock: { now: () => NOW },
      });
      await expect(resolver.storeUrlOf(merchant)).resolves.toBe(`https://${hostname("primary")}/`);
      await expect(resolver.storeUrlOf(`${merchant}-none`)).resolves.toBeNull();
    } finally {
      await cleanup(prisma, [platform]);
      await prisma.$disconnect();
    }
  }, 60_000);
});
