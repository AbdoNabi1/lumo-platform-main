import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
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
import {
  CreditMapper,
  InvoiceMapper,
  MerchantCapabilitiesMapper,
  MerchantFeatureOverrideMapper,
  PlanMapper,
  SubscriptionMapper,
  UsageCounterMapper,
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

export class PrismaPlanRepository implements PlanRepository {
  private readonly deps: PrismaLicensingRepositoriesDeps;

  constructor(deps: PrismaLicensingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(plan: Plan, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = plan.id.toString();
    const row = PlanMapper.toRow(plan, tenantId);
    // `PlanVersionRow[]` has no index signature, so it has no structural overlap with
    // `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
    const versions = row.versions as unknown as Prisma.InputJsonValue;
    if (plan.version === 0) {
      await client.plan.create({ data: { ...row, versions } });
    } else {
      const updated = await client.plan.updateMany({
        where: { id, tenantId, version: plan.version },
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
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Plan | null> {
    const run = (client: TransactionClient) => client.plan.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    // Prisma row's `versions: JsonValue` has no structural overlap with `PlanRow`'s
    // `readonly PlanVersionRow[]` (comparability fails).
    return row === null ? null : PlanMapper.toDomain(row as unknown as PlanRow);
  }

  async findByKey(key: string, tenantId: string, tx?: unknown): Promise<Plan | null> {
    const run = (client: TransactionClient) => client.plan.findFirst({ where: { key, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    // Prisma row's `versions: JsonValue` has no structural overlap with `PlanRow`'s
    // `readonly PlanVersionRow[]` (comparability fails).
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
