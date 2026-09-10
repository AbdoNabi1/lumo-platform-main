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

export class InMemoryPlanRepository implements PlanRepository {
  private readonly store = new Map<string, Plan>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(plan: Plan, tx?: unknown): Promise<void> {
    this.store.set(plan.id.toString(), plan);
    await this.outbox.write(plan.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Plan | null> {
    return this.store.get(id) ?? null;
  }

  async findByKey(key: string, _tenantId: string): Promise<Plan | null> {
    for (const plan of this.store.values()) {
      if (plan.key === key) return plan;
    }
    return null;
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly store = new Map<string, Subscription>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(subscription: Subscription, tx?: unknown): Promise<void> {
    this.store.set(subscription.id.toString(), subscription);
    await this.outbox.write(subscription.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Subscription | null> {
    return this.store.get(id) ?? null;
  }

  async findByTenantRef(tenantRef: string, _tenantId: string): Promise<Subscription | null> {
    for (const subscription of this.store.values()) {
      if (subscription.tenantRef === tenantRef) return subscription;
    }
    return null;
  }
}

export class InMemoryMerchantFeatureOverrideRepository implements MerchantFeatureOverrideRepository {
  private readonly store = new Map<string, MerchantFeatureOverride>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(override: MerchantFeatureOverride, tx?: unknown): Promise<void> {
    this.store.set(override.id.toString(), override);
    await this.outbox.write(override.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<MerchantFeatureOverride | null> {
    return this.store.get(id) ?? null;
  }

  async findByTenantRefAndFeatureKey(
    tenantRef: string,
    featureKey: string,
    _tenantId: string,
  ): Promise<MerchantFeatureOverride | null> {
    for (const override of this.store.values()) {
      if (override.tenantRef === tenantRef && override.featureKey === featureKey) return override;
    }
    return null;
  }
}

export class InMemoryMerchantCapabilitiesRepository implements MerchantCapabilitiesRepository {
  private readonly store = new Map<string, MerchantCapabilities>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(capabilities: MerchantCapabilities, tx?: unknown): Promise<void> {
    this.store.set(capabilities.id.toString(), capabilities);
    await this.outbox.write(capabilities.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<MerchantCapabilities | null> {
    return this.store.get(id) ?? null;
  }

  async findByTenantRef(
    tenantRef: string,
    _tenantId: string,
  ): Promise<MerchantCapabilities | null> {
    for (const capabilities of this.store.values()) {
      if (capabilities.tenantRef === tenantRef) return capabilities;
    }
    return null;
  }
}

export class InMemoryUsageCounterRepository implements UsageCounterRepository {
  private readonly store = new Map<string, UsageCounter>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(counter: UsageCounter, tx?: unknown): Promise<void> {
    this.store.set(counter.id.toString(), counter);
    await this.outbox.write(counter.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<UsageCounter | null> {
    return this.store.get(id) ?? null;
  }

  async findByTenantRefAndResource(
    tenantRef: string,
    resource: string,
    _tenantId: string,
  ): Promise<UsageCounter | null> {
    for (const counter of this.store.values()) {
      if (counter.tenantRef === tenantRef && counter.resource === resource) return counter;
    }
    return null;
  }
}

export class InMemoryCreditRepository implements CreditRepository {
  private readonly store = new Map<string, Credit>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(credit: Credit, tx?: unknown): Promise<void> {
    this.store.set(credit.id.toString(), credit);
    await this.outbox.write(credit.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Credit | null> {
    return this.store.get(id) ?? null;
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly store = new Map<string, Invoice>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLicensingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(invoice: Invoice, tx?: unknown): Promise<void> {
    this.store.set(invoice.id.toString(), invoice);
    await this.outbox.write(invoice.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Invoice | null> {
    return this.store.get(id) ?? null;
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
