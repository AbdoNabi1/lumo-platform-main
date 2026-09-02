import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { PricingRule } from "../domain/pricing-rule";
import type { PricingRuleRepository } from "../domain/pricing-rule-repository";
import type { TaxClass } from "../domain/tax-class";
import type { TaxClassRepository } from "../domain/tax-class-repository";
import { PricingRuleMapper, TaxClassMapper } from "./pricing-registry.mappers";

export interface PrismaPricingRegistryRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

function requireTx(tx: unknown, repo: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${repo}.save requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/** Production `TaxClassRepository` on the `pricing` schema (ADR-0003 locking + same-tx outbox), `(tenant_id, code)` unique. */
export class PrismaTaxClassRepository implements TaxClassRepository {
  private readonly deps: PrismaPricingRegistryRepositoryDeps;

  constructor(deps: PrismaPricingRegistryRepositoryDeps) {
    this.deps = deps;
  }

  async save(taxClass: TaxClass, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaTaxClassRepository");
    const tenantId = this.deps.tenantId;
    const row = TaxClassMapper.toRow(taxClass, tenantId);

    if (taxClass.version === 0) {
      await client.taxClass.create({ data: row });
    } else {
      const updated = await client.taxClass.updateMany({
        where: { id: taxClass.id.toString(), tenantId, version: taxClass.version },
        data: { name: row.name, deletedAt: row.deletedAt, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `TaxClass ${taxClass.id.toString()} was modified concurrently (expected version ${taxClass.version})`,
        );
      }
    }

    await this.deps.outbox.write(taxClass.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<TaxClass | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.taxClass.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : TaxClassMapper.toDomain(row);
  }

  async findByCode(code: string, tx?: unknown): Promise<TaxClass | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.taxClass.findFirst({
      where: { tenantId: this.deps.tenantId, code, deletedAt: null },
    });
    return row === null ? null : TaxClassMapper.toDomain(row);
  }

  async delete(taxClass: TaxClass, tx?: unknown): Promise<void> {
    await this.save(taxClass, tx);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<TaxClass>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.taxClass.findMany({
      where: {
        tenantId: this.deps.tenantId,
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => TaxClassMapper.toDomain(row)),
      limit,
      (t) => t.id.toString(),
    );
  }
}

/** Production `PricingRuleRepository` on the `pricing` schema (ADR-0003 locking + same-tx outbox). No `delete` — superseded by `active`/`deactivate()`. */
export class PrismaPricingRuleRepository implements PricingRuleRepository {
  private readonly deps: PrismaPricingRegistryRepositoryDeps;

  constructor(deps: PrismaPricingRegistryRepositoryDeps) {
    this.deps = deps;
  }

  async save(rule: PricingRule, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPricingRuleRepository");
    const tenantId = this.deps.tenantId;
    const row = PricingRuleMapper.toRow(rule, tenantId);

    if (rule.version === 0) {
      await client.pricingRule.create({ data: row });
    } else {
      const updated = await client.pricingRule.updateMany({
        where: { id: rule.id.toString(), tenantId, version: rule.version },
        data: { active: row.active, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `PricingRule ${rule.id.toString()} was modified concurrently (expected version ${rule.version})`,
        );
      }
    }

    await this.deps.outbox.write(rule.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<PricingRule | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.pricingRule.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : PricingRuleMapper.toDomain(row);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<PricingRule>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.pricingRule.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => PricingRuleMapper.toDomain(row)),
      limit,
      (r) => r.id.toString(),
    );
  }
}
