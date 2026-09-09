import { PrismaOutboxStore, PrismaUnitOfWork, type TransactionClient } from "@platform/db";
import type { IntegrationEvent } from "@platform/domain-events";
import {
  FinanceEventTranslator,
  PaymentsCapturedConsumer,
  PrismaJournalRepository,
  RefundsIssuedConsumer,
  type FinanceConsumerDeps,
} from "@platform/finance";
import {
  KafkaMessageProducer,
  type MessagingMetrics,
  type SupervisedConsumer,
} from "@platform/kafka";
import { OutboxWriter, rootEventContext, type EventHandler } from "@platform/messaging";
import type { RuntimeCore } from "../composition";
import { buildProcessedConsumer } from "../security/consumer-runtime";
import {
  DEFAULT_FINANCE_POSTING_ACCOUNTS,
  TxBoundJournalRepository,
} from "./orders-paid.consumers";

/**
 * The `payments.payment_intent.captured`/`.refunded` wire payload — verified against the
 * producing context's own domain events (`services/payments/src/domain/events/
 * payment-captured.event.ts`, `payment-refunded.event.ts`): both carry exactly
 * `{ orderRef, amountMinor, currency }`, byte-identical to what Finance's `PaymentsCapturedConsumer`/
 * `RefundsIssuedConsumer` already declare — unlike `orders.order.paid` (see `OrderPaidPayload`),
 * no field-name adaptation is needed here.
 */
export interface PaymentSettlementPayload {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * WP-11 (F-11): `PaymentsCapturedConsumer`/`RefundsIssuedConsumer` (`services/finance/src/
 * interfaces/finance-consumers.ts:77,100`) had zero callers — every captured payment and every
 * issued refund posted no fee entry and no contra entry. Both call `postAndAppend` →
 * `deps.journals.append(result.value)` with no `tx`, which `PrismaJournalRepository.append`
 * rejects outright (ADR-0003 — same non-atomic-append hazard `FinanceOrdersPaidConsumer` exists to
 * fix for `OrdersPaidConsumer`, and the same fix shape: implement `handleAtomic`, wrap `journals` in
 * a fresh {@link TxBoundJournalRepository} bound to the transaction this specific call was handed,
 * and refuse the non-atomic path so a runtime built without a `unitOfWork` fails loudly instead of
 * risking a double-posted fee/contra entry on redelivery.
 *
 * One class, parameterized by which bare Finance consumer it wraps and which `LedgerPoster`
 * template that consumer posts through — `PaymentsCapturedConsumer` posts `forFee`,
 * `RefundsIssuedConsumer` posts `forRefund` (Finance's own classes, unchanged).
 */
abstract class AtomicFinanceSettlementConsumer implements EventHandler<
  PaymentSettlementPayload,
  TransactionClient
> {
  abstract readonly eventType: string;
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;

  protected constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }

  protected abstract buildInner(deps: FinanceConsumerDeps): EventHandler<PaymentSettlementPayload>;

  /** Rejects — see the class doc comment; reaching this means no `unitOfWork` was supplied. */
  handle(): Promise<void> {
    return Promise.reject(
      new Error(
        `${this.constructor.name} requires the atomic path: build its KafkaConsumerRuntime with ` +
          "a unitOfWork so handleAtomic runs the journal append and the inbox marker in one " +
          "transaction (ADR-0005). Posting the ledger on the non-atomic path risks double-posting " +
          "on redelivery — a ledger append is not idempotent by itself.",
      ),
    );
  }

  async handleAtomic(
    event: IntegrationEvent<PaymentSettlementPayload>,
    tx: TransactionClient,
  ): Promise<void> {
    const inner = this.buildInner({
      ...this.deps,
      journals: new TxBoundJournalRepository(this.deps.journals, tx),
    });
    await inner.handle(event);
  }
}

/** Wraps Finance's `PaymentsCapturedConsumer` (posts a `forFee` entry) with the atomic path. */
export class FinancePaymentsCapturedConsumer extends AtomicFinanceSettlementConsumer {
  readonly eventType = "payments.payment_intent.captured";

  constructor(deps: FinanceConsumerDeps) {
    super(deps);
  }

  protected buildInner(deps: FinanceConsumerDeps): EventHandler<PaymentSettlementPayload> {
    return new PaymentsCapturedConsumer(deps);
  }
}

/** Wraps Finance's `RefundsIssuedConsumer` (posts a `forRefund` contra entry) with the atomic path. */
export class FinanceRefundsIssuedConsumer extends AtomicFinanceSettlementConsumer {
  readonly eventType = "payments.payment_intent.refunded";

  constructor(deps: FinanceConsumerDeps) {
    super(deps);
  }

  protected buildInner(deps: FinanceConsumerDeps): EventHandler<PaymentSettlementPayload> {
    return new RefundsIssuedConsumer(deps);
  }
}

/**
 * The two payments-settlement Finance consumers (WP-11, F-11) — same construction shape as
 * `buildOrdersPaidConsumerRuntimes`: composed directly against `core.prisma` +
 * `core.config.TENANT_DEFAULT_ID` (ADR-0008), each with its own context-scoped `OutboxWriter`
 * (ADR-0003), through `buildProcessedConsumer` for the standard reliability envelope (Postgres
 * inbox idempotency, retry topics, DLQ topic + row). Both get a `unitOfWork` (unlike the three
 * self-idempotent `orders.order.paid` consumers) for the same reason `FinanceOrdersPaidConsumer`
 * does: a ledger append mints a fresh journal id per call with no unique constraint on
 * `sourceRef`, so it is not idempotent by itself and must commit atomically with the inbox marker.
 *
 * Separate consumer groups (`finance.payments-captured` / `finance.refunds-issued`), not shared
 * with `finance.orders-paid`: each wire event type needs its own redelivery/offset tracking, and a
 * poison message on one must not stall the other two.
 */
export function buildFinanceSettlementConsumerRuntimes(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): readonly SupervisedConsumer[] {
  const tenantId = core.config.TENANT_DEFAULT_ID;
  const unitOfWork = new PrismaUnitOfWork(core.prisma);
  const context = rootEventContext(core.idGenerator, tenantId);
  const journals = new PrismaJournalRepository({
    prisma: core.prisma,
    tenantId,
    outbox: new OutboxWriter({
      store: new PrismaOutboxStore(core.prisma),
      translator: new FinanceEventTranslator(),
      serializer: core.serializer,
      clock: core.clock,
      producer: "finance",
    }),
    context,
  });

  const deps: FinanceConsumerDeps = {
    journals,
    postingAccounts: DEFAULT_FINANCE_POSTING_ACCOUNTS,
    idGenerator: core.idGenerator,
    clock: core.clock,
  };

  const producer = new KafkaMessageProducer(core.kafka);

  return [
    buildProcessedConsumer<PaymentSettlementPayload, TransactionClient>(
      core,
      new FinancePaymentsCapturedConsumer(deps),
      "finance.payments-captured",
      producer,
      metrics,
      unitOfWork,
    ),
    buildProcessedConsumer<PaymentSettlementPayload, TransactionClient>(
      core,
      new FinanceRefundsIssuedConsumer(deps),
      "finance.refunds-issued",
      producer,
      metrics,
      unitOfWork,
    ),
  ];
}
