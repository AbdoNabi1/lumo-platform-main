import type { BillingPaymentMethod } from "./billing-payment-method";
import type { Coupon } from "./coupon";
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
  /**
   * T14.5/G-74 (7): every `active` subscription whose `renewalSchedule.nextRenewalAt` is at or
   * before `before` — the renewal-billing scheduler job's own read. A genuinely cross-tenant sweep
   * (ADR-0014 point 4, same category as the outbox relay and the two existing scheduler jobs): it
   * reads every subscription under the ONE platform `tenantId` scope, never a merchant's own scope
   * (billing data is platform-owned per D-062 — `tenantId` here is the ADR-0014 scope, not the
   * merchant `tenantRef` business key on each row).
   */
  findDueForRenewal(before: Date, tenantId: string, tx?: unknown): Promise<readonly Subscription[]>;
  /**
   * T14.5: every `grace` subscription whose `retryPolicy.nextRetryAt` is at or before `before` — the
   * dunning-retry scheduler job's own read. Same cross-tenant-sweep shape as
   * {@link findDueForRenewal}.
   */
  findDueForDunningRetry(
    before: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Subscription[]>;
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

/**
 * The saved cards Morbeh charges to renew merchants (G-74 (1)). Scoped to the PLATFORM tenant like
 * `SubscriptionRepository`: every lookup takes the tenant, and a merchant tenant's scope finds
 * nothing of the token that bills it.
 */
export interface BillingPaymentMethodRepository {
  save(method: BillingPaymentMethod, tenantId: string, tx?: unknown): Promise<void>;
  findByProviderOrder(
    provider: string,
    providerOrderId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<BillingPaymentMethod | null>;
  findActiveByTenantRef(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<BillingPaymentMethod | null>;
}

export interface InvoiceRepository {
  save(invoice: Invoice, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Invoice | null>;
}

/**
 * Billing coupons (WP-14 T14.3). Scoped to the PLATFORM tenant like `InvoiceRepository` — a merchant
 * tenant's scope finds nothing — and the merchant is the `merchantRef` business key on the row.
 * `save` is the redeem-once guard's storage half: it must be an optimistic-lock compare-and-swap that
 * throws `ConcurrencyError` when another writer already advanced the row's `version`.
 */
export interface CouponRepository {
  save(coupon: Coupon, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Coupon | null>;
  /** `code` is the normalised (upper-case) code. */
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<Coupon | null>;
  /** Every `issued` coupon addressed to `merchantRef`, oldest first — renewal billing's own read. */
  findIssuedForMerchant(
    merchantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Coupon[]>;
}
