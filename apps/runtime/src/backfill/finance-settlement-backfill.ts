import { Money, UniqueEntityId } from "@platform/domain";
import type { Clock, IdGenerator } from "@platform/contracts";
import {
  LedgerPoster,
  type Journal,
  type JournalRepository,
  type PostingAccounts,
} from "@platform/finance";
import { logger as defaultLogger, type Logger } from "@platform/utils";

/**
 * The minimal shape `PrismaUnitOfWork` (`@platform/db`) already satisfies — derived locally
 * rather than importing `TransactionalUnitOfWork` from `@platform/repository`, a package
 * `apps/runtime` does not otherwise depend on (same reasoning as `security/consumer-runtime.ts`'s
 * own `ConsumerUnitOfWork` derived type).
 */
export interface BackfillUnitOfWork {
  run<T>(work: (tx: unknown) => Promise<T>): Promise<T>;
}

/** One captured `PaymentIntent`, as read from Payments — WP-11 T11.3's fee-entry source. */
export interface CapturedPaymentRecord {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** One `completed` `Refund` child entity, as read from Payments — WP-11 T11.3's contra-entry source. */
export interface IssuedRefundRecord {
  readonly refundId: string;
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

/**
 * Read-only source for the backfill (WP-11 T11.3). Deliberately state-based, not event-based:
 * `PaymentIntent.capture()` (legacy, raises `payments.payment_intent.captured`) and
 * `PaymentIntent.markCaptured()` (Sprint 4.8 lifecycle, raises `payments.intent.captured` — a
 * DIFFERENT wire type nothing in Finance subscribes to) both leave the SAME persisted shape
 * (`status: "captured"`, a `Charge` row) with no record of which method produced it. The backfill
 * cannot and does not try to distinguish them — it reconciles the LEDGER against payment STATE
 * ("this order's payment is captured, does it have a fee entry"), which is the only thing that is
 * actually queryable after the fact and the only thing that actually matters financially.
 */
export interface PaymentSettlementSource {
  /** Every `PaymentIntent` whose status implies a capture happened (captured and everything downstream of it: partially_refunded, refunded, closed). */
  listCapturedPayments(): Promise<readonly CapturedPaymentRecord[]>;
  /** Every `Refund` child entity with `status: "completed"`, across every `PaymentIntent`. */
  listCompletedRefunds(): Promise<readonly IssuedRefundRecord[]>;
}

export interface FinanceSettlementBackfillDeps {
  readonly source: PaymentSettlementSource;
  readonly journals: JournalRepository;
  readonly postingAccounts: PostingAccounts;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly unitOfWork: BackfillUnitOfWork;
  readonly logger?: Logger;
  /**
   * ADR-0014 (WP-10 T10.3): `JournalRepository` now takes `tenantId` per call. This backfill
   * already operates on one known tenant per run (classified (C), legitimate, per ADR-0014
   * Decision point 4 — same as `PrismaPaymentSettlementSource`'s own explicit `tenantId`) — passed
   * through explicitly here rather than reintroducing a construction-time pin.
   */
  readonly tenantId: string;
}

export interface FinanceSettlementBackfillResult {
  readonly ordersInspected: number;
  readonly feeEntriesPosted: number;
  readonly contraEntriesPosted: number;
}

function requireMoney(amountMinor: number, currency: string): Money {
  const result = Money.create(amountMinor, currency);
  if (!result.ok) {
    throw new Error(
      `finance-settlement backfill: invalid money (${amountMinor} ${currency}): ` +
        result.error.fields.map((field) => field.message).join(", "),
    );
  }
  return result.value;
}

function countWithMemo(journals: readonly Journal[], memo: string): number {
  return journals.filter((journal) => journal.lines.some((line) => line.memo === memo)).length;
}

async function postFee(
  deps: FinanceSettlementBackfillDeps,
  payment: CapturedPaymentRecord,
  tx: unknown,
): Promise<void> {
  const amount = requireMoney(payment.amountMinor, payment.currency);
  const id = UniqueEntityId.from(deps.idGenerator.generate());
  const result = LedgerPoster.forFee(id, payment.orderRef, deps.postingAccounts, amount);
  if (!result.ok) throw result.error;
  result.value.post(`backfill:fee:${payment.orderRef}`, deps.clock.now());
  await deps.journals.append(result.value, deps.tenantId, tx);
}

async function postContra(
  deps: FinanceSettlementBackfillDeps,
  refund: IssuedRefundRecord,
  tx: unknown,
): Promise<void> {
  const amount = requireMoney(refund.amountMinor, refund.currency);
  const id = UniqueEntityId.from(deps.idGenerator.generate());
  const result = LedgerPoster.forRefund(id, refund.orderRef, deps.postingAccounts, amount);
  if (!result.ok) throw result.error;
  result.value.post(`backfill:refund:${refund.refundId}`, deps.clock.now());
  await deps.journals.append(result.value, deps.tenantId, tx);
}

/**
 * WP-11 (T11.3, F-11): posts the fee/contra entries every already-captured payment and
 * already-issued refund should have produced had `PaymentsCapturedConsumer`/
 * `RefundsIssuedConsumer` been registered from the start (T11.1 registers them for everything
 * from now on; this backfill covers everything from before).
 *
 * **Idempotent and re-runnable** — the property T11.3 requires, proven by
 * `finance-settlement-backfill.test.ts` running this twice and asserting the second run posts
 * nothing: for each order, already-posted entries are counted first
 * (`journals.findBySourceRef`, filtered by `JournalLine.memo`), and only the shortfall is posted.
 *
 * **Per-order dedup, not per-event** — `Journal.sourceRef` carries no unique constraint (same as
 * every live consumer relies on) and this process has no Kafka inbox marker to consult (these are
 * pre-registration payments/refunds that were never published to begin with, so there is no
 * message to dedupe against). The fee side is simple: at most one capture per order, so "does a
 * fee-memo journal already exist for this sourceRef" is a direct presence check. The refund side
 * needs more care because ONE order can have MULTIPLE refunds: this counts how many refund-memo
 * journals already exist for the order, sorts that order's completed refunds chronologically
 * (`occurredAt`), and skips exactly that many before posting the rest. This assumes existing
 * entries were posted in chronological order — true for both the live consumer (refunds are
 * issued and published one at a time) and a prior backfill run (this same function) — so a second
 * run always finds `existingCount === refundCount` and posts nothing further.
 *
 * Each order is reconciled inside its own transaction (`unitOfWork.run`), matching the atomic
 * append every live consumer uses (a ledger append is not idempotent by itself) — not one
 * transaction for the whole backfill, so a large backfill does not hold one Postgres transaction
 * open for its entire duration.
 */
export async function backfillFinanceSettlement(
  deps: FinanceSettlementBackfillDeps,
): Promise<FinanceSettlementBackfillResult> {
  const log = deps.logger ?? defaultLogger;
  const [captured, refunds] = await Promise.all([
    deps.source.listCapturedPayments(),
    deps.source.listCompletedRefunds(),
  ]);

  const refundsByOrder = new Map<string, IssuedRefundRecord[]>();
  for (const refund of refunds) {
    const bucket = refundsByOrder.get(refund.orderRef);
    if (bucket === undefined) refundsByOrder.set(refund.orderRef, [refund]);
    else bucket.push(refund);
  }

  const paymentsByOrder = new Map(captured.map((payment) => [payment.orderRef, payment]));
  const orderRefs = new Set<string>([...paymentsByOrder.keys(), ...refundsByOrder.keys()]);

  let feeEntriesPosted = 0;
  let contraEntriesPosted = 0;

  for (const orderRef of orderRefs) {
    const payment = paymentsByOrder.get(orderRef);
    const orderRefunds = (refundsByOrder.get(orderRef) ?? [])
      .slice()
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    await deps.unitOfWork.run(async (tx) => {
      const existing = await deps.journals.findBySourceRef(orderRef, deps.tenantId, tx);
      const existingFeeCount = countWithMemo(existing, "fee");
      const existingRefundCount = countWithMemo(existing, "refund");

      if (payment !== undefined && existingFeeCount === 0) {
        await postFee(deps, payment, tx);
        feeEntriesPosted += 1;
      }

      for (const refund of orderRefunds.slice(existingRefundCount)) {
        await postContra(deps, refund, tx);
        contraEntriesPosted += 1;
      }
    });
  }

  const result: FinanceSettlementBackfillResult = {
    ordersInspected: orderRefs.size,
    feeEntriesPosted,
    contraEntriesPosted,
  };
  log.info("finance-settlement backfill complete", { ...result });
  return result;
}
