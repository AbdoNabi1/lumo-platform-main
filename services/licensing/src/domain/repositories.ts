import type { Credit } from "./credit";
import type { Invoice } from "./invoice";
import type { MerchantCapabilities } from "./merchant-capabilities";
import type { MerchantFeatureOverride } from "./merchant-feature-override";
import type { Plan } from "./plan";
import type { Subscription } from "./subscription";
import type { UsageCounter } from "./usage-counter";

export interface PlanRepository {
  save(plan: Plan, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Plan | null>;
  findByKey(key: string, tx?: unknown): Promise<Plan | null>;
}

export interface SubscriptionRepository {
  save(subscription: Subscription, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Subscription | null>;
  findByTenantRef(tenantRef: string, tx?: unknown): Promise<Subscription | null>;
}

export interface MerchantFeatureOverrideRepository {
  save(override: MerchantFeatureOverride, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<MerchantFeatureOverride | null>;
  findByTenantRefAndFeatureKey(
    tenantRef: string,
    featureKey: string,
    tx?: unknown,
  ): Promise<MerchantFeatureOverride | null>;
}

export interface MerchantCapabilitiesRepository {
  save(capabilities: MerchantCapabilities, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<MerchantCapabilities | null>;
  findByTenantRef(tenantRef: string, tx?: unknown): Promise<MerchantCapabilities | null>;
}

export interface UsageCounterRepository {
  save(counter: UsageCounter, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<UsageCounter | null>;
  findByTenantRefAndResource(
    tenantRef: string,
    resource: string,
    tx?: unknown,
  ): Promise<UsageCounter | null>;
}

export interface CreditRepository {
  save(credit: Credit, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Credit | null>;
}

export interface InvoiceRepository {
  save(invoice: Invoice, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Invoice | null>;
}
