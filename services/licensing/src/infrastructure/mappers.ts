import { UniqueEntityId } from "@platform/domain";
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
  readonly amount: number;
  readonly unit: string;
  readonly lastRecordedAt: string | null;
  readonly version: number;
}

export interface CreditRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly amount: number;
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

  static toRow(plan: Plan, tenantId: string) {
    return {
      id: plan.id.toString(),
      tenantId,
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
        renewalSchedule: row.renewalSchedule ?? undefined,
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
      amount: counter.amount,
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
      amount: credit.amount,
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
      row.lineItems,
      row.status,
      row.version,
      row.paymentReference ?? undefined,
    );
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
