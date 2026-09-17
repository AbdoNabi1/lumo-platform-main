import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Credit } from "../domain/credit";
import type { Invoice } from "../domain/invoice";
import type { MerchantCapabilities } from "../domain/merchant-capabilities";
import type { MerchantFeatureOverride } from "../domain/merchant-feature-override";
import type { Plan } from "../domain/plan";
import type {
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
 * ADR-0014 (WP-10, T10.5): every in-memory repository below is keyed by `(tenantId, id)` — none
 * of these aggregates carry the platform `tenantId` of their own, so the store must key on it
 * explicitly or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryPlanRepository implements PlanRepository {
  private readonly store = new Map<string, { readonly tenantId: string; readonly plan: Plan }>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(plan: Plan, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(plan.id.toString(), { tenantId, plan });
    await this.outbox.write(plan.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Plan | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.plan : null;
  }

  async findByKey(key: string, tenantId: string): Promise<Plan | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.plan.key === key) return entry.plan;
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
    await this.outbox.write(subscription.pullDomainEvents(), this.context, tx);
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
    await this.outbox.write(override.pullDomainEvents(), this.context, tx);
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
    await this.outbox.write(capabilities.pullDomainEvents(), this.context, tx);
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
    await this.outbox.write(counter.pullDomainEvents(), this.context, tx);
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
    await this.outbox.write(credit.pullDomainEvents(), this.context, tx);
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
    await this.outbox.write(invoice.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Invoice | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.invoice : null;
  }
}

/** Replay-safe idempotency store for `RecordUsage` (in-memory stub). */
export class InMemoryProcessedUsageRecordStore {
  private readonly seen = new Set<string>();

  async hasProcessed(recordId: string): Promise<boolean> {
    return this.seen.has(recordId);
  }

  async markProcessed(recordId: string): Promise<void> {
    this.seen.add(recordId);
  }
}
