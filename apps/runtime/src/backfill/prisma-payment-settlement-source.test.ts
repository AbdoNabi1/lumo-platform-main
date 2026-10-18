import { describe, expect, it, vi } from "vitest";
import { PrismaPaymentSettlementSource } from "./prisma-payment-settlement-source";

/**
 * Pins this adapter's query shape against a Prisma double — the tenant filter and the status set
 * are what decide which money the settlement backfill posts, so they are asserted exactly. The
 * real-Postgres check its doc comment asks for is still owed; this does not replace it.
 */
function fakePrisma() {
  return {
    paymentIntent: {
      findMany: vi.fn(async () => [
        { orderRef: "ord-1", amountMinor: 12_500, currency: "EGP" },
        { orderRef: "ord-2", amountMinor: 900, currency: "USD" },
      ]),
    },
    refund: {
      findMany: vi.fn(async () => [
        {
          id: "ref-1",
          amountMinor: 2_500,
          occurredAt: new Date("2026-10-01T10:00:00.000Z"),
          intent: { orderRef: "ord-1", currency: "EGP" },
        },
      ]),
    },
  };
}

describe("PrismaPaymentSettlementSource", () => {
  it("lists only this tenant's intents in a state that implies a capture", async () => {
    const prisma = fakePrisma();
    const payments = await new PrismaPaymentSettlementSource(
      prisma as never,
      "tenant-a",
    ).listCapturedPayments();

    expect(prisma.paymentIntent.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        status: { in: ["captured", "partially_refunded", "refunded", "closed"] },
      },
      select: { orderRef: true, amountMinor: true, currency: true },
    });
    expect(payments).toEqual([
      { orderRef: "ord-1", amountMinor: 12_500, currency: "EGP" },
      { orderRef: "ord-2", amountMinor: 900, currency: "USD" },
    ]);
  });

  it("lists this tenant's completed refunds in the currency of the intent they refund", async () => {
    const prisma = fakePrisma();
    const refunds = await new PrismaPaymentSettlementSource(
      prisma as never,
      "tenant-a",
    ).listCompletedRefunds();

    expect(prisma.refund.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", status: "completed" },
      select: {
        id: true,
        amountMinor: true,
        occurredAt: true,
        intent: { select: { orderRef: true, currency: true } },
      },
    });
    expect(refunds).toEqual([
      {
        refundId: "ref-1",
        orderRef: "ord-1",
        amountMinor: 2_500,
        currency: "EGP",
        occurredAt: new Date("2026-10-01T10:00:00.000Z"),
      },
    ]);
  });
});
