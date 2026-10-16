import { PrismaOutboxStore, PrismaUnitOfWork, type TransactionClient } from "@platform/db";
import {
  readEnvelopeTenant,
  requireEnvelopeTenant,
  type IntegrationEvent,
} from "@platform/domain-events";
import {
  FinanceEventTranslator,
  OrdersPaidConsumer,
  PrismaJournalRepository,
  type FinanceConsumerDeps,
  type Journal,
  type JournalRepository,
  type PostingAccounts,
} from "@platform/finance";
import {
  KafkaMessageProducer,
  type MessagingMetrics,
  type SupervisedConsumer,
} from "@platform/kafka";
import {
  DEFAULT_LOYALTY_TIERS,
  EarnPoints,
  LoyaltyEventTranslator,
  PrismaLoyaltyAccountRepository,
  type LoyaltyAccountRepository,
} from "@platform/loyalty";
import {
  OutboxWriter,
  rootEventContext,
  type EventHandler,
  type IntegrationEventTranslator,
} from "@platform/messaging";
import {
  CreateNotification,
  NotificationsEventTranslator,
  PrismaNotificationRepository,
} from "@platform/notifications";
import {
  IdentityEventTranslator,
  PrismaProfileHistoryStore,
  PrismaProfileStore,
  UpdateProfileProjection,
} from "@platform/customer-360";
import type { Logger } from "@platform/utils";
import type { RuntimeCore } from "../composition";
import { buildProcessedConsumer } from "../security/consumer-runtime";

/**
 * The wire event type these four consumers subscribe to. The remediation plan's Task 17 text says
 * `orders.paid`, which exists nowhere in this codebase: Orders' `OrderPaid` domain event
 * (`services/orders/src/domain/events/order-paid.event.ts`) is translated by
 * `OrderEventTranslator` to `orders.order.paid` and that is the string listed in
 * `ORDERS_PUBLISHED_EVENTS`. Subscribing to the plan's literal would have produced four consumers
 * on a topic no producer ever writes — the exact silent-no-op class of defect C-2 exists to remove.
 */
export const ORDERS_ORDER_PAID = "orders.order.paid";
const ORDERS_ORDER_PAID_VERSION = 1;

/**
 * The `orders.order.paid` wire payload — a structural mirror of Orders' own `OrderPaidData`
 * (`services/orders/src/domain/events/order-paid.event.ts`, published verbatim by
 * `OrderEventTranslator`). Restated here rather than imported because Orders does not export the
 * type from `@platform/orders`, and because a consumer binding to a producer's *internal* domain
 * type would couple the two contexts at the code level — the convention every other cross-context
 * seam in this repo follows (see `PaymentCapturedPayload`).
 *
 * Note `orderNumber`, not `orderId`: the paid event carries the business order number, and that is
 * what every mapping below uses as the order's reference.
 */
export interface OrderPaidPayload {
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly paymentRef: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
}

/**
 * Chart-of-accounts references Finance's `LedgerPoster` posts commerce events to. Duplicated
 * verbatim from `apps/admin/src/composition.ts`'s private `DEFAULT_FINANCE_POSTING_ACCOUNTS`
 * (the two apps do not import each other), so the ledger this worker writes uses the same accounts
 * the admin surface's Finance screens read. Exported (WP-11) for `finance-settlement.consumers.ts`
 * to reuse directly — that file lives in this same app, so duplicating it a second time would
 * repeat the cross-app justification above for no reason.
 */
export const DEFAULT_FINANCE_POSTING_ACCOUNTS: PostingAccounts = {
  revenue: "4000-REVENUE",
  receivable: "1200-ACCOUNTS-RECEIVABLE",
  cogs: "5000-COGS",
  inventory: "1300-INVENTORY",
  refundContra: "4900-REFUNDS",
  expense: "6000-EXPENSES",
  cash: "1000-CASH",
  fees: "6100-FEES",
};

/**
 * Points earned per paid order (Task 17b). **Placeholder policy, not a discovered spec**: nothing
 * in this codebase, in Loyalty's domain model, or in any plan document states an earning rate — 1
 * point per 100 minor currency units (i.e. per major unit) is a deliberately plain, defensible
 * default chosen so the wiring can be exercised end to end, in the same spirit as
 * `DEFAULT_LOYALTY_TIERS` and `DEFAULT_FINANCE_POSTING_ACCOUNTS`. **Needs product confirmation
 * before this is treated as the real accrual rule** (rounding direction, per-currency rates, and
 * whether tax/shipping are excluded from the base are all open questions this does not answer).
 */
export function pointsForPaidOrder(totalAmountMinor: number): number {
  return Math.floor(totalAmountMinor / 100);
}

/**
 * Binds a `JournalRepository` to ONE already-open transaction, so a caller that passes no `tx`
 * still writes inside that transaction rather than outside every transaction.
 *
 * `PrismaJournalRepository.append` calls `requireTx` and throws without a transaction client
 * (ADR-0003 — the ledger row and its outbox row must commit together), but
 * `OrdersPaidConsumer.handle` calls `journals.append(journal)` with no `tx` (it predates any
 * caller and was never exercised against the Prisma repository — it had zero callers before this
 * task). Finance's consumer is deliberately left untouched; the transaction is supplied here.
 *
 * The transaction is handed IN (from `KafkaConsumerRuntime`'s atomic path) rather than opened here:
 * an earlier revision of this file opened its own `prisma.$transaction` per append, which by
 * construction could not also contain the inbox idempotency marker — leaving a crash window in
 * which a redelivered `orders.order.paid` posted a SECOND balanced journal entry for the same
 * order (fresh `idGenerator.generate()` id; `Journal.sourceRef` carries only an index, no unique
 * constraint, so the database would not have stopped it either). See
 * {@link FinanceOrdersPaidConsumer.handleAtomic}. Exported (WP-11) — `finance-settlement.
 * consumers.ts` needs the identical wrapper for `PaymentsCapturedConsumer`/`RefundsIssuedConsumer`,
 * which have the exact same non-atomic-append problem `FinanceOrdersPaidConsumer` was built to fix.
 */
export class TxBoundJournalRepository implements JournalRepository {
  private readonly inner: JournalRepository;
  private readonly tx: TransactionClient;

  constructor(inner: JournalRepository, tx: TransactionClient) {
    this.inner = inner;
    this.tx = tx;
  }

  async append(journal: Journal, tenantId: string, tx?: unknown): Promise<void> {
    await this.inner.append(journal, tenantId, tx ?? this.tx);
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Journal | null> {
    return this.inner.findById(id, tenantId, tx ?? this.tx);
  }

  async findBySourceRef(
    sourceRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Journal[]> {
    return this.inner.findBySourceRef(sourceRef, tenantId, tx ?? this.tx);
  }
}

/**
 * Adapts the `orders.order.paid` wire payload to the shape Finance's own `OrdersPaidConsumer`
 * reads, and posts the ledger entry ATOMICALLY with the inbox idempotency marker (Task 17b, C-2).
 *
 * *Payload* — Finance's consumer declares `{ orderRef, amountMinor, currency }`, but the event
 * Orders actually publishes carries `{ orderNumber, customerRef, paymentRef, currency,
 * totalAmountMinor }`; the two were never reconciled because the consumer had no callers.
 * Registering it unadapted would post `Money.create(undefined, ...)` against `sourceRef: undefined`.
 * The class itself is deliberately left untouched (it is Finance's, not the runtime's, and the same
 * payload shape is shared with the payments/refunds consumers); the translation lives here, in the
 * composition root, where cross-context shape mismatches belong.
 *
 * *Atomicity* — this is the one consumer of the four that is NOT idempotent by its own logic:
 * Loyalty dedupes on `idempotencyKey`, Notifications on `idempotencyKey`, Customer 360 on
 * `occurredAt` freshness, but a ledger append mints a fresh journal id every call and `Journal`
 * has no unique constraint on `sourceRef`. On `KafkaConsumerRuntime`'s NON-atomic path the domain
 * write commits first and the inbox marker second, in a separate transaction — a crash or a
 * consumer-group rebalance in between makes Kafka redeliver the event and this consumer post a
 * SECOND balanced entry for the same order: double revenue, double receivable, silently. So it
 * implements `handleAtomic` (ADR-0005's opt-in atomic capability) and
 * `buildOrdersPaidConsumerRuntimes` gives ITS runtime — and only its runtime — a `unitOfWork`,
 * which makes the runtime commit the journal rows, their outbox rows, and the processed-event
 * marker in one transaction.
 *
 * `handle` therefore refuses to run: reaching it means the runtime was built without a
 * `unitOfWork`, and posting money non-atomically is exactly the defect `handleAtomic` exists to
 * prevent. Failing loudly (retry → DLQ, one visible error) is strictly better than double-posting
 * quietly.
 */
export class FinanceOrdersPaidConsumer implements EventHandler<
  OrderPaidPayload,
  TransactionClient
> {
  readonly eventType = ORDERS_ORDER_PAID;
  readonly eventVersion = ORDERS_ORDER_PAID_VERSION;
  private readonly deps: FinanceConsumerDeps;

  /**
   * `deps.journals` must accept a per-call `tx` (as `PrismaJournalRepository` does) — see above.
   *
   * **Tenant (G-64).** The ledger is posted under the tenant on the message's own envelope, never a
   * deployment default. An envelope with no tenant THROWS to the retry/DLQ pipeline: a paid order
   * with no ledger entry is missing money, and acking it quietly would hide that.
   */
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }

  /** Rejects (rather than throwing synchronously) so every caller sees the same failure shape. */
  handle(): Promise<void> {
    return Promise.reject(
      new Error(
        "FinanceOrdersPaidConsumer requires the atomic path: build its KafkaConsumerRuntime with " +
          "a unitOfWork so handleAtomic runs the journal append and the inbox marker in one " +
          "transaction (ADR-0005). Posting the ledger on the non-atomic path risks double-posting " +
          "revenue on redelivery — a ledger append is not idempotent by itself.",
      ),
    );
  }

  async handleAtomic(
    event: IntegrationEvent<OrderPaidPayload>,
    tx: TransactionClient,
  ): Promise<void> {
    const tenantId = requireEnvelopeTenant(event, "FinanceOrdersPaidConsumer");
    const inner = new OrdersPaidConsumer({
      ...this.deps,
      journals: new TxBoundJournalRepository(this.deps.journals, tx),
    });
    await inner.handle({
      ...event,
      tenantId,
      payload: {
        orderRef: event.payload.orderNumber,
        amountMinor: event.payload.totalAmountMinor,
        currency: event.payload.currency,
      },
    });
  }
}

export interface LoyaltyOrdersPaidConsumerDeps {
  readonly accounts: LoyaltyAccountRepository;
  readonly earnPoints: EarnPoints;
  readonly logger: Logger;
}

/**
 * Earns loyalty points for a paid order (Task 17b, C-2).
 *
 * Resolves the event's `customerRef` to a loyalty account via `findByCustomerRef`. **A customer
 * with no loyalty account is a normal outcome, not an error** — opting into loyalty is a separate,
 * explicit `OpenAccount` action, and the large majority of orders will come from customers who
 * never did. Such an event is skipped (logged at debug), because throwing would send every
 * non-member's order through the retry topics and into the DLQ.
 *
 * **A non-`active` account is skipped for the same reason.** `LoyaltyAccount.earn` calls
 * `requireActive()` and throws `BusinessRuleError` for a suspended or closed account, so letting
 * the call through would retry-then-DLQ every paid order from that customer — permanently, since
 * `closed` is a terminal state in `canTransitionAccount`'s table and never becomes active again.
 * The status is checked BEFORE calling `EarnPoints` rather than by catching the domain error,
 * because a `BusinessRuleError` from deeper in the use case is a genuine failure that must still
 * reach the DLQ. (Read-then-act: an account suspended in the gap between this read and the earn
 * still throws and retries — benign and self-correcting, since the retry re-reads the status.)
 *
 * **An order earning 0 points is skipped too** — see the inline comment in `handle`.
 *
 * `EarnPoints` is idempotent by `idempotencyKey`, so the key is derived deterministically from the
 * event (`orders.order.paid:earn:<orderNumber>`) rather than freshly generated: at-least-once
 * delivery must never accrue points twice for one order.
 */
export class LoyaltyOrdersPaidConsumer implements EventHandler<OrderPaidPayload> {
  readonly eventType = ORDERS_ORDER_PAID;
  readonly eventVersion = ORDERS_ORDER_PAID_VERSION;
  private readonly deps: LoyaltyOrdersPaidConsumerDeps;

  constructor(deps: LoyaltyOrdersPaidConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<OrderPaidPayload>): Promise<void> {
    const { customerRef, orderNumber, totalAmountMinor } = event.payload;
    // G-64: the tenant is the envelope's. Earning points ADDS standing, so a message with no tenant
    // is REFUSED (nothing read, nothing written, an error logged) — a skipped earn denies.
    const tenantId = readEnvelopeTenant(event);
    if (tenantId === null) {
      this.deps.logger.error("loyalty: orders.order.paid has no tenant on the envelope — refused", {
        messageId: event.messageId,
        orderNumber,
      });
      return;
    }
    const account = await this.deps.accounts.findByCustomerRef(customerRef, tenantId);
    if (account === null) {
      this.deps.logger.debug("loyalty: no account for customer, skipping earn", {
        orderNumber,
        eventType: this.eventType,
      });
      return;
    }
    if (account.status.value !== "active") {
      this.deps.logger.info("loyalty: account is not active, skipping earn", {
        orderNumber,
        accountStatus: account.status.value,
        eventType: this.eventType,
      });
      return;
    }

    // A zero-point earn is skipped for the same reason as the two cases above: it is a normal
    // outcome, not an error. `pointsForPaidOrder` floors to whole major units, so any order under
    // 100 minor units earns 0 — and calling `EarnPoints` anyway would write a 0-point ledger
    // transaction and raise a `points.earned` event that asserts nothing happened, polluting both
    // the customer's visible transaction history and every downstream consumer of that event.
    const points = pointsForPaidOrder(totalAmountMinor);
    if (points === 0) {
      this.deps.logger.debug("loyalty: order earns no points, skipping earn", {
        orderNumber,
        totalAmountMinor,
        eventType: this.eventType,
      });
      return;
    }

    const result = await this.deps.earnPoints.execute({
      accountId: account.id.toString(),
      idempotencyKey: `${ORDERS_ORDER_PAID}:earn:${orderNumber}`,
      points,
      ref: orderNumber,
      tenantId,
    });
    if (!result.ok) throw result.error;
  }
}

export interface Customer360OrdersPaidConsumerDeps {
  readonly updateProfileProjection: UpdateProfileProjection;
  readonly logger: Logger;
}

/**
 * Projects a paid order onto the Customer 360 profile (Task 17b, C-2). Until now the Profile
 * Engine's only write path (`UpdateProfileProjection`) had no upstream consumer at all — it is
 * deliberately generic over *what* asserted a field, and this is the first context to assert one.
 *
 * Field mapping — a **placeholder projection decision**, not a documented spec:
 *  - `field: "lastOrderRef"` / `value: orderNumber` — the smallest useful fact a paid order
 *    asserts about a customer. Richer derived fields (lifetime value, order count) are *computed*
 *    attributes, which belong to the Computed Attributes Engine, not to a raw field assertion.
 *  - `source: "orders"` — the producing context, matching `ProfileField.source`'s own documented
 *    example values.
 *  - `confidence: "verified"` — a paid order is an authoritative system-of-record write, which is
 *    exactly what `verified` means here (as opposed to `inferred`, for derived/estimated values).
 *  - `identifier: { type: "customer_id", value: customerRef }` — `IdentifierRef.type` is
 *    `@platform/tracking`'s `IdentifierType` union, which has no `customerRef` member;
 *    `customer_id` is the member that denotes exactly this (a customer-system identifier).
 *  - `occurredAt: event.occurredAt` — the instant the order was paid, NOT "now":
 *    `applyFieldUpdate`'s freshness guard compares this against the value already on file, so
 *    passing the clock would let a replayed old event overwrite a newer fact.
 */
export class Customer360OrdersPaidConsumer implements EventHandler<OrderPaidPayload> {
  readonly eventType = ORDERS_ORDER_PAID;
  readonly eventVersion = ORDERS_ORDER_PAID_VERSION;
  private readonly deps: Customer360OrdersPaidConsumerDeps;

  constructor(deps: Customer360OrdersPaidConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<OrderPaidPayload>): Promise<void> {
    // G-64: the profile row is scoped by the envelope's tenant. A projection write with no tenant is
    // REFUSED (nothing written, error logged) — a skipped write denies.
    const tenantId = readEnvelopeTenant(event);
    if (tenantId === null) {
      this.deps.logger.error(
        "customer360: orders.order.paid has no tenant on the envelope — refused",
        { messageId: event.messageId },
      );
      return;
    }
    const result = await this.deps.updateProfileProjection.execute({
      tenantId,
      identifier: { type: "customer_id", value: event.payload.customerRef },
      field: "lastOrderRef",
      value: event.payload.orderNumber,
      source: "orders",
      confidence: "verified",
      occurredAt: event.occurredAt,
    });
    if (!result.ok) throw result.error;
  }
}

export interface NotificationsOrdersPaidConsumerDeps {
  readonly createNotification: CreateNotification;
  readonly logger: Logger;
}

/**
 * Opens an order-confirmation notification for a paid order (Task 17b, C-2).
 *
 * The template/channel/retry conventions are NOT invented here — they reuse the ones
 * `apps/admin/src/infrastructure/cross-context/orders-notification.adapter.ts` already established
 * for order-lifecycle notifications (single `email` channel, `maxAttempts: 3`, an
 * `orders:<orderNumber>` `sourceRef`, and order facts interpolated through `variables` rather than
 * baked into the pattern strings). Only the template id and body differ, because this is a
 * confirmation rather than a generic status change.
 *
 * `idempotencyKey` is derived from the event, not generated: `CreateNotification` is idempotent by
 * that key, so a redelivered `orders.order.paid` returns the already-created notification instead
 * of minting a second confirmation.
 *
 * **Known limitation (deliberate scope, Task 17b):** this creates the notification and stops —
 * `QueueNotification`/`SendNotification` are not called. Every delivery provider in this codebase
 * is still an offline in-memory stub (`services/notifications/src/infrastructure/
 * in-memory-port-adapters.ts`), so driving the send half from here would move nothing real; the
 * created row is the durable, idempotent record the delivery half consumes once real providers
 * exist.
 */
export class NotificationsOrdersPaidConsumer implements EventHandler<OrderPaidPayload> {
  readonly eventType = ORDERS_ORDER_PAID;
  readonly eventVersion = ORDERS_ORDER_PAID_VERSION;
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;
  private readonly deps: NotificationsOrdersPaidConsumerDeps;

  constructor(deps: NotificationsOrdersPaidConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<OrderPaidPayload>): Promise<void> {
    const { orderNumber, customerRef, currency, totalAmountMinor } = event.payload;
    // G-64: the notification is created under the envelope's tenant. With none it is REFUSED
    // (nothing created, error logged): mailing a customer under a guessed tenant is worse than not.
    const tenantId = readEnvelopeTenant(event);
    if (tenantId === null) {
      this.deps.logger.error(
        "notifications: orders.order.paid has no tenant on the envelope — refused",
        { messageId: event.messageId, orderNumber },
      );
      return;
    }
    const result = await this.deps.createNotification.execute({
      tenantId,
      idempotencyKey: `${ORDERS_ORDER_PAID}:confirmation:${orderNumber}`,
      sourceRef: `orders:${orderNumber}`,
      recipientRef: customerRef,
      channels: ["email"],
      templateId: "order-confirmation",
      bodyPattern:
        "Order {{orderNumber}} is confirmed. Total paid: {{totalAmountMinor}} {{currency}}.",
      subjectPattern: "Order {{orderNumber}} confirmed",
      variables: {
        orderNumber,
        currency,
        totalAmountMinor: String(totalAmountMinor),
      },
      maxAttempts: NotificationsOrdersPaidConsumer.DEFAULT_MAX_ATTEMPTS,
    });
    if (!result.ok) throw result.error;
  }
}

/**
 * The four `orders.order.paid` consumers (C-2, Task 17b) — the reactions a paid order is supposed
 * to trigger and, until this file existed, did not: nothing subscribed to `orders.order.paid`
 * anywhere in this repo, so a paid order posted no ledger entry, earned no loyalty points, updated
 * no customer profile, and created no confirmation notification.
 *
 * Each slice is composed directly against `core.prisma`, taking the tenant from each message's
 * envelope (ADR-0008, G-64) with its own context-scoped `OutboxWriter` (ADR-0003), exactly like
 * `buildPaymentCapturedRuntime` — deliberately bypassing `apps/admin`'s HTTP-controller
 * composition, because a consumer calls the APPLICATION layer only, never a Controller. Every
 * consumer goes through `buildProcessedConsumer`, so all four get the standard reliability
 * envelope (Postgres inbox idempotency, retry topics, DLQ topic + row) over one shared producer.
 *
 * Consumer groups are per-context (`finance.` / `loyalty.` / `customer360.` /
 * `notifications.orders-paid`), not one shared group: each context must see every paid order
 * independently, and one context's poison message must not stall the other three.
 */
export function buildOrdersPaidConsumerRuntimes(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): readonly SupervisedConsumer[] {
  const unitOfWork = new PrismaUnitOfWork(core.prisma);
  // No tenant here on purpose (G-64): every repository merges the PER-CALL tenant into this context
  // (`{ ...context, tenantId }`), and each consumer takes that tenant from the message envelope.
  const context = rootEventContext(core.idGenerator);
  const outboxFor = (
    translator: IntegrationEventTranslator,
    producerName: string,
  ): OutboxWriter<TransactionClient> =>
    new OutboxWriter({
      store: new PrismaOutboxStore(core.prisma),
      translator,
      serializer: core.serializer,
      clock: core.clock,
      producer: producerName,
    });

  const journals = new PrismaJournalRepository({
    prisma: core.prisma,
    outbox: outboxFor(new FinanceEventTranslator(), "finance"),
    context,
  });

  const loyaltyAccounts = new PrismaLoyaltyAccountRepository({
    prisma: core.prisma,
    outbox: outboxFor(new LoyaltyEventTranslator(), "loyalty"),
    context,
    tiers: DEFAULT_LOYALTY_TIERS,
  });

  const customer360Outbox = outboxFor(new IdentityEventTranslator(), "customer360");

  const producer = new KafkaMessageProducer(core.kafka);
  const build = <T>(handler: EventHandler<T>, consumerGroup: string): SupervisedConsumer =>
    buildProcessedConsumer<T>(core, handler, consumerGroup, producer, metrics);

  return [
    // Finance alone gets the `unitOfWork`: it is the only one of the four whose effect is not
    // idempotent by its own logic, so its journal append and the inbox marker must commit
    // together (see `FinanceOrdersPaidConsumer`). The other three stay on the non-atomic path —
    // giving them a transaction would buy nothing and would hold a Postgres connection open
    // across work that already tolerates redelivery.
    buildProcessedConsumer<OrderPaidPayload, TransactionClient>(
      core,
      new FinanceOrdersPaidConsumer({
        journals,
        postingAccounts: DEFAULT_FINANCE_POSTING_ACCOUNTS,
        idGenerator: core.idGenerator,
        clock: core.clock,
      }),
      "finance.orders-paid",
      producer,
      metrics,
      unitOfWork,
    ),
    build(
      new LoyaltyOrdersPaidConsumer({
        accounts: loyaltyAccounts,
        earnPoints: new EarnPoints({
          accounts: loyaltyAccounts,
          unitOfWork,
          idGenerator: core.idGenerator,
          clock: core.clock,
          tiers: DEFAULT_LOYALTY_TIERS,
        }),
        logger: core.logger,
      }),
      "loyalty.orders-paid",
    ),
    build(
      new Customer360OrdersPaidConsumer({
        updateProfileProjection: new UpdateProfileProjection({
          profiles: new PrismaProfileStore({
            prisma: core.prisma,
            idGenerator: core.idGenerator,
          }),
          history: new PrismaProfileHistoryStore({
            prisma: core.prisma,
            outbox: customer360Outbox,
            context,
            idGenerator: core.idGenerator,
          }),
          unitOfWork,
          idGenerator: core.idGenerator,
          clock: core.clock,
        }),
        logger: core.logger,
      }),
      "customer360.orders-paid",
    ),
    build(
      new NotificationsOrdersPaidConsumer({
        createNotification: new CreateNotification({
          notifications: new PrismaNotificationRepository({
            prisma: core.prisma,
            outbox: outboxFor(new NotificationsEventTranslator(), "notifications"),
            context,
          }),
          unitOfWork,
          idGenerator: core.idGenerator,
          clock: core.clock,
        }),
        logger: core.logger,
      }),
      "notifications.orders-paid",
    ),
  ];
}
