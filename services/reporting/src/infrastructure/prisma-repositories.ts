import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { AnalyticsReport } from "../domain/analytics-report";
import type { Dashboard } from "../domain/dashboard";
import type { ReportDefinition } from "../domain/report-definition";
import type {
  AnalyticsReportRepository,
  DashboardRepository,
  ReportDefinitionRepository,
} from "../domain/repositories";
import {
  AnalyticsReportMapper,
  DashboardMapper,
  ReportDefinitionMapper,
  type AnalyticsReportRow,
  type DashboardRow,
  type ReportDefinitionRow,
} from "./mappers";

export interface PrismaReportingRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `ReportDefinitionRepository` on the `reporting` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaReportDefinitionRepository implements ReportDefinitionRepository {
  private readonly deps: PrismaReportingRepositoriesDeps;

  constructor(deps: PrismaReportingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(definition: ReportDefinition, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = definition.id.toString();
    const row = ReportDefinitionMapper.toRow(definition, tenantId);

    if (definition.version === 0) {
      await client.reportDefinition.create({
        data: {
          ...row,
          metrics: row.metrics,
          dimensions: row.dimensions,
          filters: row.filters as Prisma.InputJsonValue,
        },
      });
    } else {
      const updated = await client.reportDefinition.updateMany({
        where: { id, tenantId, version: definition.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Report definition ${id} was modified concurrently (expected version ${definition.version})`,
        );
      }
    }

    await this.deps.outbox.write(definition.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<ReportDefinition | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.reportDefinition.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ReportDefinitionMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tx?: unknown): Promise<ReportDefinition | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.reportDefinition.findFirst({
      where: { name, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ReportDefinitionMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<ReportDefinition>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.reportDefinition.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => ReportDefinitionMapper.toDomain(this.toMapperRow(row))),
      limit,
      (d) => d.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly metrics: unknown;
    readonly dimensions: unknown;
    readonly filters: unknown;
    readonly cronExpression: string | null;
    readonly status: string;
    readonly version: number;
  }): ReportDefinitionRow {
    return {
      ...row,
      type: row.type as ReportDefinitionRow["type"],
      metrics: row.metrics as ReportDefinitionRow["metrics"],
      dimensions: row.dimensions as ReportDefinitionRow["dimensions"],
      filters: row.filters as ReportDefinitionRow["filters"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaReportDefinitionRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

/** Production `DashboardRepository` on the `reporting` schema. */
export class PrismaDashboardRepository implements DashboardRepository {
  private readonly deps: PrismaReportingRepositoriesDeps;

  constructor(deps: PrismaReportingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(dashboard: Dashboard, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = dashboard.id.toString();
    const row = DashboardMapper.toRow(dashboard, tenantId);

    if (dashboard.version === 0) {
      await client.dashboard.create({
        data: { ...row, tileRefs: row.tileRefs },
      });
    } else {
      const updated = await client.dashboard.updateMany({
        where: { id, tenantId, version: dashboard.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Dashboard ${id} was modified concurrently (expected version ${dashboard.version})`,
        );
      }
    }

    await this.deps.outbox.write(dashboard.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Dashboard | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.dashboard.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return DashboardMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tx?: unknown): Promise<Dashboard | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.dashboard.findFirst({ where: { name, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return DashboardMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Dashboard>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.dashboard.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => DashboardMapper.toDomain(this.toMapperRow(row))),
      limit,
      (d) => d.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly tileRefs: unknown;
    readonly status: string;
    readonly version: number;
  }): DashboardRow {
    return { ...row, tileRefs: row.tileRefs as DashboardRow["tileRefs"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaDashboardRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

/** Production `AnalyticsReportRepository` on the `reporting` schema — write-once run records. */
export class PrismaAnalyticsReportRepository implements AnalyticsReportRepository {
  private readonly deps: PrismaReportingRepositoriesDeps;

  constructor(deps: PrismaReportingRepositoriesDeps) {
    this.deps = deps;
  }

  async save(report: AnalyticsReport, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const row = AnalyticsReportMapper.toRow(report, this.deps.tenantId);
    await client.analyticsReport.create({
      data: { ...row, resultData: row.resultData as Prisma.InputJsonValue },
    });
    await this.deps.outbox.write(report.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<AnalyticsReport | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.analyticsReport.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return AnalyticsReportMapper.toDomain(this.toMapperRow(row));
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly reportDefinitionRef: string;
    readonly outcome: string;
    readonly resultData: unknown;
    readonly errorMessage: string | null;
    readonly generatedAt: Date;
    readonly version: number;
  }): AnalyticsReportRow {
    return { ...row, outcome: row.outcome as AnalyticsReportRow["outcome"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaAnalyticsReportRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
