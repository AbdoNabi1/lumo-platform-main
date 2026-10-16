import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { ProcessedUsageRecordStore } from "../application/ports";
import type { BillingPaymentMethod } from "../domain/billing-payment-method";
import type { Coupon } from "../domain/coupon";
import type { Credit } from "../domain/credit";
import type { Invoice } from "../domain/invoice";
import type { MerchantCapabilities } from "../domain/merchant-capabilities";
import type { MerchantFeatureOverride } from "../domain/merchant-feature-override";
import type { Plan } from "../domain/plan";
import type {
  BillingPaymentMethodRepository,
  CouponRepository,
  CreditRepository,
  InvoiceRepository,
  MerchantCapabilitiesRepository,
  MerchantFeatureOverrideRepository,
  PlanRepository,
  SubscriptionRepository,
  UsageCounterRepository,
} from "../domain/repositories";
import type { Subscription } from "../domain/subscription";
import type { UsageCounter } from "../domain/usage-counter";

export interface InMemoryLicensingRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * ADR-0014 (WP-10, T10.5): every in-memory repository below EXCEPT the platform-global plan
 * repository is keyed by `(tenantId, id)` — none
 * of these aggregates carry the platform `tenantId` of their own, so the store must key on it
 * explicitly or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryPlanRepository implements PlanRepository {
  /** WP-14: platform-global — keyed by plan id alone, no tenant. */
  private readonly store = new Map<string, Plan>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(plan: Plan, actingTenantId: string, tx?: unknown): Promise<void> {
    this.store.set(plan.id.toString(), plan);
    await this.outbox.write(
      plan.pullDomainEvents(),
      { ...this.context, tenantId: actingTenantId },
      tx,
    );
  }

  async findById(id: string): Promise<Plan | null> {
    return this.store.get(id) ?? null;
  }

  async findByKey(key: string): Promise<Plan | null> {
    for (const plan of this.store.values()) {
      if (plan.key === key) return plan;
    }
    return null;
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly subscription: Subscription }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(subscription: Subscription, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(subscription.id.toString(), { tenantId, subscription });
    await this.outbox.write(subscription.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Subscription | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.subscription : null;
  }

  async findByTenantRef(tenantRef: string, tenantId: string): Promise<Subscription | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.subscription.tenantRef === tenantRef) {
        return entry.subscription;
      }
    }
    return null;
  }

  async findDueForRenewal(before: Date, tenantId: string): Promise<readonly Subscription[]> {
    const due: Subscription[] = [];
    for (const entry of this.store.values()) {
      if (entry.tenantId !== tenantId || entry.subscription.status !== "active") continue;
      const nextRenewalAt = entry.subscription.renewalSchedule?.nextRenewalAt;
      if (nextRenewalAt !== undefined && nextRenewalAt.getTime() <= before.getTime()) {
        due.push(entry.subscription);
      }
    }
    return due;
  }

  async findDueForDunningRetry(before: Date, tenantId: string): Promise<readonly Subscription[]> {
    const due: Subscription[] = [];
    for (const entry of this.store.values()) {
      if (entry.tenantId !== tenantId || entry.subscription.status !== "grace") continue;
      const nextRetryAt = entry.subscription.retryPolicy?.nextRetryAt;
      if (nextRetryAt !== undefined && nextRetryAt.getTime() <= before.getTime()) {
        due.push(entry.subscription);
      }
    }
    return due;
  }
}

export class InMemoryMerchantFeatureOverrideRepository implements MerchantFeatureOverrideRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly override: MerchantFeatureOverride }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(override: MerchantFeatureOverride, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(override.id.toString(), { tenantId, override });
    await this.outbox.write(override.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<MerchantFeatureOverride | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.override : null;
  }

  async findByTenantRefAndFeatureKey(
    tenantRef: string,
    featureKey: string,
    tenantId: string,
  ): Promise<MerchantFeatureOverride | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.override.tenantRef === tenantRef &&
        entry.override.featureKey === featureKey
      ) {
        return entry.override;
      }
    }
    return null;
  }
}

export class InMemoryMerchantCapabilitiesRepository implements MerchantCapabilitiesRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly capabilities: MerchantCapabilities }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(capabilities: MerchantCapabilities, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(capabilities.id.toString(), { tenantId, capabilities });
    await this.outbox.write(capabilities.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<MerchantCapabilities | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.capabilities : null;
  }

  async findByTenantRef(tenantRef: string, tenantId: string): Promise<MerchantCapabilities | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.capabilities.tenantRef === tenantRef) {
        return entry.capabilities;
      }
    }
    return null;
  }
}

export class InMemoryUsageCounterRepository implements UsageCounterRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly counter: UsageCounter }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(counter: UsageCounter, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(counter.id.toString(), { tenantId, counter });
    await this.outbox.write(counter.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<UsageCounter | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.counter : null;
  }

  async findByTenantRefAndResource(
    tenantRef: string,
    resource: string,
    tenantId: string,
  ): Promise<UsageCounter | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.counter.tenantRef === tenantRef &&
        entry.counter.resource === resource
      ) {
        return entry.counter;
      }
    }
    return null;
  }
}

export class InMemoryCreditRepository implements CreditRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly credit: Credit }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(credit: Credit, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(credit.id.toString(), { tenantId, credit });
    await this.outbox.write(credit.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Credit | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.credit : null;
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly invoice: Invoice }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(invoice: Invoice, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(invoice.id.toString(), { tenantId, invoice });
    await this.outbox.write(invoice.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Invoice | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.invoice : null;
  }
}

/**
 * In-memory coupons — for the offline composition only. Like every repository in this file it hands
 * aggregates out BY REFERENCE and does not enforce an optimistic lock, so it is NOT evidence for the
 * redeem-once guarantee; that is proven against `PrismaCouponRepository` over `FakeLicensingDb`
 * (`coupon-redemption-concurrency.test.ts`), which does implement the compare-and-swap.
 */
export class InMemoryCouponRepository implements CouponRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly coupon: Coupon }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(coupon: Coupon, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(coupon.id.toString(), { tenantId, coupon });
    await this.outbox.write(coupon.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  findById(id: string, tenantId: string): Promise<Coupon | null> {
    const entry = this.store.get(id);
    return Promise.resolve(
      entry !== undefined && entry.tenantId === tenantId ? entry.coupon : null,
    );
  }

  findByCode(code: string, tenantId: string): Promise<Coupon | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.coupon.code === code) {
        return Promise.resolve(entry.coupon);
      }
    }
    return Promise.resolve(null);
  }

  findIssuedForMerchant(merchantRef: string, tenantId: string): Promise<readonly Coupon[]> {
    // Map iteration order is insertion order, i.e. oldest first.
    const found: Coupon[] = [];
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.coupon.merchantRef === merchantRef &&
        entry.coupon.status === "issued"
      ) {
        found.push(entry.coupon);
      }
    }
    return Promise.resolve(found);
  }
}

/** Platform-scoped like every repository here: a lookup under another tenant finds nothing. */
export class InMemoryBillingPaymentMethodRepository implements BillingPaymentMethodRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly method: BillingPaymentMethod }
  >();

  async save(method: BillingPaymentMethod, tenantId: string): Promise<void> {
    this.store.set(method.id, { tenantId, method });
  }

  async findByProviderOrder(
    provider: string,
    providerOrderId: string,
    tenantId: string,
  ): Promise<BillingPaymentMethod | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.method.provider === provider &&
        entry.method.providerOrderId === providerOrderId
      ) {
        return entry.method;
      }
    }
    return null;
  }

  async findActiveByTenantRef(
    tenantRef: string,
    tenantId: string,
  ): Promise<BillingPaymentMethod | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.method.tenantRef === tenantRef &&
        entry.method.status === "active"
      ) {
        return entry.method;
      }
    }
    return null;
  }
}

/**
 * Replay-safe idempotency store for `RecordUsage` (in-memory). `markProcessed` checks and adds in one
 * synchronous step, so — like the Prisma store's primary-key insert — it refuses a second mark of the
 * same record even when two deliveries interleave.
 *
 * **Only the Prisma path is atomic.** The transaction handle is ignored here, but that does NOT mean
 * there is nothing to roll back: the marker is state. `InMemoryUnitOfWork` passes `undefined` and
 * never rolls anything back, so in memory a marker can outlive a failed `save`, and that record's
 * retry is then swallowed as a duplicate. This is a property of the whole in-memory licensing layer
 * (no repository rolls back either), not something this store can fix.
 */
export class InMemoryProcessedUsageRecordStore implements ProcessedUsageRecordStore {
  private readonly seen = new Set<string>();

  async hasProcessed(recordId: string, _tx?: unknown): Promise<boolean> {
    return this.seen.has(recordId);
  }

  async markProcessed(recordId: string, _tx?: unknown): Promise<void> {
    if (this.seen.has(recordId)) {
      throw new ConcurrencyError(`Usage record "${recordId}" was already processed`);
    }
    this.seen.add(recordId);
  }
}
