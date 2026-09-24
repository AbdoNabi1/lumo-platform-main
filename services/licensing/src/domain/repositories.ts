import type { Credit } from "./credit";
import type { Invoice } from "./invoice";
import type { MerchantCapabilities } from "./merchant-capabilities";
import type { MerchantFeatureOverride } from "./merchant-feature-override";
import type { Plan } from "./plan";
import type { Subscription } from "./subscription";
import type { UsageCounter } from "./usage-counter";

/**
/**
 * ADR-0014 (WP-10, T10.5): every method below takes `tenantId` as an explicit per-call parameter
 * (the platform's multi-tenancy scope) — distinct from and orthogonal to this domain's own
 * `tenantRef` business key (a merchant reference). None of these aggregates carry the platform
 * `tenantId` as a domain field, so every `save` takes it as an explicit parameter (Option B).
 *
 * EXCEPTION — `PlanRepository` (WP-14, T14.2, Morbeh F-16): a `Plan` is PLATFORM-GLOBAL. It is
 * defined once by Morbeh and sold to many merchants, so it belongs to no tenant: its reads take no
 * tenant (a merchant's read scope must see the same catalogue) and its `save` takes the ACTING
 * tenant only to stamp the outbox envelope (`check-outbox-tenant`), never to scope a row. What
 * protects it instead of RLS: writes are reachable only through `LicensingController`'s
 * platform-only guard (`platformTenantId`), and a published `PlanVersion` is immutable.
 */
export interface PlanRepository {
  save(plan: Plan, actingTenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Plan | null>;
  findByKey(key: string, tx?: unknown): Promise<Plan | null>;
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
