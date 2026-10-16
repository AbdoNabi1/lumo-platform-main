import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import { BillingPaymentMethod } from "../domain/billing-payment-method";
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
import {
  CouponMapper,
  CreditMapper,
  InvoiceMapper,
  MerchantCapabilitiesMapper,
  MerchantFeatureOverrideMapper,
  PlanMapper,
  SubscriptionMapper,
  UsageCounterMapper,
  type CouponRow,
  type CreditRow,
  type InvoiceRow,
  type MerchantCapabilitiesRow,
  type MerchantFeatureOverrideRow,
  type PlanRow,
  type SubscriptionRow,
  type UsageCounterRow,
} from "./mappers";

export interface PrismaLicensingRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

function requireTx(tx: unknown): TransactionClient {
  if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
  return tx as TransactionClient;
}

/**
 * WP-14 (T14.2): `licensing.plans` is PLATFORM-GLOBAL — no `tenant_id` column and therefore no
 * `tenant_isolation` RLS policy (see migration `20260924000000_wp14_platform_plans`). Reads need no
 * tenant scope; `save`'s `actingTenantId` only stamps the outbox envelope. What protects the table
 * instead of RLS: writes are reachable only through `LicensingController`'s platform-only guard, and a
 * published `PlanVersion` is an immutable, deep-frozen snapshot.
 */
export class PrismaPlanRepository implements PlanRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(plan: Plan, actingTenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = plan.id.toString();
    const row = PlanMapper.toRow(plan);
    // `PlanVersionRow[]` has no index signature, so it has no structural overlap with
    // `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
    const versions = row.versions as unknown as Prisma.InputJsonValue;
    if (plan.version === 0) {
      await client.plan.create({ data: { ...row, versions } });
    } else {
      const updated = await client.plan.updateMany({
        where: { id, version: plan.version },
        data: {
          name: row.name,
          versions,
          publishedVersionId: row.publishedVersionId,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConcurrencyError(`Plan ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      plan.pullDomainEvents(),
      { ...this.deps.context, tenantId: actingTenantId },
      client,
    );
  }

  async findById(id: string, tx?: unknown): Promise<Plan | null> {
    const client = tx !== undefined && tx !== null ? (tx as TransactionClient) : this.deps.prisma;
    const row = await client.plan.findFirst({ where: { id } });
    // Prisma row's `versions: JsonValue` has no structural overlap with `PlanRow`'s
    // `readonly PlanVersionRow[]` (comparability fails).
    return row === null ? null : PlanMapper.toDomain(row as unknown as PlanRow);
  }

  async findByKey(key: string, tx?: unknown): Promise<Plan | null> {
    const client = tx !== undefined && tx !== null ? (tx as TransactionClient) : this.deps.prisma;
    const row = await client.plan.findFirst({ where: { key } });
    return row === null ? null : PlanMapper.toDomain(row as unknown as PlanRow);
  }
}

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(subscription: Subscription, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = subscription.id.toString();
    const row = SubscriptionMapper.toRow(subscription, tenantId);
    // `RenewalSchedule`/`RetryPolicy` have no index signature, so they have no structural overlap
    // with `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
    const renewalSchedule = row.renewalSchedule as unknown as Prisma.InputJsonValue;
    const retryPolicy = row.retryPolicy as unknown as Prisma.InputJsonValue;
    if (subscription.version === 0) {
      await client.subscription.create({ data: { ...row, renewalSchedule, retryPolicy } });
    } else {
      const updated = await client.subscription.updateMany({
        where: { id, tenantId, version: subscription.version },
        data: {
          planVersionRef: row.planVersionRef,
          status: row.status,
          renewalSchedule,
          gracePeriodDays: row.gracePeriodDays,
          retryPolicy,
          cancellationReason: row.cancellationReason,
          pausedUntil: row.pausedUntil,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`Subscription ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      subscription.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Subscription | null> {
    const run = (client: TransactionClient) =>
      client.subscription.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SubscriptionMapper.toDomain(row as SubscriptionRow);
  }

  async findByTenantRef(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Subscription | null> {
    const run = (client: TransactionClient) =>
      client.subscription.findFirst({ where: { tenantRef, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SubscriptionMapper.toDomain(row as SubscriptionRow);
  }

  /**
   * T14.5/G-74 (7): the `where` narrows on the `(tenantId, status)` columns only — `tenantId` leads
   * `subscriptions_tenant_id_tenant_ref_key`, but `status` is an UNINDEXED plain column (unlike
   * `PlatformInvoice`, which has `@@index([tenantId, tenantRef, status])`), and
   * `renewalSchedule.nextRenewalAt` lives inside a JSONB blob, and this
   * codebase has no proven, tested pattern for a JSON-path date comparison in a Prisma query that
   * can be verified without live-database access (this task is expressly forbidden from connecting
   * to one). Filtering the due date in application code over the (small, business-population-sized,
   * never event/order-volume-sized) `active` set is the honestly-documented trade-off: correct, and
   * cheap enough for a subscription count, at the cost of transferring rows for every `active`
   * subscription rather than only the due ones. Revisit with a tested JSON-path filter if the active
   * population ever grows large enough for that to matter.
   */
  async findDueForRenewal(
    before: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Subscription[]> {
    const run = (client: TransactionClient) =>
      client.subscription.findMany({ where: { tenantId, status: "active" } });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return (rows as SubscriptionRow[])
      .map((row) => SubscriptionMapper.toDomain(row))
      .filter((subscription) => {
        const nextRenewalAt = subscription.renewalSchedule?.nextRenewalAt;
        return nextRenewalAt !== undefined && nextRenewalAt.getTime() <= before.getTime();
      });
  }

  /** T14.5: same JSON-filter-in-application-code trade-off as {@link findDueForRenewal}. */
  async findDueForDunningRetry(
    before: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Subscription[]> {
    const run = (client: TransactionClient) =>
      client.subscription.findMany({ where: { tenantId, status: "grace" } });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return (rows as SubscriptionRow[])
      .map((row) => SubscriptionMapper.toDomain(row))
      .filter((subscription) => {
        const nextRetryAt = subscription.retryPolicy?.nextRetryAt;
        return nextRetryAt !== undefined && nextRetryAt.getTime() <= before.getTime();
      });
  }
}

export class PrismaMerchantFeatureOverrideRepository implements MerchantFeatureOverrideRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(override: MerchantFeatureOverride, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = override.id.toString();
    const row = MerchantFeatureOverrideMapper.toRow(override, tenantId);
    if (override.version === 0) {
      await client.merchantFeatureOverride.create({ data: row });
    } else {
      const updated = await client.merchantFeatureOverride.updateMany({
        where: { id, tenantId, version: override.version },
        data: {
          state: row.state,
          expiresAt: row.expiresAt,
          notes: row.notes,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`MerchantFeatureOverride ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      override.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(
    id: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantFeatureOverride | null> {
    const run = (client: TransactionClient) =>
      client.merchantFeatureOverride.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null
      ? null
      : MerchantFeatureOverrideMapper.toDomain(row as MerchantFeatureOverrideRow);
  }

  async findByTenantRefAndFeatureKey(
    tenantRef: string,
    featureKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantFeatureOverride | null> {
    const run = (client: TransactionClient) =>
      client.merchantFeatureOverride.findFirst({ where: { tenantRef, featureKey, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null
      ? null
      : MerchantFeatureOverrideMapper.toDomain(row as MerchantFeatureOverrideRow);
  }
}

export class PrismaMerchantCapabilitiesRepository implements MerchantCapabilitiesRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(capabilities: MerchantCapabilities, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = capabilities.id.toString();
    const row = MerchantCapabilitiesMapper.toRow(capabilities, tenantId);
    // `CapabilityGrant[]`/`CapabilityAuditEntry[]` have no index signature, so they have no
    // structural overlap with `InputJsonValue`'s `InputJsonObject` (comparability fails).
    const grants = row.grants as unknown as Prisma.InputJsonValue;
    const auditHistory = row.auditHistory as unknown as Prisma.InputJsonValue;
    if (capabilities.version === 0) {
      await client.merchantCapabilities.create({ data: { ...row, grants, auditHistory } });
    } else {
      const updated = await client.merchantCapabilities.updateMany({
        where: { id, tenantId, version: capabilities.version },
        data: { grants, auditHistory, version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`MerchantCapabilities ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      capabilities.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<MerchantCapabilities | null> {
    const run = (client: TransactionClient) =>
      client.merchantCapabilities.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return null;
    // Prisma row's `grants`/`auditHistory: JsonValue` have no structural overlap with
    // `MerchantCapabilitiesRow`'s typed array fields (comparability fails).
    return MerchantCapabilitiesMapper.toDomain(row as unknown as MerchantCapabilitiesRow);
  }

  async findByTenantRef(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MerchantCapabilities | null> {
    const run = (client: TransactionClient) =>
      client.merchantCapabilities.findFirst({ where: { tenantRef, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return null;
    // Prisma row's `grants`/`auditHistory: JsonValue` have no structural overlap with
    // `MerchantCapabilitiesRow`'s typed array fields (comparability fails).
    return MerchantCapabilitiesMapper.toDomain(row as unknown as MerchantCapabilitiesRow);
  }
}

export class PrismaUsageCounterRepository implements UsageCounterRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(counter: UsageCounter, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = counter.id.toString();
    const row = UsageCounterMapper.toRow(counter, tenantId);
    if (counter.version === 0) {
      await client.usageCounter.create({ data: row });
    } else {
      const updated = await client.usageCounter.updateMany({
        where: { id, tenantId, version: counter.version },
        data: {
          amount: row.amount,
          unit: row.unit,
          lastRecordedAt: row.lastRecordedAt,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`UsageCounter ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      counter.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<UsageCounter | null> {
    const run = (client: TransactionClient) =>
      client.usageCounter.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : UsageCounterMapper.toDomain(row as UsageCounterRow);
  }

  async findByTenantRefAndResource(
    tenantRef: string,
    resource: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<UsageCounter | null> {
    const run = (client: TransactionClient) =>
      client.usageCounter.findFirst({ where: { tenantRef, resource, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : UsageCounterMapper.toDomain(row as UsageCounterRow);
  }
}

export class PrismaCreditRepository implements CreditRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(credit: Credit, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = credit.id.toString();
    const row = CreditMapper.toRow(credit, tenantId);
    if (credit.version === 0) {
      await client.credit.create({ data: row });
    } else {
      const updated = await client.credit.updateMany({
        where: { id, tenantId, version: credit.version },
        data: { amount: row.amount, status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new ConcurrencyError(`Credit ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      credit.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Credit | null> {
    const run = (client: TransactionClient) => client.credit.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : CreditMapper.toDomain(row as CreditRow);
  }
}

export class PrismaInvoiceRepository implements InvoiceRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(invoice: Invoice, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = invoice.id.toString();
    const row = InvoiceMapper.toRow(invoice, tenantId);
    // `InvoiceLineItem[]` has no index signature, so it has no structural overlap with
    // `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
    const lineItems = row.lineItems as unknown as Prisma.InputJsonValue;
    if (invoice.version === 0) {
      await client.invoice.create({ data: { ...row, lineItems } });
    } else {
      const updated = await client.invoice.updateMany({
        where: { id, tenantId, version: invoice.version },
        data: {
          status: row.status,
          paymentReference: row.paymentReference,
          discountMinor: row.discountMinor,
          discountCouponRef: row.discountCouponRef,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`Invoice ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(
      invoice.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Invoice | null> {
    const run = (client: TransactionClient) =>
      client.invoice.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    // Prisma row's `lineItems: JsonValue` has no structural overlap with `InvoiceRow`'s
    // `readonly InvoiceLineItem[]` (comparability fails).
    return row === null ? null : InvoiceMapper.toDomain(row as unknown as InvoiceRow);
  }
}

/**
 * T14.3 (D-072): billing coupons, scoped to the PLATFORM tenant like invoices — every read and write
 * carries `tenantId`. `save` is the storage half of the redeem-once guard: an UPDATE guarded by
 * `version` that touches 0 rows is a lost race and becomes `ConcurrencyError`, so of N transactions
 * that read the same `issued` coupon only ONE write commits.
 */
export class PrismaCouponRepository implements CouponRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(coupon: Coupon, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = coupon.id.toString();
    const row = CouponMapper.toRow(coupon, tenantId);
    if (coupon.version === 0) {
      await client.billingCoupon.create({ data: row });
    } else {
      const updated = await client.billingCoupon.updateMany({
        where: { id, tenantId, version: coupon.version },
        data: {
          status: row.status,
          redeemedInvoiceRef: row.redeemedInvoiceRef,
          redeemedAt: row.redeemedAt,
          revokedReason: row.revokedReason,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(`Coupon ${id} was modified concurrently`);
      }
    }
    await this.deps.outbox.write(
      coupon.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Coupon | null> {
    const run = (client: TransactionClient) =>
      client.billingCoupon.findFirst({ where: { id, tenantId } });
    return this.readOne(run, tenantId, tx);
  }

  async findByCode(code: string, tenantId: string, tx?: unknown): Promise<Coupon | null> {
    const run = (client: TransactionClient) =>
      client.billingCoupon.findFirst({ where: { code, tenantId } });
    return this.readOne(run, tenantId, tx);
  }

  async findIssuedForMerchant(
    merchantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Coupon[]> {
    const run = (client: TransactionClient) =>
      client.billingCoupon.findMany({
        where: { tenantId, tenantRef: merchantRef, status: "issued" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return rows.map((row) => CouponMapper.toDomain(row as CouponRow));
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  private async readOne(
    run: (client: TransactionClient) => Promise<unknown>,
    tenantId: string,
    tx?: unknown,
  ): Promise<Coupon | null> {
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : CouponMapper.toDomain(row as CouponRow);
  }
}

/**
 * G-74 (1): the saved card Morbeh charges to renew a merchant. TENANT-SCOPED to the PLATFORM tenant
 * (`tenant_id` = the platform tenant, `tenant_isolation` RLS forced), never to the merchant's own
 * tenant — every read and write below carries `tenantId`, so a merchant-scoped call matches no row.
 * No outbox events: this is a credential record, not a domain fact other contexts consume. The
 * sealed token is written to and read from `sealed_token` only through `toPersistence()`/`rehydrate`.
 */
export class PrismaBillingPaymentMethodRepository implements BillingPaymentMethodRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(method: BillingPaymentMethod, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const state = method.toPersistence();
    const columns = {
      tenantRef: state.tenantRef,
      provider: state.provider,
      providerOrderId: state.providerOrderId,
      invoiceRef: state.invoiceRef ?? null,
      status: state.status,
      tokenId: state.tokenId ?? null,
      sealedToken: state.sealedToken ?? null,
      maskedPan: state.maskedPan ?? null,
      cardSubtype: state.cardSubtype ?? null,
    };
    if (state.version === 0) {
      await client.billingPaymentMethod.create({
        data: { id: state.id, tenantId, ...columns, createdAt: state.createdAt },
      });
      return;
    }
    const updated = await client.billingPaymentMethod.updateMany({
      where: { id: state.id, tenantId, version: state.version },
      data: { ...columns, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(`BillingPaymentMethod ${state.id} was modified concurrently`);
    }
  }

  async findByProviderOrder(
    provider: string,
    providerOrderId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<BillingPaymentMethod | null> {
    return this.read(tenantId, tx, (client) =>
      client.billingPaymentMethod.findFirst({ where: { tenantId, provider, providerOrderId } }),
    );
  }

  async findActiveByTenantRef(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<BillingPaymentMethod | null> {
    return this.read(tenantId, tx, (client) =>
      client.billingPaymentMethod.findFirst({
        where: { tenantId, tenantRef, status: "active" },
      }),
    );
  }

  private async read(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<BillingPaymentMethodRow | null>,
  ): Promise<BillingPaymentMethod | null> {
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : toBillingPaymentMethod(row);
  }
}

interface BillingPaymentMethodRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly provider: string;
  readonly providerOrderId: string;
  readonly invoiceRef: string | null;
  readonly status: string;
  readonly tokenId: string | null;
  readonly sealedToken: string | null;
  readonly maskedPan: string | null;
  readonly cardSubtype: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toBillingPaymentMethod(row: BillingPaymentMethodRow): BillingPaymentMethod {
  if (row.status !== "pending" && row.status !== "active" && row.status !== "revoked") {
    throw new Error(`billing_payment_methods row ${row.id} has an unknown status`);
  }
  return BillingPaymentMethod.rehydrate({
    id: row.id,
    tenantRef: row.tenantRef,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    ...(row.invoiceRef === null ? {} : { invoiceRef: row.invoiceRef }),
    status: row.status,
    ...(row.tokenId === null ? {} : { tokenId: row.tokenId }),
    ...(row.sealedToken === null ? {} : { sealedToken: row.sealedToken }),
    ...(row.maskedPan === null ? {} : { maskedPan: row.maskedPan }),
    ...(row.cardSubtype === null ? {} : { cardSubtype: row.cardSubtype }),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
