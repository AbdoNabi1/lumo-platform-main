import { UniqueEntityId } from "@platform/domain";
import type { Decimal } from "decimal.js";
import { Credit, type CreditStatus } from "../domain/credit";
import { Invoice, type InvoiceLineItem, type InvoiceStatus } from "../domain/invoice";
import {
  MerchantCapabilities,
  type CapabilityAuditEntry,
  type CapabilityGrant,
} from "../domain/merchant-capabilities";
import {
  MerchantFeatureOverride,
  type MerchantOverrideState,
} from "../domain/merchant-feature-override";
import { Plan, type PlanTier } from "../domain/plan";
import { PlanVersion, type PlanVersionStatus } from "../domain/plan-version";
import {
  Subscription,
  type RenewalSchedule,
  type RetryPolicy,
  type SubscriptionStatus,
} from "../domain/subscription";
import { UsageCounter } from "../domain/usage-counter";
import type { PlanSpec } from "../domain/value-objects/plan-spec";

export interface PlanVersionRow {
  readonly id: string;
  readonly spec: PlanSpec;
  readonly status: PlanVersionStatus;
  readonly scheduledPublishAt: string | null;
}

export interface PlanRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly tier: PlanTier;
  readonly versions: readonly PlanVersionRow[];
  readonly publishedVersionId: string | null;
  readonly version: number;
}

export interface SubscriptionRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly planVersionRef: string;
  readonly status: SubscriptionStatus;
  readonly renewalSchedule: RenewalSchedule | null;
  readonly gracePeriodDays: number | null;
  readonly retryPolicy: RetryPolicy | null;
  readonly cancellationReason: string | null;
  readonly pausedUntil: string | null;
  readonly version: number;
}

export interface MerchantFeatureOverrideRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly featureKey: string;
  readonly state: MerchantOverrideState;
  readonly expiresAt: string | null;
  readonly notes: string | null;
  readonly version: number;
}

export interface MerchantCapabilitiesRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly grants: readonly CapabilityGrant[];
  readonly auditHistory: readonly CapabilityAuditEntry[];
  readonly version: number;
}

export interface UsageCounterRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly resource: string;
  // WP-11 (F-07): `Decimal.Value` (decimal.js), not `number` — Prisma returns a `Prisma.Decimal`
  // instance for this column at runtime (also accepts the string this mapper's `toRow` now
  // writes on the way back in). Casting straight to `number` here would silently re-introduce
  // the float-precision loss `UsageCounter`'s internal `Decimal` accumulator exists to prevent.
  readonly amount: Decimal.Value;
  readonly unit: string;
  readonly lastRecordedAt: string | null;
  readonly version: number;
}

export interface CreditRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly amount: Decimal.Value; // WP-11 (F-07) — see UsageCounterRow.amount's comment above.
  readonly reason: string;
  readonly status: CreditStatus;
  readonly version: number;
}

export interface InvoiceRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly subscriptionRef: string;
  readonly currency: string;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly status: InvoiceStatus;
  readonly paymentReference: string | null;
  readonly version: number;
}

export class PlanMapper {
  static toDomain(row: PlanRow): Plan {
    const versions = row.versions.map((v) =>
      PlanVersion.reconstitute(
        UniqueEntityId.from(v.id),
        v.spec,
        v.status,
        v.scheduledPublishAt === null ? undefined : new Date(v.scheduledPublishAt),
      ),
    );
    return Plan.reconstitute(
      UniqueEntityId.from(row.id),
      row.key,
      row.name,
      row.tier,
      versions,
      row.version,
      row.publishedVersionId ?? undefined,
    );
  }

  /** WP-14: platform-global — no tenant on the row. `originTenantId` is migration provenance only. */
  static toRow(plan: Plan) {
    return {
      id: plan.id.toString(),
      key: plan.key,
      name: plan.name,
      tier: plan.tier,
      versions: plan.versions.map((v) => ({
        id: v.id.toString(),
        spec: v.spec,
        status: v.status,
        scheduledPublishAt: v.scheduledPublishAt?.toISOString() ?? null,
      })),
      publishedVersionId: plan.publishedVersionId ?? null,
      version: 1,
    };
  }
}

export class SubscriptionMapper {
  static toDomain(row: SubscriptionRow): Subscription {
    return Subscription.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.planVersionRef,
      row.status,
      row.version,
      {
        // JSONB hands the date back as an ISO string; the domain type is `Date`.
        renewalSchedule:
          row.renewalSchedule === null
            ? undefined
            : {
                cycleDays: row.renewalSchedule.cycleDays,
                nextRenewalAt: new Date(row.renewalSchedule.nextRenewalAt),
              },
        gracePeriodDays: row.gracePeriodDays ?? undefined,
        retryPolicy: row.retryPolicy ?? undefined,
        cancellationReason: row.cancellationReason ?? undefined,
        pausedUntil: row.pausedUntil === null ? undefined : new Date(row.pausedUntil),
      },
    );
  }

  static toRow(subscription: Subscription, tenantId: string) {
    return {
      id: subscription.id.toString(),
      tenantId,
      tenantRef: subscription.tenantRef,
      planVersionRef: subscription.planVersionRef,
      status: subscription.status,
      renewalSchedule: subscription.renewalSchedule ?? null,
      gracePeriodDays: subscription.gracePeriodDays ?? null,
      retryPolicy: subscription.retryPolicy ?? null,
      cancellationReason: subscription.cancellationReason ?? null,
      pausedUntil: subscription.pausedUntil?.toISOString() ?? null,
      version: 1,
    };
  }
}

export class MerchantFeatureOverrideMapper {
  static toDomain(row: MerchantFeatureOverrideRow): MerchantFeatureOverride {
    return MerchantFeatureOverride.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.featureKey,
      row.state,
      row.version,
      row.expiresAt === null ? undefined : new Date(row.expiresAt),
      row.notes ?? undefined,
    );
  }

  static toRow(override: MerchantFeatureOverride, tenantId: string) {
    return {
      id: override.id.toString(),
      tenantId,
      tenantRef: override.tenantRef,
      featureKey: override.featureKey,
      state: override.state,
      expiresAt: override.expiresAt?.toISOString() ?? null,
      notes: override.notes ?? null,
      version: 1,
    };
  }
}

export class MerchantCapabilitiesMapper {
  static toDomain(row: MerchantCapabilitiesRow): MerchantCapabilities {
    return MerchantCapabilities.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.grants,
      row.auditHistory,
      row.version,
    );
  }

  static toRow(capabilities: MerchantCapabilities, tenantId: string) {
    return {
      id: capabilities.id.toString(),
      tenantId,
      tenantRef: capabilities.tenantRef,
      grants: capabilities.grants,
      auditHistory: capabilities.auditHistory,
      version: 1,
    };
  }
}

export class UsageCounterMapper {
  static toDomain(row: UsageCounterRow): UsageCounter {
    return UsageCounter.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.resource,
      row.amount,
      row.unit,
      row.version,
      row.lastRecordedAt === null ? undefined : new Date(row.lastRecordedAt),
    );
  }

  static toRow(counter: UsageCounter, tenantId: string) {
    return {
      id: counter.id.toString(),
      tenantId,
      tenantRef: counter.tenantRef,
      resource: counter.resource,
      amount: counter.amountDecimalString, // WP-11 (F-07): exact decimal string, never a `number`.
      unit: counter.unit,
      lastRecordedAt: counter.lastRecordedAt?.toISOString() ?? null,
      version: 1,
    };
  }
}

export class CreditMapper {
  static toDomain(row: CreditRow): Credit {
    return Credit.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.amount,
      row.reason,
      row.status,
      row.version,
    );
  }

  static toRow(credit: Credit, tenantId: string) {
    return {
      id: credit.id.toString(),
      tenantId,
      tenantRef: credit.tenantRef,
      amount: credit.amountDecimalString, // WP-11 (F-07): exact decimal string, never a `number`.
      reason: credit.reason,
      status: credit.status,
      version: 1,
    };
  }
}

export class InvoiceMapper {
  static toDomain(row: InvoiceRow): Invoice {
    return Invoice.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.subscriptionRef,
      row.currency,
      InvoiceMapper.assertMinorUnitLines(row.id, row.lineItems),
      row.status,
      row.version,
      row.paymentReference ?? undefined,
    );
  }

  /**
   * WP-14 (Trap 3): every persisted line must carry an INTEGER `amountMinor`. A pre-convention row
   * (`{ amount }`, unit never recorded) is refused loudly rather than read as minor units — the
   * migration `20260924000000_wp14_platform_plans` converts such rows; one that survives is a defect
   * to surface, not a number to charge.
   */
  private static assertMinorUnitLines(
    invoiceId: string,
    lineItems: readonly InvoiceLineItem[],
  ): readonly InvoiceLineItem[] {
    for (const item of lineItems) {
      if (!Number.isSafeInteger(item.amountMinor)) {
        throw new Error(
          `Invoice ${invoiceId} has a line without an integer amountMinor (pre-WP-14 row?); refusing to read it as money`,
        );
      }
    }
    return lineItems;
  }

  static toRow(invoice: Invoice, tenantId: string) {
    return {
      id: invoice.id.toString(),
      tenantId,
      tenantRef: invoice.tenantRef,
      subscriptionRef: invoice.subscriptionRef,
      currency: invoice.currency,
      lineItems: invoice.lineItems,
      status: invoice.status,
      paymentReference: invoice.paymentReference ?? null,
      version: 1,
    };
  }
}
