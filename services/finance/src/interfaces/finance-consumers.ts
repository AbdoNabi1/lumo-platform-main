import { Money, UniqueEntityId } from "@platform/domain";
import { requireEnvelopeTenant, type IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Clock, IdGenerator } from "@platform/contracts";
import { LedgerPoster, type PostingAccounts } from "../domain/services/ledger-poster";
import type { JournalRepository } from "../domain/repositories";

export interface FinanceConsumerDeps {
  readonly journals: JournalRepository;
  readonly postingAccounts: PostingAccounts;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * ADR-0014 (WP-10 T10.3): `tenantId` is read from the event envelope, never defaulted — a message
 * with no resolvable tenant is rejected (retry → DLQ) rather than posted against a guessed tenant.
 */
function requireTenantId(event: IntegrationEvent<unknown>): string {
  // Off the wire the envelope is whatever `JSON.parse` returned: absent, empty, blank, null or a
  // non-string are all "no tenant" (a ledger entry against tenant "" or 42 is not a guess we may make).
  return requireEnvelopeTenant(event, "Finance consumer");
}

async function postAndAppend(
  deps: FinanceConsumerDeps,
  build: (id: UniqueEntityId) => ReturnType<typeof LedgerPoster.forSale>,
  event: IntegrationEvent<unknown>,
): Promise<void> {
  const tenantId = requireTenantId(event);
  const id = UniqueEntityId.from(deps.idGenerator.generate());
  const result = build(id);
  if (!result.ok) {
    throw result.error;
  }
  result.value.post(event.messageId, deps.clock.now());
  await deps.journals.append(result.value, tenantId);
}

/**
 * `FinanceConsumers` (M4) — Finance's event-driven ledger postings. Consume-only: each handler
 * builds a balanced {@link Journal} via `LedgerPoster` and appends it to the immutable ledger;
 * Finance never mutates the source aggregate. `orders.placed` and `pricing.changed` are
 * subscribed-but-no-op (Finance posts at capture/paid time and reads current prices at query
 * time, not at placement/price-change time) — per the Implementation Report's own scope list.
 *
 * Integration event type strings for `payments.captured`, `orders.paid`, `inventory.adjusted`,
 * `pricing.changed` were independently verified this session against the producing contexts'
 * own translators (`payment-event-translator.ts`, `order-event-translator.ts`,
 * `inventory-event-translator.ts`, `pricing-event-translator.ts`). `returns.accepted` and
 * `marketing_spend.recorded` have **no producing context in this worktree yet** (Returns is
 * C11, not yet built at T1's point in the sequence; the Analytics/Marketing-Spend context is
 * design-only per the Implementation Report's own M9 finding) — their event-type strings below
 * are a documented, best-guess placeholder (`<context>.<aggregate>.<event>` convention), flagged
 * as an open gap for whichever milestone actually builds those producers.
 */
export class OrdersPlacedConsumer implements EventHandler<unknown> {
  readonly eventType = "orders.order.placed";
  readonly eventVersion = 1;
  async handle(): Promise<void> {
    // No-op: Finance posts revenue at payment capture, not order placement.
  }
}

export class OrdersPaidConsumer implements EventHandler<{
  orderRef: string;
  amountMinor: number;
  currency: string;
}> {
  readonly eventType = "orders.order.paid";
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }
  async handle(
    event: IntegrationEvent<{ orderRef: string; amountMinor: number; currency: string }>,
  ): Promise<void> {
    const amount = requireMoney(event.payload.amountMinor, event.payload.currency);
    await postAndAppend(
      this.deps,
      (id) => LedgerPoster.forSale(id, event.payload.orderRef, this.deps.postingAccounts, amount),
      event,
    );
  }
}

export class PaymentsCapturedConsumer implements EventHandler<{
  orderRef: string;
  amountMinor: number;
  currency: string;
}> {
  readonly eventType = "payments.payment_intent.captured";
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }
  async handle(
    event: IntegrationEvent<{ orderRef: string; amountMinor: number; currency: string }>,
  ): Promise<void> {
    const amount = requireMoney(event.payload.amountMinor, event.payload.currency);
    await postAndAppend(
      this.deps,
      (id) => LedgerPoster.forFee(id, event.payload.orderRef, this.deps.postingAccounts, amount),
      event,
    );
  }
}

export class RefundsIssuedConsumer implements EventHandler<{
  orderRef: string;
  amountMinor: number;
  currency: string;
}> {
  readonly eventType = "payments.payment_intent.refunded";
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }
  async handle(
    event: IntegrationEvent<{ orderRef: string; amountMinor: number; currency: string }>,
  ): Promise<void> {
    const amount = requireMoney(event.payload.amountMinor, event.payload.currency);
    await postAndAppend(
      this.deps,
      (id) => LedgerPoster.forRefund(id, event.payload.orderRef, this.deps.postingAccounts, amount),
      event,
    );
  }
}

export class ReturnsAcceptedConsumer implements EventHandler<{
  returnRef: string;
  amountMinor: number;
  currency: string;
}> {
  readonly eventType = "returns.return_request.accepted";
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }
  async handle(
    event: IntegrationEvent<{ returnRef: string; amountMinor: number; currency: string }>,
  ): Promise<void> {
    const amount = requireMoney(event.payload.amountMinor, event.payload.currency);
    await postAndAppend(
      this.deps,
      (id) =>
        LedgerPoster.forRefund(id, event.payload.returnRef, this.deps.postingAccounts, amount),
      event,
    );
  }
}

export class InventoryAdjustedConsumer implements EventHandler<{
  itemRef: string;
  deltaMinor: number;
  currency: string;
}> {
  readonly eventType = "inventory.inventory_item.adjusted";
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }
  async handle(
    event: IntegrationEvent<{ itemRef: string; deltaMinor: number; currency: string }>,
  ): Promise<void> {
    if (event.payload.deltaMinor <= 0) return;
    const amount = requireMoney(event.payload.deltaMinor, event.payload.currency);
    await postAndAppend(
      this.deps,
      (id) => LedgerPoster.forCogs(id, event.payload.itemRef, this.deps.postingAccounts, amount),
      event,
    );
  }
}

export class PricingChangedConsumer implements EventHandler<unknown> {
  readonly eventType = "pricing.price.changed";
  readonly eventVersion = 1;
  async handle(): Promise<void> {
    // No-op: Finance reads current prices via HistoricalCostResolver at query time.
  }
}

export class MarketingSpendRecordedConsumer implements EventHandler<{
  spendRef: string;
  amountMinor: number;
  currency: string;
}> {
  readonly eventType = "analytics.marketing_spend.recorded";
  readonly eventVersion = 1;
  private readonly deps: FinanceConsumerDeps;
  constructor(deps: FinanceConsumerDeps) {
    this.deps = deps;
  }
  async handle(
    event: IntegrationEvent<{ spendRef: string; amountMinor: number; currency: string }>,
  ): Promise<void> {
    const amount = requireMoney(event.payload.amountMinor, event.payload.currency);
    await postAndAppend(
      this.deps,
      (id) =>
        LedgerPoster.forExpense(id, event.payload.spendRef, this.deps.postingAccounts, amount),
      event,
    );
  }
}

function requireMoney(amountMinor: number, currency: string): Money {
  const result = Money.create(amountMinor, currency);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
