import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { PricingRule } from "../domain/pricing-rule";
import type { PricingRuleRepository } from "../domain/pricing-rule-repository";
import type { TaxClass } from "../domain/tax-class";
import type { TaxClassRepository } from "../domain/tax-class-repository";

export interface InMemoryRegistryRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** ADR-0014 (WP-10, T10.3): per-tenant bucket, so the store is keyed by `(tenantId, id)`. */
function bucketFor<T>(store: Map<string, Map<string, T>>, tenantId: string): Map<string, T> {
  let bucket = store.get(tenantId);
  if (bucket === undefined) {
    bucket = new Map();
    store.set(tenantId, bucket);
  }
  return bucket;
}

/** In-memory `TaxClassRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryTaxClassRepository implements TaxClassRepository {
  private readonly store = new Map<string, Map<string, TaxClass>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryRegistryRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(taxClass: TaxClass, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(taxClass.id.toString(), taxClass);
    await this.outbox.write(taxClass.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<TaxClass | null> {
    const taxClass = bucketFor(this.store, tenantId).get(id) ?? null;
    return taxClass !== null && taxClass.deleted ? null : taxClass;
  }

  async findByCode(code: string, tenantId: string): Promise<TaxClass | null> {
    for (const taxClass of bucketFor(this.store, tenantId).values()) {
      if (taxClass.code === code && !taxClass.deleted) return taxClass;
    }
    return null;
  }

  async delete(taxClass: TaxClass, tenantId: string, tx?: unknown): Promise<void> {
    await this.save(taxClass, tenantId, tx);
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<TaxClass>> {
    const limit = normalizePageSize(page.first);
    const all = [...bucketFor(this.store, tenantId).values()]
      .filter((t) => !t.deleted)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((t) => t.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (t) => t.id.toString());
  }
}

/** In-memory `PricingRuleRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryPricingRuleRepository implements PricingRuleRepository {
  private readonly store = new Map<string, Map<string, PricingRule>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryRegistryRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(rule: PricingRule, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(rule.id.toString(), rule);
    await this.outbox.write(rule.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<PricingRule | null> {
    return bucketFor(this.store, tenantId).get(id) ?? null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<PricingRule>> {
    const limit = normalizePageSize(page.first);
    const all = [...bucketFor(this.store, tenantId).values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((r) => r.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (r) => r.id.toString());
  }
}
