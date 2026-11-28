import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaOrderTrackingReader } from "./prisma-order-tracking-reader";

/**
 * Statement-level tests: no database is reachable from here, so what is pinned is what the reader ASKS — the tenant is
 * set first and named in EVERY `where`, the lookups use the order's own refs, and the read model is shaped from the
 * rows. Behaviour on a real database (and row-level security) is the gated integration test's.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const TENANT = "t-1";
const ORDER_ID = "0193a1b2-0000-7000-8000-0000000000aa";
const CUSTOMER_ID = "0193a1b2-0000-7000-8000-0000000000cc";
const CREATED = new Date("2026-11-28T10:00:00.000Z");

interface Rows {
  order?: Record<string, unknown> | null;
  items?: Record<string, unknown>[];
  address?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  snapshot?: Record<string, unknown> | null;
}

const baseOrder = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ORDER_ID,
  tenantId: TENANT,
  orderNumber: "ORD-1001",
  customerRef: CUSTOMER_ID,
  currency: "EGP",
  checkoutRef: "chk-1",
  totals: {
    subtotalMinor: 120_000,
    taxMinor: 14_000,
    shippingMinor: 5_000,
    discountMinor: 20_000,
    totalMinor: 105_000,
    currency: "EGP",
    taxIncluded: true,
    discounts: [
      { title: "Ship", discountClass: "shipping", amountMinor: 0 },
      { title: "Welcome", code: "WELCOME10", discountClass: "order", amountMinor: 20_000 },
    ],
  },
  createdAt: CREATED,
  ...overrides,
});

function fakeDb(rows: Rows = {}) {
  const calls: { op: string; args: unknown }[] = [];
  const record =
    <T>(op: string, value: T) =>
    (args: unknown): Promise<T> => {
      calls.push({ op, args });
      return Promise.resolve(value);
    };
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "raw", args: { sql: strings.join("?"), values } });
      return Promise.resolve(1);
    },
    order: { findFirst: record("order", rows.order === undefined ? baseOrder() : rows.order) },
    orderItem: {
      findMany: record(
        "items",
        rows.items ?? [
          {
            productRef: "prod-1",
            variantRef: "var-1",
            sku: "SKU-1",
            name: "Shirt",
            unitPriceAmountMinor: 60_000,
            quantity: 2,
          },
        ],
      ),
    },
    orderShippingAddress: {
      findFirst: record(
        "address",
        rows.address === undefined
          ? {
              recipientName: " Mona Said ",
              phone: "01012345678",
              city: "Cairo",
              province: "EG-C",
              country: "EG",
            }
          : rows.address,
      ),
    },
    customer: {
      findFirst: record(
        "customer",
        rows.customer === undefined
          ? {
              email: "mona@example.com",
              phone: "01099999999",
              name: "Mona Said",
              deletedAt: null,
            }
          : rows.customer,
      ),
    },
    trackingAttributionSnapshot: {
      findFirst: record(
        "snapshot",
        rows.snapshot === undefined
          ? {
              visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
              sessionId: null,
              ip: "203.0.113.9",
              userAgent: null,
              pageUrl: "https://shop.example/checkout",
              referrer: null,
              cookies: { fbp: "fb.1.1.2" },
              clickIds: [],
              utm: {},
            }
          : rows.snapshot,
      ),
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls };
}

describe("PrismaOrderTrackingReader", () => {
  it("returns the order as the plain read model: lines, totals, customer, shipping, coupon, snapshot", async () => {
    const { db } = fakeDb();
    const model = await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);

    expect(model).toEqual({
      orderId: ORDER_ID,
      orderNumber: "ORD-1001",
      currency: "EGP",
      totals: {
        subtotalMinor: 120_000,
        discountMinor: 20_000,
        taxMinor: 14_000,
        shippingMinor: 5_000,
        totalMinor: 105_000,
        taxIncluded: true,
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
        customerRef: CUSTOMER_ID,
        email: "mona@example.com",
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
      checkoutRef: "chk-1",
      placedAt: "2026-11-28T10:00:00.000Z",
      couponCode: "WELCOME10",
      snapshot: {
        visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
        ip: "203.0.113.9",
        pageUrl: "https://shop.example/checkout",
        cookies: { fbp: "fb.1.1.2" },
      },
    });
  });

  it("sets the tenant FIRST and names it in every where; the snapshot is the checkout one", async () => {
    const { db, calls } = fakeDb();
    await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);

    expect(calls[0]?.op).toBe("raw");
    expect(JSON.stringify(calls[0]?.args)).toContain("app.tenant_id");
    expect(JSON.stringify(calls[0]?.args)).toContain(TENANT);
    const wheres = calls
      .slice(1)
      .map((call) => (call.args as { where: Record<string, unknown> }).where);
    expect(wheres).toHaveLength(5);
    for (const where of wheres) expect(where["tenantId"]).toBe(TENANT);
    expect(calls.find((c) => c.op === "order")?.args).toEqual({
      where: { id: ORDER_ID, tenantId: TENANT },
    });
    expect(calls.find((c) => c.op === "customer")?.args).toEqual({
      where: { id: CUSTOMER_ID, tenantId: TENANT },
    });
    expect(calls.find((c) => c.op === "snapshot")?.args).toEqual({
      where: { tenantId: TENANT, subjectKind: "checkout", subjectRef: "chk-1" },
    });
    expect(calls.find((c) => c.op === "address")?.args).toEqual({
      where: { orderId: ORDER_ID, tenantId: TENANT },
    });
  });

  it("an order that is not visible is null, and nothing else is read", async () => {
    const { db, calls } = fakeDb({ order: null });
    await expect(new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID)).resolves.toBeNull();
    expect(calls.map((call) => call.op)).toEqual(["raw", "order"]);
  });

  it("an id that cannot be a uuid is null without touching the database", async () => {
    const { db, calls } = fakeDb();
    await expect(new PrismaOrderTrackingReader(db).read(TENANT, "order-1")).resolves.toBeNull();
    expect(calls.map((call) => call.op)).toEqual(["raw"]);
  });

  it("an order with no checkout ref has no snapshot lookup; a non-uuid customer ref has no customer lookup", async () => {
    const { db, calls } = fakeDb({
      order: baseOrder({ checkoutRef: null, customerRef: "guest-1" }),
    });
    const model = await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);
    expect(calls.map((call) => call.op)).not.toContain("snapshot");
    expect(calls.map((call) => call.op)).not.toContain("customer");
    expect(model?.snapshot).toBeUndefined();
    expect(model?.checkoutRef).toBeUndefined();
    expect(model?.customer).toEqual({ customerRef: "guest-1" });
  });

  it("an erased (soft-deleted) customer contributes no email, phone or name", async () => {
    const { db } = fakeDb({
      customer: { email: "erased@example.invalid", phone: "0", name: "Erased", deletedAt: CREATED },
    });
    const model = await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);
    expect(model?.customer).toEqual({ customerRef: CUSTOMER_ID });
  });

  it("legacy order with no totals JSON: the subtotal is the line sum, tax counted as added on top", async () => {
    const { db } = fakeDb({ order: baseOrder({ totals: null, checkoutRef: null }) });
    const model = await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);
    expect(model?.totals).toEqual({
      subtotalMinor: 120_000,
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
      taxIncluded: false,
    });
    expect(model?.couponCode).toBeUndefined();
  });

  it("older totals without taxIncluded read as tax added on top; no address, no shipping block", async () => {
    const { db } = fakeDb({
      order: baseOrder({
        totals: {
          subtotalMinor: 100,
          discountMinor: 0,
          taxMinor: 14,
          shippingMinor: 0,
          totalMinor: 114,
        },
      }),
      address: null,
    });
    const model = await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);
    expect(model?.totals.taxIncluded).toBe(false);
    expect(model?.shipping).toBeUndefined();
  });

  it("a hand-edited totals column degrades to the line sum instead of throwing", async () => {
    const { db } = fakeDb({ order: baseOrder({ totals: "garbage" }) });
    const model = await new PrismaOrderTrackingReader(db).read(TENANT, ORDER_ID);
    expect(model?.totals.subtotalMinor).toBe(120_000);
  });
});
