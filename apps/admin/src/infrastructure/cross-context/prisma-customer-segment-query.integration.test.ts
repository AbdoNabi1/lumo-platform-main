import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInTenantTransaction, type Database, type TransactionClient } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import type { SegmentCondition } from "@platform/identity";
import {
  PrismaCustomerSegmentQuery,
  type SegmentMemberRow,
  type SegmentMembersInput,
} from "./customer-segment-query";

/**
 * Wave 1c: the live segment query against a real PostgreSQL. HONESTLY GATED on `DATABASE_URL_TEST`
 * (never point it at Supabase); it runs in CI's disposable Postgres job.
 *
 * Every customer carries a self-describing NAME; assertions read names, not ids. Tenant B's rows
 * (the adversarial block) deliberately POINT AT tenant A's customers/orders with values that would
 * flip A's membership, count or spend if the alias's `tenant_id = $1` predicate were missing.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const NOW = new Date("2026-07-05T12:00:00.000Z");
const day = (iso: string) => new Date(iso);

describe.runIf(Boolean(databaseUrl))("PrismaCustomerSegmentQuery (integration, Wave 1c)", () => {
  const runPrefix = crypto.randomUUID().slice(0, 8);
  const tenantA = `tenant-seg-a-${runPrefix}`;
  const tenantB = `tenant-seg-b-${runPrefix}`;
  let prisma: Database;
  let query: PrismaCustomerSegmentQuery;

  let customerCounter = 0;
  let orderCounter = 0;
  let rowCounter = 0;
  const customerUuid = () =>
    `${runPrefix}-0000-7000-8000-${(++customerCounter).toString(16).padStart(12, "0")}`;
  const orderUuid = () =>
    `${runPrefix}-0000-7001-8000-${(++orderCounter).toString(16).padStart(12, "0")}`;
  const rowUuid = () =>
    `${runPrefix}-0000-7002-8000-${(++rowCounter).toString(16).padStart(12, "0")}`;

  /** Name → customer id (tenant A and B share one registry; names are unique per run). */
  const ids = new Map<string, string>();
  const idOf = (name: string): string => {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`no fixture customer named ${name}`);
    return id;
  };
  /** Tenant A order ids by key, so tenant B rows can point at them. */
  const orderIds = new Map<string, string>();

  interface OrderFixture {
    readonly key?: string;
    readonly currency?: string;
    readonly at: string;
    readonly totalMinor?: number;
    readonly items?: readonly { readonly unit: number; readonly quantity: number }[];
    readonly events?: readonly string[];
  }

  async function seedCustomer(
    tx: TransactionClient,
    tenantId: string,
    name: string,
    options: {
      readonly createdAt?: string;
      readonly language?: string | null;
      readonly isGuest?: boolean;
      readonly deletedAt?: string;
    } = {},
  ): Promise<string> {
    const id = customerUuid();
    ids.set(name, id);
    await tx.customer.create({
      data: {
        id,
        tenantId,
        email: `${name}-${runPrefix}@example.com`,
        name,
        isGuest: options.isGuest ?? false,
        language: options.language ?? null,
        createdAt: day(options.createdAt ?? "2026-06-20T00:00:00.000Z"),
        deletedAt: options.deletedAt === undefined ? null : day(options.deletedAt),
      },
    });
    return id;
  }

  async function seedOrder(
    tx: TransactionClient,
    tenantId: string,
    customerRef: string,
    order: OrderFixture,
  ): Promise<string> {
    const id = orderUuid();
    if (order.key !== undefined) orderIds.set(order.key, id);
    await tx.order.create({
      data: {
        id,
        tenantId,
        orderNumber: `ORD-${id.slice(-8)}`,
        customerRef,
        currency: order.currency ?? "EGP",
        createdAt: day(order.at),
        ...(order.totalMinor === undefined ? {} : { totals: { totalMinor: order.totalMinor } }),
      },
    });
    for (const item of order.items ?? []) {
      await tx.orderItem.create({
        data: {
          id: rowUuid(),
          tenantId,
          orderId: id,
          productRef: "p-1",
          name: "Item",
          unitPriceAmountMinor: item.unit,
          quantity: item.quantity,
        },
      });
    }
    for (const type of order.events ?? []) {
      await tx.orderEvent.create({
        data: { id: rowUuid(), tenantId, orderId: id, type, occurredAt: day(order.at) },
      });
    }
    return id;
  }

  async function seedConsent(
    tx: TransactionClient,
    tenantId: string,
    customerId: string,
    scope: "marketing" | "marketing_sms",
    granted: boolean,
    at: string,
    id: string = rowUuid(),
  ): Promise<void> {
    await tx.consentRecord.create({
      data: { id, tenantId, customerId, scope, granted, occurredAt: day(at) },
    });
  }

  async function seedTag(
    tx: TransactionClient,
    tenantId: string,
    customerId: string,
    tag: string,
  ): Promise<void> {
    await tx.customerTag.create({
      data: { tenantId, customerId, tag, tagKey: tag.trim().toLowerCase() },
    });
  }

  async function seedAddress(
    tx: TransactionClient,
    tenantId: string,
    customerId: string,
    country: string,
  ): Promise<void> {
    await tx.address.create({
      data: {
        id: rowUuid(),
        tenantId,
        customerId,
        line1: "1 Nile St",
        city: "Cairo",
        postalCode: "11511",
        country,
      },
    });
  }

  beforeAll(async () => {
    prisma = createTestPrismaClient(databaseUrl);
    query = new PrismaCustomerSegmentQuery({ prisma });

    // ---- tenant A -------------------------------------------------------------------------
    await runInTenantTransaction(
      prisma,
      tenantA,
      async (tx) => {
        // Orders: zero, cancelled-only, other-currency-only, refunded-only.
        await seedCustomer(tx, tenantA, "no-orders", {
          createdAt: "2026-01-10T00:00:00.000Z",
          language: null,
        });
        const cancelledOnly = await seedCustomer(tx, tenantA, "cancelled-only", {
          language: "en",
        });
        await seedOrder(tx, tenantA, cancelledOnly, {
          at: "2026-06-01T10:00:00.000Z",
          totalMinor: 9999,
          events: ["created", "cancelled"],
        });
        const otherCurrency = await seedCustomer(tx, tenantA, "other-currency-only", {
          language: "ar",
        });
        await seedOrder(tx, tenantA, otherCurrency, {
          currency: "USD",
          at: "2026-06-02T10:00:00.000Z",
          totalMinor: 7000,
        });
        const refundedOnly = await seedCustomer(tx, tenantA, "refunded-only");
        await seedOrder(tx, tenantA, refundedOnly, {
          at: "2026-06-03T10:00:00.000Z",
          totalMinor: 4000,
          events: ["paid", "refunded"],
        });
        const bothRefundEvents = await seedCustomer(tx, tenantA, "both-refund-events");
        await seedOrder(tx, tenantA, bothRefundEvents, {
          at: "2026-06-04T10:00:00.000Z",
          totalMinor: 4000,
          events: ["paid", "refund_requested", "refunded"],
        });

        // Money oracles.
        const totalsOverride = await seedCustomer(tx, tenantA, "totals-override");
        await seedOrder(tx, tenantA, totalsOverride, {
          at: "2026-06-05T10:00:00.000Z",
          totalMinor: 10_000,
          items: [{ unit: 999, quantity: 1 }],
        });
        await seedOrder(tx, tenantA, totalsOverride, {
          at: "2026-06-06T10:00:00.000Z",
          items: [{ unit: 2_000_000_000, quantity: 3 }],
        });
        const mixedCurrency = await seedCustomer(tx, tenantA, "mixed-currency");
        await seedOrder(tx, tenantA, mixedCurrency, {
          at: "2026-06-07T10:00:00.000Z",
          totalMinor: 5000,
        });
        await seedOrder(tx, tenantA, mixedCurrency, {
          currency: "USD",
          at: "2026-06-08T10:00:00.000Z",
          totalMinor: 7000,
        });

        // Shop-zone midnight (Africa/Cairo is UTC+2 on 2026-03-01): 21:30Z is 23:30 on Mar 1,
        // 22:30Z is 00:30 on Mar 2 (still Mar 1 in UTC).
        const beforeMidnight = await seedCustomer(tx, tenantA, "cairo-before-midnight");
        await seedOrder(tx, tenantA, beforeMidnight, {
          at: "2026-03-01T21:30:00.000Z",
          totalMinor: 100,
        });
        const afterMidnight = await seedCustomer(tx, tenantA, "cairo-after-midnight");
        await seedOrder(tx, tenantA, afterMidnight, {
          at: "2026-03-01T22:30:00.000Z",
          totalMinor: 100,
        });

        // Recent vs old last order (now = 2026-07-05T12:00Z).
        const recent = await seedCustomer(tx, tenantA, "recent-buyer");
        await seedOrder(tx, tenantA, recent, { at: "2026-06-25T12:00:00.000Z", totalMinor: 100 });
        const old = await seedCustomer(tx, tenantA, "old-buyer");
        await seedOrder(tx, tenantA, old, { at: "2026-04-01T12:00:00.000Z", totalMinor: 100 });
        const twice = await seedCustomer(tx, tenantA, "twice-buyer");
        await seedOrder(tx, tenantA, twice, { at: "2026-05-01T12:00:00.000Z", totalMinor: 100 });
        await seedOrder(tx, tenantA, twice, { at: "2026-05-02T12:00:00.000Z", totalMinor: 100 });

        // Consents: single grant; granted then revoked; equal-time ties (higher id wins).
        const emailOnly = await seedCustomer(tx, tenantA, "email-subscriber");
        await seedConsent(tx, tenantA, emailOnly, "marketing", true, "2026-06-01T00:00:00.000Z");
        const revoked = await seedCustomer(tx, tenantA, "email-revoked-sms-granted");
        await seedConsent(tx, tenantA, revoked, "marketing", true, "2026-06-01T00:00:00.000Z");
        await seedConsent(tx, tenantA, revoked, "marketing", false, "2026-06-02T00:00:00.000Z");
        await seedConsent(tx, tenantA, revoked, "marketing_sms", true, "2026-06-02T00:00:00.000Z");
        const tie = await seedCustomer(tx, tenantA, "consent-tie");
        const tieAt = "2026-06-10T00:00:00.000Z";
        // email: grant (lower id) then revoke (higher id) -> NOT subscribed.
        await seedConsent(
          tx,
          tenantA,
          tie,
          "marketing",
          true,
          tieAt,
          `${runPrefix}-0000-7003-8000-000000000001`,
        );
        await seedConsent(
          tx,
          tenantA,
          tie,
          "marketing",
          false,
          tieAt,
          `${runPrefix}-0000-7003-8000-000000000002`,
        );
        // sms: revoke (lower id) then grant (higher id) -> subscribed.
        await seedConsent(
          tx,
          tenantA,
          tie,
          "marketing_sms",
          false,
          tieAt,
          `${runPrefix}-0000-7003-8000-000000000003`,
        );
        await seedConsent(
          tx,
          tenantA,
          tie,
          "marketing_sms",
          true,
          tieAt,
          `${runPrefix}-0000-7003-8000-000000000004`,
        );

        // Tags.
        const vipCairo = await seedCustomer(tx, tenantA, "tag-vip-cairo");
        await seedTag(tx, tenantA, vipCairo, "vip");
        await seedTag(tx, tenantA, vipCairo, "cairo");
        const vipOnly = await seedCustomer(tx, tenantA, "tag-vip-only");
        await seedTag(tx, tenantA, vipOnly, "vip");

        // Countries (stored free text: trim + upper-case on match).
        const eg = await seedCustomer(tx, tenantA, "country-eg");
        await seedAddress(tx, tenantA, eg, " eg ");
        const us = await seedCustomer(tx, tenantA, "country-us");
        await seedAddress(tx, tenantA, us, "US");
        const both = await seedCustomer(tx, tenantA, "country-us-and-eg");
        await seedAddress(tx, tenantA, both, "US");
        await seedAddress(tx, tenantA, both, "EG");

        // Search / guest / soft-deleted.
        await seedCustomer(tx, tenantA, "50%_off Fan");
        await seedCustomer(tx, tenantA, "plain Guest", { isGuest: true });
        const deleted = await seedCustomer(tx, tenantA, "soft-deleted", {
          deletedAt: "2026-06-30T00:00:00.000Z",
        });
        await seedOrder(tx, tenantA, deleted, { at: "2026-06-29T00:00:00.000Z", totalMinor: 100 });

        // Adversarial A-side customers (their A state is the oracle).
        await seedCustomer(tx, tenantA, "adv-no-orders");
        const advCancel = await seedCustomer(tx, tenantA, "adv-cancel-target");
        await seedOrder(tx, tenantA, advCancel, {
          key: "adv-cancel",
          at: "2026-06-12T10:00:00.000Z",
          totalMinor: 3000,
        });
        const advRefund = await seedCustomer(tx, tenantA, "adv-refund-target");
        await seedOrder(tx, tenantA, advRefund, {
          key: "adv-refund",
          at: "2026-06-13T10:00:00.000Z",
          totalMinor: 3000,
        });
        const advItems = await seedCustomer(tx, tenantA, "adv-items-target");
        await seedOrder(tx, tenantA, advItems, {
          key: "adv-items",
          at: "2026-06-14T10:00:00.000Z",
          items: [{ unit: 1000, quantity: 1 }],
        });
        const advConsent = await seedCustomer(tx, tenantA, "adv-consent-target");
        await seedConsent(tx, tenantA, advConsent, "marketing", false, "2026-06-01T00:00:00.000Z");
        await seedCustomer(tx, tenantA, "adv-tag-target");
        await seedCustomer(tx, tenantA, "adv-address-target");
      },
      { timeoutMs: 120_000, maxWaitMs: 30_000 },
    );

    // ---- tenant B: its own customer, plus rows pointing at tenant A ------------------------
    await runInTenantTransaction(
      prisma,
      tenantB,
      async (tx) => {
        const bOnly = await seedCustomer(tx, tenantB, "b-only-customer");
        await seedOrder(tx, tenantB, bOnly, { at: "2026-06-20T00:00:00.000Z", totalMinor: 100 });
        // A tenant-B order whose customer_ref is a tenant-A customer id (A has no orders for it).
        await seedOrder(tx, tenantB, idOf("adv-no-orders"), {
          at: "2026-06-20T00:00:00.000Z",
          totalMinor: 123_456,
        });
        // Tenant-B cancelled / refunded events pointing at tenant-A orders.
        const cancelEventOrder = orderIds.get("adv-cancel") ?? "";
        const refundEventOrder = orderIds.get("adv-refund") ?? "";
        await tx.orderEvent.create({
          data: {
            id: rowUuid(),
            tenantId: tenantB,
            orderId: cancelEventOrder,
            type: "cancelled",
            occurredAt: NOW,
          },
        });
        await tx.orderEvent.create({
          data: {
            id: rowUuid(),
            tenantId: tenantB,
            orderId: refundEventOrder,
            type: "refunded",
            occurredAt: NOW,
          },
        });
        // A tenant-B order item on a tenant-A order (no totals there: would change the item sum).
        await tx.orderItem.create({
          data: {
            id: rowUuid(),
            tenantId: tenantB,
            orderId: orderIds.get("adv-items") ?? "",
            productRef: "p-b",
            name: "B item",
            unitPriceAmountMinor: 5000,
            quantity: 1,
          },
        });
        // Consent, tag and address rows of tenant B on tenant-A customers.
        const advConsent = idOf("adv-consent-target");
        await seedConsent(tx, tenantB, advConsent, "marketing", true, "2026-06-20T00:00:00.000Z");
        await seedConsent(
          tx,
          tenantB,
          advConsent,
          "marketing_sms",
          true,
          "2026-06-20T00:00:00.000Z",
        );
        await seedTag(tx, tenantB, idOf("adv-tag-target"), "vip");
        await seedAddress(tx, tenantB, idOf("adv-address-target"), "US");
      },
      { timeoutMs: 120_000, maxWaitMs: 30_000 },
    );
  }, 180_000);

  afterAll(async () => {
    for (const tenantId of [tenantB, tenantA]) {
      await runInTenantTransaction(
        prisma,
        tenantId,
        async (tx) => {
          await tx.orderEvent.deleteMany({ where: { tenantId } });
          await tx.orderItem.deleteMany({ where: { tenantId } });
          await tx.consentRecord.deleteMany({ where: { tenantId } });
          await tx.customerTag.deleteMany({ where: { tenantId } });
          await tx.address.deleteMany({ where: { tenantId } });
          await tx.order.deleteMany({ where: { tenantId } });
          await tx.customer.deleteMany({ where: { tenantId } });
        },
        { timeoutMs: 120_000 },
      );
    }
    await prisma.$disconnect();
  }, 180_000);

  const baseInput = (
    conditions: readonly SegmentCondition[],
    extra: Partial<SegmentMembersInput> = {},
  ): SegmentMembersInput => ({
    tenantId: tenantA,
    conditions,
    currency: "EGP",
    timezone: "Africa/Cairo",
    now: NOW,
    first: 100,
    ...extra,
  });
  const membersOf = (
    conditions: readonly SegmentCondition[],
    extra: Partial<SegmentMembersInput> = {},
  ) => query.members(baseInput(conditions, extra));
  const namesOf = async (
    conditions: readonly SegmentCondition[],
    extra: Partial<SegmentMembersInput> = {},
  ) => (await membersOf(conditions, extra)).items.map((item) => item.name).sort();
  const rowOf = async (name: string): Promise<SegmentMemberRow> => {
    const page = await membersOf([], { search: name });
    const row = page.items.find((item) => item.name === name);
    if (row === undefined) throw new Error(`${name} is not a member of the unfiltered segment`);
    return row;
  };

  describe("orders: count, amount spent, last order", () => {
    it("zero-order, cancelled-only and other-currency-only customers are 0 / 0 / null and not_purchased members", async () => {
      for (const name of ["no-orders", "cancelled-only", "other-currency-only"]) {
        expect(await rowOf(name)).toMatchObject({
          ordersCount: 0,
          amountSpentMinor: 0,
          lastOrderAt: null,
        });
      }
      const notPurchased = await namesOf([{ field: "orders_count", op: "eq", value: 0 }]);
      expect(notPurchased).toEqual(
        expect.arrayContaining(["no-orders", "cancelled-only", "other-currency-only"]),
      );
      expect(notPurchased).not.toContain("recent-buyer");
    });

    it("refunded-only (shop currency) is 1 order, 0 spent, last = that order's time", async () => {
      expect(await rowOf("refunded-only")).toMatchObject({
        ordersCount: 1,
        amountSpentMinor: 0,
        lastOrderAt: "2026-06-03T10:00:00.000Z",
      });
      expect(await rowOf("both-refund-events")).toMatchObject({
        ordersCount: 1,
        amountSpentMinor: 0,
      });
    });

    it("totals JSON overrides disagreeing items; missing totals use the bigint item sum; other currency ignored", async () => {
      expect(await rowOf("totals-override")).toMatchObject({
        ordersCount: 2,
        // 10_000 (totals JSON, not the 999 item) + 2_000_000_000 x 3 (item sum, no int4 overflow)
        amountSpentMinor: 6_000_010_000,
        lastOrderAt: "2026-06-06T10:00:00.000Z",
      });
      expect(await rowOf("mixed-currency")).toMatchObject({
        ordersCount: 1,
        amountSpentMinor: 5000,
        lastOrderAt: "2026-06-07T10:00:00.000Z",
      });
    });

    it("orders_count and amount_spent comparisons (eq 0 / lte 0 include the zero-order customer)", async () => {
      const gte2 = await namesOf([{ field: "orders_count", op: "gte", value: 2 }]);
      expect(gte2).toEqual(["totals-override", "twice-buyer"]);
      const gt1 = await namesOf([{ field: "orders_count", op: "gt", value: 1 }]);
      expect(gt1).toEqual(gte2);
      const atLeastOnce = await namesOf([{ field: "orders_count", op: "gte", value: 1 }]);
      expect(atLeastOnce).toContain("refunded-only");
      expect(atLeastOnce).not.toContain("cancelled-only");
      expect(atLeastOnce).not.toContain("soft-deleted");
      expect(await namesOf([{ field: "amount_spent", op: "eq", valueMinor: 0 }])).toEqual(
        expect.arrayContaining(["no-orders", "refunded-only", "both-refund-events"]),
      );
      expect(await namesOf([{ field: "amount_spent", op: "lte", valueMinor: 0 }])).toEqual(
        expect.arrayContaining(["no-orders", "cancelled-only", "other-currency-only"]),
      );
      expect(
        await namesOf([{ field: "amount_spent", op: "gt", valueMinor: 5_000_000_000 }]),
      ).toEqual(["totals-override"]);
      expect(await namesOf([{ field: "amount_spent", op: "neq", valueMinor: 0 }])).not.toContain(
        "no-orders",
      );
    });
  });

  describe("last order date", () => {
    it("within_last_days is a rolling UTC window; never and not_within include the never-ordered", async () => {
      const within = await namesOf([
        { field: "last_order_date", op: "within_last_days", days: 30 },
      ]);
      expect(within).toContain("recent-buyer");
      expect(within).not.toContain("old-buyer");
      expect(within).not.toContain("no-orders");
      const notWithin = await namesOf([
        { field: "last_order_date", op: "not_within_last_days", days: 30 },
      ]);
      expect(notWithin).toEqual(
        expect.arrayContaining(["old-buyer", "no-orders", "cancelled-only"]),
      );
      expect(notWithin).not.toContain("recent-buyer");
      const never = await namesOf([{ field: "last_order_date", op: "never" }]);
      expect(never).toEqual(
        expect.arrayContaining(["no-orders", "cancelled-only", "other-currency-only"]),
      );
      expect(never).not.toContain("recent-buyer");
    });

    it("on_or_after / before use the shop-zone (Africa/Cairo) midnight", async () => {
      const onOrAfter = await namesOf([
        { field: "last_order_date", op: "on_or_after", date: "2026-03-02" },
      ]);
      expect(onOrAfter).toContain("cairo-after-midnight");
      expect(onOrAfter).not.toContain("cairo-before-midnight");
      const before = await namesOf([
        { field: "last_order_date", op: "before", date: "2026-03-02" },
      ]);
      expect(before).toContain("cairo-before-midnight");
      expect(before).not.toContain("cairo-after-midnight");
      expect(before).not.toContain("no-orders");
    });
  });

  describe("subscriptions", () => {
    it("email / sms: latest consent wins; none = not subscribed", async () => {
      const email = await namesOf([{ field: "email_subscribed", value: true }]);
      expect(email).toContain("email-subscriber");
      expect(email).not.toContain("email-revoked-sms-granted");
      expect(email).not.toContain("no-orders");
      const sms = await namesOf([{ field: "sms_subscribed", value: true }]);
      expect(sms).toContain("email-revoked-sms-granted");
      expect(sms).not.toContain("email-subscriber");
      const notEmail = await namesOf([{ field: "email_subscribed", value: false }]);
      expect(notEmail).toEqual(expect.arrayContaining(["no-orders", "email-revoked-sms-granted"]));
      expect(await rowOf("email-subscriber")).toMatchObject({
        emailSubscribed: true,
        smsSubscribed: false,
      });
    });

    it("equal-time grant and revoke per channel: the higher id wins", async () => {
      expect(await rowOf("consent-tie")).toMatchObject({
        emailSubscribed: false,
        smsSubscribed: true,
      });
      expect(await namesOf([{ field: "email_subscribed", value: true }])).not.toContain(
        "consent-tie",
      );
      expect(await namesOf([{ field: "sms_subscribed", value: true }])).toContain("consent-tie");
    });
  });

  describe("tags, country, created date, language", () => {
    it("tags has_any / has_all / has_none (case-insensitive keys)", async () => {
      expect(await namesOf([{ field: "tags", op: "has_any", values: ["VIP"] }])).toEqual([
        "tag-vip-cairo",
        "tag-vip-only",
      ]);
      expect(await namesOf([{ field: "tags", op: "has_all", values: ["VIP", " Cairo "] }])).toEqual(
        ["tag-vip-cairo"],
      );
      const none = await namesOf([{ field: "tags", op: "has_none", values: ["vip"] }]);
      expect(none).toContain("no-orders");
      expect(none).not.toContain("tag-vip-only");
    });

    it("country in / not_in match ANY address (trim + upper)", async () => {
      expect(await namesOf([{ field: "country", op: "in", values: ["eg"] }])).toEqual([
        "country-eg",
        "country-us-and-eg",
      ]);
      const notUs = await namesOf([{ field: "country", op: "not_in", values: ["US"] }]);
      expect(notUs).toContain("country-eg");
      expect(notUs).toContain("no-orders");
      expect(notUs).not.toContain("country-us");
      expect(notUs).not.toContain("country-us-and-eg");
    });

    it("created_date within / not_within / on_or_after / before", async () => {
      const within = await namesOf([{ field: "created_date", op: "within_last_days", days: 30 }]);
      expect(within).toContain("recent-buyer");
      expect(within).not.toContain("no-orders");
      expect(
        await namesOf([{ field: "created_date", op: "not_within_last_days", days: 30 }]),
      ).toContain("no-orders");
      expect(await namesOf([{ field: "created_date", op: "before", date: "2026-02-01" }])).toEqual([
        "no-orders",
      ]);
      expect(
        await namesOf([{ field: "created_date", op: "on_or_after", date: "2026-02-01" }]),
      ).not.toContain("no-orders");
    });

    it("language eq / neq / unset: neq keeps customers without a language", async () => {
      expect(await namesOf([{ field: "language", op: "eq", value: "en" }])).toEqual([
        "cancelled-only",
      ]);
      const unset = await namesOf([{ field: "language", op: "unset" }]);
      expect(unset).toContain("no-orders");
      expect(unset).not.toContain("cancelled-only");
      const neqEn = await namesOf([{ field: "language", op: "neq", value: "en" }]);
      expect(neqEn).toContain("no-orders");
      expect(neqEn).toContain("other-currency-only");
      expect(neqEn).not.toContain("cancelled-only");
    });
  });

  describe("search, keyset pages and total", () => {
    it("search escapes % and _ and matches name or email case-insensitively", async () => {
      const percent = await membersOf([], { search: "50%_off" });
      expect(percent.items.map((item) => item.name)).toEqual(["50%_off Fan"]);
      expect(percent.total).toBe(1);
      const wildcard = await membersOf([], { search: "5_%ff" });
      expect(wildcard.items).toEqual([]);
      const byEmail = await membersOf([], { search: `CANCELLED-ONLY-${runPrefix.toUpperCase()}` });
      expect(byEmail.items.map((item) => item.name)).toEqual(["cancelled-only"]);
    });

    it("keyset pages cover every non-deleted tenant-A customer exactly once with a stable total", async () => {
      const everything = await membersOf([]);
      expect(everything.total).toBe(everything.items.length);
      expect(everything.items.map((item) => item.name)).not.toContain("soft-deleted");
      expect(everything.items.map((item) => item.name)).not.toContain("b-only-customer");

      const seen: string[] = [];
      let after: string | undefined;
      const totals = new Set<number>();
      for (let guard = 0; guard < 100; guard += 1) {
        const page = await membersOf([], { first: 7, ...(after === undefined ? {} : { after }) });
        totals.add(page.total);
        seen.push(...page.items.map((item) => item.id));
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor ?? undefined;
      }
      expect([...totals]).toEqual([everything.total]);
      expect(seen).toEqual(everything.items.map((item) => item.id));
      expect(new Set(seen).size).toBe(seen.length);
      const sorted = [...seen].sort().reverse();
      expect(seen).toEqual(sorted);
    });

    it("a non-UUID after is an empty page that still counts the total", async () => {
      const page = await membersOf([], { after: "not-a-uuid" });
      expect(page.items).toEqual([]);
      expect(page.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
      expect(page.total).toBeGreaterThan(0);
    });

    it("guests are members and soft-deleted customers are not", async () => {
      const row = await rowOf("plain Guest");
      expect(row.isGuest).toBe(true);
      expect(await namesOf([{ field: "orders_count", op: "gte", value: 1 }])).not.toContain(
        "soft-deleted",
      );
    });
  });

  describe("tenant isolation (adversarial tenant-B rows pointing at tenant-A ids)", () => {
    it("a tenant-B order with a tenant-A customer ref does not give that customer orders or spend", async () => {
      expect(await rowOf("adv-no-orders")).toMatchObject({
        ordersCount: 0,
        amountSpentMinor: 0,
        lastOrderAt: null,
      });
      expect(await namesOf([{ field: "orders_count", op: "eq", value: 0 }])).toContain(
        "adv-no-orders",
      );
    });

    it("tenant-B cancelled / refunded events on tenant-A orders change nothing", async () => {
      expect(await rowOf("adv-cancel-target")).toMatchObject({
        ordersCount: 1,
        amountSpentMinor: 3000,
      });
      expect(await rowOf("adv-refund-target")).toMatchObject({
        ordersCount: 1,
        amountSpentMinor: 3000,
      });
    });

    it("a tenant-B order item on a tenant-A order is not added to the item-sum fallback", async () => {
      expect(await rowOf("adv-items-target")).toMatchObject({
        ordersCount: 1,
        amountSpentMinor: 1000,
      });
    });

    it("tenant-B consent, tag and address rows on tenant-A customers do not flip membership", async () => {
      expect(await rowOf("adv-consent-target")).toMatchObject({
        emailSubscribed: false,
        smsSubscribed: false,
      });
      expect(await namesOf([{ field: "email_subscribed", value: true }])).not.toContain(
        "adv-consent-target",
      );
      expect(await namesOf([{ field: "tags", op: "has_any", values: ["vip"] }])).not.toContain(
        "adv-tag-target",
      );
      expect(await namesOf([{ field: "country", op: "in", values: ["US"] }])).not.toContain(
        "adv-address-target",
      );
      expect(await namesOf([{ field: "country", op: "not_in", values: ["US"] }])).toContain(
        "adv-address-target",
      );
    });

    it("tenant B only ever sees its own customer", async () => {
      const page = await query.members({ ...baseInput([]), tenantId: tenantB });
      expect(page.items.map((item) => item.name)).toEqual(["b-only-customer"]);
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ ordersCount: 1, amountSpentMinor: 100 });
    });
  });
});
