import type { Credit } from "./credit";
import type { Invoice } from "./invoice";
import type { MerchantCapabilities } from "./merchant-capabilities";
import type { MerchantFeatureOverride } from "./merchant-feature-override";
import type { Plan } from "./plan";
import type { Subscription } from "./subscription";
import type { UsageCounter } from "./usage-counter";

/**
 * ADR-0014 (WP-10, T10.3): every read method below takes `tenantId` as an explicit per-call
 * parameter (the platform's multi-tenancy scope), matching `services/catalog`'s
 * first-converted-context shape — distinct from and orthogonal to this domain's own `tenantRef`
 * business key (a merchant reference), which several finders already took before this change.
 * `save` is not yet converted.
 */
export interface PlanRepository {
  save(plan: Plan, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Plan | null>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<Plan | null>;
}

export interface SubscriptionRepository {
  save(subscription: Subscription, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Subscription | null>;
  findByTenantRef(tenantRef: string, tenantId: string, tx?: unknown): Promise<Subscription | null>;
}

export interface MerchantFeatureOverrideRepository {
  save(override: MerchantFeatureOverride, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MerchantFeatureOverride | null>;
  findByTenantRefAndFeatureKey(
    tenantRef: string,
    featureKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantFeatureOverride | null>;
}

export interface MerchantCapabilitiesRepository {
  save(capabilities: MerchantCapabilities, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MerchantCapabilities | null>;
  findByTenantRef(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantCapabilities | null>;
}

export interface UsageCounterRepository {
  save(counter: UsageCounter, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<UsageCounter | null>;
  findByTenantRefAndResource(
    tenantRef: string,
    resource: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<UsageCounter | null>;
}

export interface CreditRepository {
  save(credit: Credit, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Credit | null>;
}

export interface InvoiceRepository {
  save(invoice: Invoice, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Invoice | null>;
}
