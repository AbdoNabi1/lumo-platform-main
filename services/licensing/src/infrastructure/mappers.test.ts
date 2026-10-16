import { UniqueEntityId } from "@platform/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { Credit } from "../domain/credit";
import { UsageCounter } from "../domain/usage-counter";
import { CreditMapper, InvoiceMapper, SubscriptionMapper, UsageCounterMapper } from "./mappers";

const ID = UniqueEntityId.from("row-1");

describe("UsageCounterMapper (WP-11, F-07)", () => {
  it("toRow writes the exact decimal string, never a JS number", () => {
    const counter = UsageCounter.create(ID, "tenant-1", "api_calls", "e1", new Date());
    counter.recordUsage(19.9999, "gb", new Date(), "e2");

    const row = UsageCounterMapper.toRow(counter, "tenant-1");

    expect(row.amount).toBe("19.9999");
    expect(typeof row.amount).toBe("string");
  });

  it("toDomain round-trips a Prisma.Decimal-shaped value (decimal.js instance) with no precision loss", () => {
    // `Prisma.Decimal` IS a decimal.js `Decimal` under the hood — this simulates exactly what a
    // real query against the Decimal(19,4) column returns, not just a string.
    const counter = UsageCounterMapper.toDomain({
      id: "row-1",
      tenantRef: "tenant-1",
      resource: "api_calls",
      amount: new Decimal("19.9999"),
      unit: "gb",
      lastRecordedAt: null,
      version: 1,
    });

    expect(counter.amount).toBe(19.9999);
    expect(counter.amountDecimalString).toBe("19.9999");
  });
});

describe("CreditMapper (WP-11, F-07)", () => {
  it("toRow writes the exact decimal string, never a JS number", () => {
    const credit = Credit.grant(ID, "tenant-1", 19.9999, "promo", "e1", new Date());

    const row = CreditMapper.toRow(credit, "tenant-1");

    expect(row.amount).toBe("19.9999");
    expect(typeof row.amount).toBe("string");
  });

  it("toDomain round-trips a Prisma.Decimal-shaped value with no precision loss", () => {
    const credit = CreditMapper.toDomain({
      id: "row-1",
      tenantRef: "tenant-1",
      amount: new Decimal("19.9999"),
      reason: "promo",
      status: "granted",
      version: 0,
    });

    expect(credit.amount).toBe(19.9999);
    expect(credit.amountDecimalString).toBe("19.9999");
  });
});

describe("InvoiceMapper (WP-14, Trap 3)", () => {
  const row = (lineItems: unknown) => ({
    id: "inv-1",
    tenantRef: "merchant-1",
    subscriptionRef: "sub-1",
    currency: "EGP",
    lineItems: lineItems as never,
    status: "issued" as const,
    paymentReference: null,
    discountMinor: null,
    discountCouponRef: null,
    version: 1,
  });

  it("round-trips a coupon discount, and a null pair means no discount", () => {
    const plain = InvoiceMapper.toDomain(row([{ description: "plan", amountMinor: 2900 }]));
    expect(plain.discount).toBeUndefined();
    expect(InvoiceMapper.toRow(plain, "platform")).toMatchObject({
      discountMinor: null,
      discountCouponRef: null,
    });

    const discounted = InvoiceMapper.toDomain({
      ...row([{ description: "plan", amountMinor: 2900 }]),
      discountMinor: 580,
      discountCouponRef: "coupon-1",
    });
    expect(discounted.totalMinor).toBe(2320);
    expect(InvoiceMapper.toRow(discounted, "platform")).toMatchObject({
      discountMinor: 580,
      discountCouponRef: "coupon-1",
    });
  });

  it("refuses a half-recorded discount rather than charging a guess", () => {
    expect(() =>
      InvoiceMapper.toDomain({
        ...row([{ description: "plan", amountMinor: 2900 }]),
        discountMinor: 580,
      }),
    ).toThrow(/discount/i);
  });

  it("refuses a persisted discount larger than its subtotal (a corrupt row is not charged)", () => {
    expect(() =>
      InvoiceMapper.toDomain({
        ...row([{ description: "plan", amountMinor: 2900 }]),
        discountMinor: 5000,
        discountCouponRef: "coupon-1",
      }),
    ).toThrow(/negative/i);
  });

  it("round-trips integer minor-unit line items exactly", () => {
    const invoice = InvoiceMapper.toDomain(row([{ description: "plan", amountMinor: 2900 }]));
    expect(invoice.totalMinor).toBe(2900);
    expect(InvoiceMapper.toRow(invoice, "platform").lineItems).toEqual([
      { description: "plan", amountMinor: 2900 },
    ]);
  });

  it("refuses a pre-convention row (`amount`, unit unknown) instead of guessing its unit", () => {
    expect(() => InvoiceMapper.toDomain(row([{ description: "plan", amount: 29 }]))).toThrow(
      /amountMinor/,
    );
  });

  it("refuses a fractional amountMinor", () => {
    expect(() => InvoiceMapper.toDomain(row([{ description: "plan", amountMinor: 29.5 }]))).toThrow(
      /amountMinor/,
    );
  });
});

describe("SubscriptionMapper (WP-14)", () => {
  it("revives the JSONB renewal schedule's date — JSON hands back a string, the domain needs a Date", () => {
    const subscription = SubscriptionMapper.toDomain({
      id: "sub-1",
      tenantRef: "merchant-1",
      planVersionRef: "plan-1-v1",
      status: "active",
      renewalSchedule: { cycleDays: 30, nextRenewalAt: "2026-10-01T00:00:00.000Z" as never },
      gracePeriodDays: null,
      retryPolicy: null,
      cancellationReason: null,
      pausedUntil: null,
      version: 1,
    });
    expect(subscription.renewalSchedule?.nextRenewalAt).toBeInstanceOf(Date);
    expect(subscription.renewalSchedule?.nextRenewalAt.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
});
