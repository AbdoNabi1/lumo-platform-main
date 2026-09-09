import type { Database } from "@platform/db";
import type {
  CapturedPaymentRecord,
  IssuedRefundRecord,
  PaymentSettlementSource,
} from "./finance-settlement-backfill";

/**
 * `PaymentIntent.status` values (`services/payments/src/domain/value-objects/payment-status.ts`)
 * that imply a capture happened at some point — legacy `captured` and every Sprint 4.8 state
 * downstream of it. `requires_payment`/`processing`/`authorized`/`capture_requested`/`failed`/
 * `cancelled`/`expired` are deliberately excluded: none of them has posted a `Charge`.
 */
const CAPTURED_STATUSES = ["captured", "partially_refunded", "refunded", "closed"] as const;

/**
 * Real Prisma-backed {@link PaymentSettlementSource} (WP-11 T11.3) — reads `payments.payment_intents`/
 * `payments.refunds` directly rather than going through `PaymentIntentRepository` (which has no
 * "list" method at all; it is keyed strictly by id/idempotency-key/PSP-reference, per its own doc
 * comments — a bulk backfill read is a different access pattern than that port was built for).
 *
 * **Not exercised against a real database in this session** — this repository has no
 * `DATABASE_URL_TEST` configured here, so this class is untested beyond `tsc --noEmit`. The
 * algorithm it feeds (`backfillFinanceSettlement`) is fully unit-tested against seeded in-memory
 * fixtures (`finance-settlement-backfill.test.ts`); only this adapter's own Prisma query shape is
 * unverified. Read both queries once against a real (or seeded local Docker) Postgres before
 * trusting this in production.
 */
export class PrismaPaymentSettlementSource implements PaymentSettlementSource {
  private readonly prisma: Database;
  private readonly tenantId: string;

  constructor(prisma: Database, tenantId: string) {
    this.prisma = prisma;
    this.tenantId = tenantId;
  }

  async listCapturedPayments(): Promise<readonly CapturedPaymentRecord[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: { tenantId: this.tenantId, status: { in: [...CAPTURED_STATUSES] } },
      select: { orderRef: true, amountMinor: true, currency: true },
    });
    return rows.map((row) => ({
      orderRef: row.orderRef,
      amountMinor: row.amountMinor,
      currency: row.currency,
    }));
  }

  async listCompletedRefunds(): Promise<readonly IssuedRefundRecord[]> {
    const rows = await this.prisma.refund.findMany({
      where: { tenantId: this.tenantId, status: "completed" },
      select: {
        id: true,
        amountMinor: true,
        occurredAt: true,
        // `Refund` carries no `currency` column of its own — every refund is against a specific
        // captured intent, in that intent's currency (Money forbids mixed-currency operations
        // elsewhere in this codebase; refunding in a different currency than the capture is not a
        // modeled case), so it is read off the parent via this relation, not duplicated storage.
        intent: { select: { orderRef: true, currency: true } },
      },
    });
    return rows.map((row) => ({
      refundId: row.id,
      orderRef: row.intent.orderRef,
      amountMinor: row.amountMinor,
      currency: row.intent.currency,
      occurredAt: row.occurredAt,
    }));
  }
}
