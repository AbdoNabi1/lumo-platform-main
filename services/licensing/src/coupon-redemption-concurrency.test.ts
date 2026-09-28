import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { Database } from "@platform/db";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { CollectInvoice, CreateInvoice, IssueInvoice } from "./application/billing.use-cases";
import { IssueCoupon, RedeemCoupon } from "./application/coupon.use-cases";
import type { CouponValue } from "./domain/coupon";
import { InMemoryFinanceLedgerAdapter } from "./infrastructure/deferred-billing-adapters";
import { LicensingEventTranslator } from "./infrastructure/licensing-event-translator";
import { PlatformBillingPaymentsAdapter } from "./infrastructure/platform-billing-payments-adapter";
import {
  PrismaCouponRepository,
  PrismaInvoiceRepository,
} from "./infrastructure/prisma-repositories";
import { FakeLicensingDb, FakeLicensingUnitOfWork } from "./test-support/fake-licensing-db";
import { RecordingPaymentProvider } from "./test-support/recording-payment-provider";

/**
 * WP-14 T14.3: TWO CONCURRENT REDEMPTIONS MUST PRODUCE ONE DISCOUNT — this task's double-charge
 * equivalent. What holds it is the coupon row's optimistic lock (`updateMany where { id, tenantId,
 * version }` -> `count: 0` -> `ConcurrencyError`), the transition `issued -> redeemed` having no other
 * source state, and the coupon and invoice writes sharing ONE transaction (a lost race rolls the
 * loser's writes back). The real `PrismaCouponRepository`/`PrismaInvoiceRepository` and the real use
 * cases run here over a fake that implements those semantics (`FakeLicensingDb`), with `holdReads`
 * forcing every racer to READ before any WRITES — the interleaving under which a naive
 * read-check-write hands out two discounts.
 */
const PLATFORM = "platform-tenant";
const NOW = new Date("2026-10-01T00:00:00.000Z");
const EXPIRES = new Date("2026-11-01T00:00:00.000Z");
const PERCENT_20: CouponValue = { kind: "percentage", basisPoints: 2000 };

function harness() {
  const db = new FakeLicensingDb();
  let counter = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`,
  };
  const clock: Clock = { now: () => NOW };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new LicensingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "licensing",
  });
  const repoDeps = {
    prisma: undefined as unknown as Database,
    outbox: outbox as never,
    context: rootEventContext(idGenerator),
  };
  const coupons = new PrismaCouponRepository(repoDeps);
  const invoices = new PrismaInvoiceRepository(repoDeps);
  const unitOfWork = new FakeLicensingUnitOfWork(db);
  const provider = new RecordingPaymentProvider();
  const billingDeps = {
    invoices,
    credits: undefined as never,
    payments: new PlatformBillingPaymentsAdapter({ provider }),
    financeLedger: new InMemoryFinanceLedgerAdapter(),
    unitOfWork,
    idGenerator,
    clock,
  };
  const couponDeps = { coupons, invoices, unitOfWork, idGenerator, clock };

  async function draft(amountMinor = 2900, tenantRef = "merchant-1"): Promise<string> {
    const created = await new CreateInvoice(billingDeps).execute({
      tenantRef,
      subscriptionRef: "sub-1",
      currency: "EGP",
      lineItems: [{ description: "plan", amountMinor }],
      tenantId: PLATFORM,
    });
    if (!created.ok) throw created.error;
    return created.value.id;
  }

  async function issueCoupon(code: string): Promise<string> {
    const issued = await new IssueCoupon(couponDeps).execute({
      code,
      value: PERCENT_20,
      expiresAt: EXPIRES,
      tenantId: PLATFORM,
    });
    if (!issued.ok) throw issued.error;
    return issued.value.id;
  }

  const redeem = (code: string, invoiceId: string, tenantId = PLATFORM) =>
    new RedeemCoupon(couponDeps).execute({ code, invoiceId, tenantId });

  const invoiceRow = (id: string) => db.tables.invoice.get(id) as Record<string, unknown>;
  const couponRow = (id: string) => db.tables.billingCoupon.get(id) as Record<string, unknown>;
  const discounted = (id: string) => (invoiceRow(id)["discountMinor"] ?? null) !== null;

  return {
    db,
    coupons,
    invoices,
    provider,
    billingDeps,
    draft,
    issueCoupon,
    redeem,
    invoiceRow,
    couponRow,
    discounted,
  };
}

describe("two concurrent redemptions produce exactly one discount", () => {
  it("same coupon, two different invoices: one is discounted, the other refused and untouched", async () => {
    const h = harness();
    const couponId = await h.issueCoupon("LAUNCH20");
    const a = await h.draft();
    const b = await h.draft();
    h.db.holdReads("billingCoupon", 2);

    const results = await Promise.all([h.redeem("LAUNCH20", a), h.redeem("LAUNCH20", b)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.error.code).toBe("BUSINESS_RULE");
    expect([h.discounted(a), h.discounted(b)].filter(Boolean)).toHaveLength(1);

    const winnerInvoice = h.discounted(a) ? a : b;
    expect(h.couponRow(couponId)["status"]).toBe("redeemed");
    expect(h.couponRow(couponId)["redeemedInvoiceRef"]).toBe(winnerInvoice);
  });

  it("the PSP is asked for exactly one discounted amount and one full amount", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    const a = await h.draft();
    const b = await h.draft();
    h.db.holdReads("billingCoupon", 2);
    await Promise.all([h.redeem("LAUNCH20", a), h.redeem("LAUNCH20", b)]);

    for (const invoiceId of [a, b]) {
      await new IssueInvoice(h.billingDeps).execute({ invoiceId, tenantId: PLATFORM });
      const collected = await new CollectInvoice(h.billingDeps).execute({
        invoiceId,
        tenantId: PLATFORM,
      });
      expect(collected.ok).toBe(true);
    }
    expect(h.provider.moved.map((m) => m.amountMinor).sort((x, y) => x - y)).toEqual([2320, 2900]);
  });

  it("the same coupon twice onto the SAME invoice: discounted once, not twice", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    const invoiceId = await h.draft();
    h.db.holdReads("billingCoupon", 2);

    const results = await Promise.all([
      h.redeem("LAUNCH20", invoiceId),
      h.redeem("LAUNCH20", invoiceId),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(h.invoiceRow(invoiceId)["discountMinor"]).toBe(580);
  });

  it("eight racers: exactly one wins", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    const invoices = await Promise.all(Array.from({ length: 8 }, () => h.draft()));
    h.db.holdReads("billingCoupon", 8);

    const results = await Promise.all(invoices.map((id) => h.redeem("LAUNCH20", id)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(invoices.filter((id) => h.discounted(id))).toHaveLength(1);
  });

  it("two DIFFERENT coupons onto one invoice: one discount, and the loser's coupon is rolled back to `issued`", async () => {
    const h = harness();
    const first = await h.issueCoupon("FIRSTONE");
    const second = await h.issueCoupon("SECONDONE");
    const invoiceId = await h.draft();
    h.db.holdReads("invoice", 2);

    const results = await Promise.all([
      h.redeem("FIRSTONE", invoiceId),
      h.redeem("SECONDONE", invoiceId),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const redeemed = [first, second].filter((id) => h.couponRow(id)["status"] === "redeemed");
    const untouched = [first, second].filter((id) => h.couponRow(id)["status"] === "issued");
    expect(redeemed).toHaveLength(1);
    expect(untouched).toHaveLength(1);
    // The loser's coupon was NOT burned for nothing: it still redeems on a fresh invoice.
    const other = await h.draft();
    const code = untouched[0] === first ? "FIRSTONE" : "SECONDONE";
    expect((await h.redeem(code, other)).ok).toBe(true);
  });
});

describe("the repository's compare-and-swap, without any use case", () => {
  it("a second save of a coupon loaded at the same version is a ConcurrencyError", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    const tx = h.db.client([]);
    const one = await h.coupons.findByCode("LAUNCH20", PLATFORM, tx);
    const two = await h.coupons.findByCode("LAUNCH20", PLATFORM, tx);
    if (one === null || two === null) throw new Error("coupon missing");
    one.redeem("inv-a", "merchant-1", "e1", NOW);
    two.redeem("inv-b", "merchant-1", "e2", NOW);

    await h.coupons.save(one, PLATFORM, tx);
    await expect(h.coupons.save(two, PLATFORM, tx)).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe("persistence of the discount and the coupon's scope", () => {
  it("a redeemed discount round-trips through the invoice repository", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    const invoiceId = await h.draft(2900);
    expect((await h.redeem("LAUNCH20", invoiceId)).ok).toBe(true);

    const reloaded = await h.invoices.findById(invoiceId, PLATFORM, h.db.client([]));
    expect(reloaded?.discount?.amountMinor).toBe(580);
    expect(reloaded?.totalMinor).toBe(2320);
    expect(reloaded?.subtotal.amountMinor).toBe(2900);
  });

  it("a coupon is invisible to another tenant scope", async () => {
    const h = harness();
    const couponId = await h.issueCoupon("LAUNCH20");
    const tx = h.db.client([]);
    expect(await h.coupons.findByCode("LAUNCH20", "merchant-tenant", tx)).toBeNull();
    expect(await h.coupons.findById(couponId, "merchant-tenant", tx)).toBeNull();
    expect(await h.coupons.findById(couponId, PLATFORM, tx)).not.toBeNull();
  });

  it("redeeming from another tenant scope finds neither the coupon nor the invoice (404)", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    const invoiceId = await h.draft();
    const result = await h.redeem("LAUNCH20", invoiceId, "merchant-tenant");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });

  it("issuing a duplicate code in one tenant scope is a CONFLICT", async () => {
    const h = harness();
    await h.issueCoupon("LAUNCH20");
    await expect(h.issueCoupon("LAUNCH20")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
