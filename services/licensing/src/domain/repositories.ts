import type { Credit } from "./credit";
import type { Invoice } from "./invoice";
import type { MerchantCapabilities } from "./merchant-capabilities";
import type { MerchantFeatureOverride } from "./merchant-feature-override";
import type { Plan } from "./plan";
import type { Subscription } from "./subscription";
import type { UsageCounter } from "./usage-counter";

/**
 * ADR-0014 (WP-10, T10.5): every method below takes `tenantId` as an explicit per-call parameter
 * (the platform's multi-tenancy scope) — distinct from and orthogonal to this domain's own
 * `tenantRef` business key (a merchant reference), which several finders already took before this
 * change. None of these aggregates carry the platform `tenantId` as a domain field, so every
 * `save` takes it as an explicit parameter (Option B) rather than reading it off the aggregate.
 * Checked for platform-global (cross-tenant) write methods per WP-10's licensing/feature-registry
 * caveat: every one of `licensing.prisma`'s tables (including `Plan`, whose business terminology
 * could suggest a platform-wide catalog) carries a real `tenantId` column — none found.
 */
export interface PlanRepository {
  save(plan: Plan, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Plan | null>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<Plan | null>;
}

export interface SubscriptionRepository {
  save(subscription: Subscription, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Subscription | null>;
  findByTenantRef(tenantRef: string, tenantId: string, tx?: unknown): Promise<Subscription | null>;
}

export interface MerchantFeatureOverrideRepository {
  save(override: MerchantFeatureOverride, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MerchantFeatureOverride | null>;
  findByTenantRefAndFeatureKey(
    tenantRef: string,
    featureKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantFeatureOverride | null>;
}

export interface MerchantCapabilitiesRepository {
  save(capabilities: MerchantCapabilities, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MerchantCapabilities | null>;
  findByTenantRef(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantCapabilities | null>;
}

export interface UsageCounterRepository {
  save(counter: UsageCounter, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<UsageCounter | null>;
  findByTenantRefAndResource(
    tenantRef: string,
    resource: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<UsageCounter | null>;
}

export interface CreditRepository {
  save(credit: Credit, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Credit | null>;
}

export interface InvoiceRepository {
  save(invoice: Invoice, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Invoice | null>;
}
