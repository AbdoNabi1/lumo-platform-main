import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { AnalyticsReport } from "../domain/analytics-report";
import type { Dashboard } from "../domain/dashboard";
import type { ReportDefinition } from "../domain/report-definition";
import type {
  AnalyticsReportRepository,
  DashboardRepository,
  ReportDefinitionRepository,
} from "../domain/repositories";

/** ADR-0014 (WP-10, T10.3): per-tenant bucket, so every store is keyed by `(tenantId, id)`. */
function bucketFor<T>(store: Map<string, Map<string, T>>, tenantId: string): Map<string, T> {
  let bucket = store.get(tenantId);
  if (bucket === undefined) {
    bucket = new Map();
    store.set(tenantId, bucket);
  }
  return bucket;
}

export interface InMemoryReportingRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ReportDefinitionRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryReportDefinitionRepository implements ReportDefinitionRepository {
  private readonly store = new Map<string, Map<string, ReportDefinition>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReportingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(definition: ReportDefinition, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(definition.id.toString(), definition);
    await this.outbox.write(definition.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<ReportDefinition | null> {
    return bucketFor(this.store, tenantId).get(id) ?? null;
  }

  async findByName(name: string, tenantId: string): Promise<ReportDefinition | null> {
    for (const definition of bucketFor(this.store, tenantId).values()) {
      if (definition.name === name) return definition;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<ReportDefinition>> {
    const all = [...bucketFor(this.store, tenantId).values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}

/** In-memory `DashboardRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryDashboardRepository implements DashboardRepository {
  private readonly store = new Map<string, Map<string, Dashboard>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReportingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(dashboard: Dashboard, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(dashboard.id.toString(), dashboard);
    await this.outbox.write(dashboard.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Dashboard | null> {
    return bucketFor(this.store, tenantId).get(id) ?? null;
  }

  async findByName(name: string, tenantId: string): Promise<Dashboard | null> {
    for (const dashboard of bucketFor(this.store, tenantId).values()) {
      if (dashboard.name === name) return dashboard;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Dashboard>> {
    const all = [...bucketFor(this.store, tenantId).values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}

/** In-memory `AnalyticsReportRepository`. Persists the write-once run and writes events to the outbox on save. */
export class InMemoryAnalyticsReportRepository implements AnalyticsReportRepository {
  private readonly store = new Map<string, Map<string, AnalyticsReport>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReportingRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(report: AnalyticsReport, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(report.id.toString(), report);
    await this.outbox.write(report.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<AnalyticsReport | null> {
    return bucketFor(this.store, tenantId).get(id) ?? null;
  }
}
